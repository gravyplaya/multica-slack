/**
 * Query cache updaters for realtime events.
 *
 * The Stage 4 gate is: realtime events update the React Query cache
 * in place; no second store is created, no broad "invalidate
 * everything" hammer is used. This module is the single source of
 * truth for how each event type rewrites a specific Query key.
 *
 * The functions are pure (`(queryClient, ctx, event) => void`) so
 * they can be unit-tested without mounting React. The companion
 * `useRealtime` hook is the only React-side wiring.
 *
 * Conventions:
 *
 * 1. Every helper checks the query exists before writing. A missing
 *    cache entry is a no-op — the next refetch will pick up the
 *    authoritative server state.
 * 2. Helpers use the same `["<query>", ...args, sessionKey]` cache
 *    shape the rest of the app uses, so a stale-data read after a
 *    navigation does not get a contradictory update.
 * 3. The comment reconciliation helper (`pickOptimisticMatch` /
 *    `pickOptimisticViewMatch`) is the only one that may drop a
 *    pending comment by its `optimistic-*` id; everything else is
 *    by server-issued id.
 * 4. Helpers never throw on a missing or malformed field. The
 *    validator in `lib/realtime/events.ts` already filtered the
 *    payload, so a panic here would be a bug.
 * 5. We mirror both the wire shape (cached by `useQuery` directly)
 *    and, for `["comments", issueId, sessionKey]`, the timeline
 *    view shape (cached by the composer / message-list component).
 *    Both caches get the same event so a partial unmount does not
 *    leave one stale.
 */

import type { QueryClient } from "@tanstack/react-query";

import { mergeCommentViews } from "../chat/optimistic-comments";
import { mapComment, mapReaction } from "../mappers";
import type {
  CommentView,
  WireComment,
  WireIssue,
  WireReaction,
  WireWorkspaceMember,
} from "../types";
import type { WireAgent } from "../types";
import type { WireWsFrame } from "../types";
import type { RealtimeEvent } from "./events";

/**
 * Composite session key — same shape the rest of the app uses for
 * row-level query keys. The `sessionKey` lets the same workspace
 * data coexist under two different credentials in the same cache.
 */
export interface CacheContext {
  workspaceId: string;
  backendOrigin: string;
  sessionKey: string;
}

/**
 * Apply a single realtime event to the Query cache. The dispatcher
 * is a single switch so the test suite can assert on behaviour
 * without having to re-implement the routing.
 */
export function applyRealtimeEvent(
  queryClient: QueryClient,
  ctx: CacheContext,
  event: RealtimeEvent,
): void {
  switch (event.type) {
    case "issue:created":
    case "issue:updated":
      upsertIssue(queryClient, ctx, event.payload.issue);
      return;
    case "issue:deleted":
      removeIssue(queryClient, ctx, event.payload.issue_id);
      return;
    case "comment:created":
      upsertComment(queryClient, ctx, event.payload.comment);
      return;
    case "comment:updated":
    case "comment:resolved":
    case "comment:unresolved":
      upsertComment(queryClient, ctx, event.payload.comment);
      return;
    case "comment:deleted":
      removeComment(queryClient, ctx, event.payload.comment_id);
      return;
    case "reaction:added":
      upsertReaction(queryClient, ctx, {
        reaction: event.payload.reaction,
        scopeId: event.payload.comment_id,
        scope: "comment",
      });
      return;
    case "reaction:removed":
      removeReaction(queryClient, ctx, {
        reaction: event.payload.reaction,
        scopeId: event.payload.comment_id,
        scope: "comment",
      });
      return;
    case "issue_reaction:added":
      upsertReaction(queryClient, ctx, {
        reaction: event.payload.reaction,
        scopeId: event.payload.issue_id,
        scope: "issue",
      });
      return;
    case "issue_reaction:removed":
      removeReaction(queryClient, ctx, {
        reaction: event.payload.reaction,
        scopeId: event.payload.issue_id,
        scope: "issue",
      });
      return;
    case "agent:status":
    case "agent:restored":
      upsertAgent(queryClient, ctx, event.payload.agent);
      return;
    case "agent:archived":
      removeAgent(queryClient, ctx, event.payload.agent.id);
      return;
    case "member:added":
    case "member:updated":
      upsertMember(queryClient, ctx, event.payload.member);
      return;
    case "member:removed":
      removeMember(queryClient, ctx, event.payload.member.id);
      return;
    case "workspace:updated":
      // Workspace metadata is rare; trigger a targeted refetch
      // rather than reach into the cache with a partial write.
      queryClient.invalidateQueries({
        queryKey: ["workspaces", ctx.backendOrigin, ctx.sessionKey],
        exact: true,
      });
      return;
  }
}

// ---------------------------------------------------------------------------
// Cache key helpers
// ---------------------------------------------------------------------------

function issueListKey(ctx: CacheContext): readonly unknown[] {
  return ["issues", ctx.workspaceId, ctx.sessionKey];
}
function issueDetailKey(ctx: CacheContext, issueId: string): readonly unknown[] {
  return ["issue", issueId, ctx.sessionKey];
}
function commentKey(ctx: CacheContext, issueId: string): readonly unknown[] {
  return ["comments", issueId, ctx.sessionKey];
}
function agentListKey(ctx: CacheContext): readonly unknown[] {
  return ["agents", ctx.workspaceId, ctx.sessionKey];
}
function memberListKey(ctx: CacheContext): readonly unknown[] {
  return ["members", ctx.workspaceId, ctx.sessionKey];
}

function isSessionScopedCommentKey(
  key: readonly unknown[],
  prefix: "comments" | "commentsView",
  sessionKey: string,
): boolean {
  return key.length === 3 && key[0] === prefix && key[2] === sessionKey;
}

// ---------------------------------------------------------------------------
// Issue updates
// ---------------------------------------------------------------------------

function upsertIssue(
  queryClient: QueryClient,
  ctx: CacheContext,
  wire: WireIssue,
): void {
  queryClient.setQueryData<WireIssue[] | undefined>(issueListKey(ctx), (current) => {
    if (!current) return current;
    const next = current.filter((issue) => issue.id !== wire.id);
    next.push(wire);
    return next;
  });
  queryClient.setQueryData<WireIssue | undefined>(
    issueDetailKey(ctx, wire.id),
    wire,
  );
}

function removeIssue(
  queryClient: QueryClient,
  ctx: CacheContext,
  issueId: string,
): void {
  queryClient.setQueryData<WireIssue[] | undefined>(issueListKey(ctx), (current) => {
    if (!current) return current;
    return current.filter((issue) => issue.id !== issueId);
  });
  queryClient.removeQueries({ queryKey: issueDetailKey(ctx, issueId) });
}

// ---------------------------------------------------------------------------
// Comment updates
// ---------------------------------------------------------------------------

/**
 * Insert / upsert a comment into the cache for its issue. The
 * function honours two competing identities:
 *
 * 1. The server's stable id — incoming events with a known id
 *    replace any entry that already has that id (this is how the
 *    optimistic comment gets reconciled away).
 * 2. The `optimistic-*` placeholder id — when a server-bearing
 *    `comment:created` event arrives for an issue that has a
 *    pending client-side comment meant to be the same logical
 *    message (matched by author + content), the optimistic entry
 *    is dropped first so the timeline does not render the same
 *    message twice.
 *
 * The wire cache is the source of truth for the REST list, and the
 * cache for the view-key may carry the same data plus projections
 * (e.g. `Date` objects). We update both so a consumer that already
 * mapped the list still sees the new event.
 */
function upsertComment(
  queryClient: QueryClient,
  ctx: CacheContext,
  wire: WireComment,
): void {
  const key = commentKey(ctx, wire.issue_id);
  queryClient.setQueryData<WireComment[] | undefined>(key, (current) => {
    if (!current) return current;
    const optimistic = pickOptimisticMatch(current, wire);
    const withoutOptimistic = optimistic
      ? current.filter((comment) => comment.id !== optimistic.id)
      : current;
    const withoutDuplicate = withoutOptimistic.filter((comment) => comment.id !== wire.id);
    return [...withoutDuplicate, wire];
  });
  // The view-shaped cache lives under a parallel key so a consumer
  // that already mapped the list via `mapComment` still sees the
  // update without invalidating and re-fetching.
  const viewKey = ["commentsView", wire.issue_id, ctx.sessionKey] as const;
  queryClient.setQueryData<CommentView[] | undefined>(viewKey, (current) => {
    const mapped = mapCommentSafe(wire);
    if (!current) return mapped ? [mapped] : undefined;
    if (!mapped) return current;
    const optimistic = pickOptimisticViewMatch(current, mapped);
    const optimisticRemoved = optimistic
      ? current.filter((comment) => comment.id !== optimistic.id)
      : current;
    return mergeCommentViews(optimisticRemoved, mapped);
  });
}

function removeComment(
  queryClient: QueryClient,
  ctx: CacheContext,
  commentId: string,
): void {
  // The wire deletion frame carries only `comment_id`, not the
  // owning `issue_id`, so the cache key cannot be targeted directly.
  // TODO(realtime-contract): include `issue_id` on comment deletion
  // frames; until then this is O(cached channels) and grows with the
  // number of channel comment lists retained by TanStack Query.
  const wireQueries = queryClient
    .getQueryCache()
    .findAll({ queryKey: ["comments"] });
  for (const query of wireQueries) {
    const match = query.queryKey;
    if (!isSessionScopedCommentKey(match, "comments", ctx.sessionKey)) continue;
    queryClient.setQueryData<WireComment[] | undefined>(match, (current) => {
      if (!current) return current;
      return current.filter((comment) => comment.id !== commentId);
    });
  }
  const viewQueries = queryClient
    .getQueryCache()
    .findAll({ queryKey: ["commentsView"] });
  for (const query of viewQueries) {
    const match = query.queryKey;
    if (!isSessionScopedCommentKey(match, "commentsView", ctx.sessionKey)) continue;
    queryClient.setQueryData<CommentView[] | undefined>(match, (current) => {
      if (!current) return current;
      return current.filter((comment) => comment.id !== commentId);
    });
  }
}

function mapCommentSafe(wire: WireComment): CommentView | null {
  try {
    return mapComment(wire);
  } catch {
    // The validator in `lib/realtime/events.ts` already accepted
    // the payload, so a mapper failure is a contract drift bug.
    // We drop the mapping rather than poison the cache.
    return null;
  }
}

/**
 * Heuristic to match a server-handed comment back to a pending
 * `optimistic-*` placeholder. The server has handed us a canonical
 * row; if the cached list contains an optimistic entry from the
 * same author with the same content, we treat them as the same
 * logical message and drop the placeholder before inserting the
 * server-issued id.
 *
 * The match is intentionally narrow — same author + same content —
 * which is the strongest signal we have before the server hands us
 * a client-correlation id. Two identical messages sent back-to-back
 * by the same author can therefore reconcile the wrong placeholder;
 * the next authoritative refetch corrects that MVP limitation. A
 * future protocol change can make the match exact by providing a
 * `client_id` field on the wire frame.
 *
 * The heuristic only fires when the *incoming* id is a server-issued
 * one (i.e. not prefixed with `optimistic-`). An incoming optimistic
 * id is itself a placeholder and should not evict the cached entry
 * that already represents it.
 */
function pickOptimisticMatch(
  current: readonly WireComment[],
  incoming: WireComment,
): WireComment | undefined {
  if (incoming.id.startsWith("optimistic-")) return undefined;
  for (const row of current) {
    if (!row.id.startsWith("optimistic-")) continue;
    if (row.author_type !== incoming.author_type) continue;
    if (row.author_id !== incoming.author_id) continue;
    if (row.content !== incoming.content) continue;
    return row;
  }
  return undefined;
}

/**
 * View-shape sibling of `pickOptimisticMatch`. The optimistic
 * comment rendered by the composer carries the same `{ author,
 * content }` shape as the mapped `CommentView`, so we can match
 * identically without re-mapping the cached list.
 */
function pickOptimisticViewMatch(
  current: readonly CommentView[],
  incoming: CommentView,
): CommentView | undefined {
  if (incoming.id.startsWith("optimistic-")) return undefined;
  for (const row of current) {
    if (!row.id.startsWith("optimistic-")) continue;
    if (row.author.type !== incoming.author.type) continue;
    if (row.author.id !== incoming.author.id) continue;
    if (row.content !== incoming.content) continue;
    return row;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Reaction updates
// ---------------------------------------------------------------------------

interface ReactionTarget {
  reaction: WireReaction;
  scopeId: string;
  scope: "comment" | "issue";
}

function upsertReaction(
  queryClient: QueryClient,
  ctx: CacheContext,
  target: ReactionTarget,
): void {
  if (target.scope === "comment") {
    // Comment reaction frames likewise omit `issue_id`. Until the
    // wire contract includes it, each event must scan the retained
    // channel comment caches (O(cached channels)).
    // TODO(realtime-contract): include `issue_id` on reaction frames.
    sweepCommentReactions(queryClient, ctx, target.reaction, true);
  } else {
    // Issue reactions are surfaced on the sidebar; stamp them onto
    // the cached wire issue so the chip updates.
    const matching = issueDetailKey(ctx, target.scopeId);
    queryClient.setQueryData<WireIssue | undefined>(matching, (current) => {
      if (!current) return current;
      const reactions = (current.reactions ?? []).filter((r) => r.id !== target.reaction.id);
      reactions.push(target.reaction);
      return { ...current, reactions };
    });
    const listKey = issueListKey(ctx);
    queryClient.setQueryData<WireIssue[] | undefined>(listKey, (current) => {
      if (!current) return current;
      return current.map((issue) => {
        if (issue.id !== target.scopeId) return issue;
        const reactions = (issue.reactions ?? []).filter((r) => r.id !== target.reaction.id);
        reactions.push(target.reaction);
        return { ...issue, reactions };
      });
    });
  }
}

function removeReaction(
  queryClient: QueryClient,
  ctx: CacheContext,
  target: ReactionTarget,
): void {
  if (target.scope === "comment") {
    sweepCommentReactions(queryClient, ctx, target.reaction, false);
  } else {
    const matching = issueDetailKey(ctx, target.scopeId);
    queryClient.setQueryData<WireIssue | undefined>(matching, (current) => {
      if (!current) return current;
      const currentItems = current.reactions ?? [];
      const next = currentItems.filter((r) => r.id !== target.reaction.id);
      if (next.length === currentItems.length) return current;
      return { ...current, reactions: next };
    });
    const listKey = issueListKey(ctx);
    queryClient.setQueryData<WireIssue[] | undefined>(listKey, (current) => {
      if (!current) return current;
      return current.map((issue) => {
        if (issue.id !== target.scopeId) return issue;
        const currentItems = issue.reactions ?? [];
        const next = currentItems.filter((r) => r.id !== target.reaction.id);
        if (next.length === currentItems.length) return issue;
        return { ...issue, reactions: next };
      });
    });
  }
}

/**
 * Walk every cached `["comments", issueId, sessionKey]` key and
 * apply the reaction update to the comment whose id matches
 * `reaction.comment_id`. This is O(cached channels) because the
 * current reaction frame omits `issue_id`; the per-list `rewrite*`
 * guard ensures we only touch entries that contain the comment.
 */
function sweepCommentReactions(
  queryClient: QueryClient,
  ctx: CacheContext,
  reaction: WireReaction,
  add: boolean,
): void {
  const wireQueries = queryClient
    .getQueryCache()
    .findAll({ queryKey: ["comments"] });
  for (const query of wireQueries) {
    const match = query.queryKey;
    if (!isSessionScopedCommentKey(match, "comments", ctx.sessionKey)) continue;
    rewriteCommentReactions(match, queryClient, reaction, add);
  }
}

function rewriteCommentReactions(
  key: readonly unknown[],
  queryClient: QueryClient,
  reaction: WireReaction,
  add: boolean,
): void {
  queryClient.setQueryData<WireComment[] | undefined>(key, (current) => {
    if (!current) return current;
    let changed = false;
    const next = current.map((comment) => {
      if (comment.id !== reaction.comment_id) return comment;
      changed = true;
      const existing = (comment.reactions ?? []).filter((r) => r.id !== reaction.id);
      return {
        ...comment,
        reactions: add ? [...existing, reaction] : existing,
      };
    });
    return changed ? next : current;
  });
  const viewKey = ["commentsView", key[1], key[2]] as const;
  queryClient.setQueryData<CommentView[] | undefined>(viewKey, (current) => {
    if (!current) return current;
    let changed = false;
    const next = current.map((comment) => {
      if (comment.id !== reaction.comment_id) return comment;
      changed = true;
      const existing = comment.reactions.filter((r) => r.id !== reaction.id);
      const mapped = mapReaction(reaction);
      return {
        ...comment,
        reactions: add ? [...existing, mapped] : existing,
      };
    });
    return changed ? next : current;
  });
}

// ---------------------------------------------------------------------------
// Agent + member updates
// ---------------------------------------------------------------------------

function upsertAgent(
  queryClient: QueryClient,
  ctx: CacheContext,
  wire: WireAgent,
): void {
  const key = agentListKey(ctx);
  queryClient.setQueryData<WireAgent[] | undefined>(key, (current) => {
    if (!current) return current;
    const next = current.filter((agent) => agent.id !== wire.id);
    next.push(wire);
    return next;
  });
}

function removeAgent(
  queryClient: QueryClient,
  ctx: CacheContext,
  agentId: string,
): void {
  const key = agentListKey(ctx);
  queryClient.setQueryData<WireAgent[] | undefined>(key, (current) => {
    if (!current) return current;
    return current.filter((agent) => agent.id !== agentId);
  });
}

function upsertMember(
  queryClient: QueryClient,
  ctx: CacheContext,
  member: WireWorkspaceMember,
): void {
  const key = memberListKey(ctx);
  queryClient.setQueryData<WireWorkspaceMember[] | undefined>(key, (current) => {
    if (!current) return current;
    const next = current.filter((row) => row.id !== member.id);
    next.push(member);
    return next;
  });
}

function removeMember(
  queryClient: QueryClient,
  ctx: CacheContext,
  memberId: string,
): void {
  const key = memberListKey(ctx);
  queryClient.setQueryData<WireWorkspaceMember[] | undefined>(key, (current) => {
    if (!current) return current;
    return current.filter((row) => row.id !== memberId);
  });
}

// ---------------------------------------------------------------------------
// Test-only helpers
// ---------------------------------------------------------------------------

/**
 * Test helper that re-exports the `WireWsFrame` type so the test
 * suite can construct events without re-importing the underlying
 * namespace. Kept here so the public surface of the module remains
 * one import.
 */
export type { WireWsFrame };
