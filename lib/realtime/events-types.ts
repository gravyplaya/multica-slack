/**
 * Type definitions for the realtime layer.
 *
 * Split out from `events.ts` so the manager + hook can import
 * `RealtimeEvent`, `ConnectionStatus`, and `CloseReason` without
 * pulling the validator functions in. This keeps the import graph
 * acyclic — `events.ts` exports runtime predicates that depend on
 * the types declared here.
 */

import type {
  WireAgent,
  WireComment,
  WireIssue,
  WireReaction,
  WireUser,
  WireWorkspace,
  WireWorkspaceMember,
  WireWsFrame,
} from "../types";

/**
 * Discriminated union of the event types the realtime layer is
 * willing to fan out to the rest of the app. Anything else is logged
 * and dropped — not subscribed to, not displayed, not threaded into
 * query updates.
 *
 * The list is intentionally narrower than `WireWsServerEvent`: we
 * keep `auth_ack`, `auth_error`, `pong`, `subscribe_ack`,
 * `unsubscribe_ack`, and `subscribe_error` inside the manager as
 * protocol noise — components never see them.
 */
export type RealtimeEvent =
  | WireWsFrame<"issue:created", { issue: WireIssue }>
  | WireWsFrame<"issue:updated", { issue: WireIssue }>
  | WireWsFrame<"issue:deleted", { issue_id: string }>
  | WireWsFrame<
      "comment:created",
      {
        comment: WireComment;
        issue_title: string;
        issue_assignee_type: string | null;
        issue_assignee_id: string | null;
        issue_status: string;
      }
    >
  | WireWsFrame<"comment:updated", { comment: WireComment }>
  | WireWsFrame<"comment:deleted", { comment_id: string }>
  | WireWsFrame<"comment:resolved", { comment: WireComment }>
  | WireWsFrame<"comment:unresolved", { comment: WireComment }>
  | WireWsFrame<"reaction:added", { reaction: WireReaction; comment_id: string }>
  | WireWsFrame<"reaction:removed", { reaction: WireReaction; comment_id: string }>
  | WireWsFrame<"issue_reaction:added", { reaction: WireReaction; issue_id: string }>
  | WireWsFrame<"issue_reaction:removed", { reaction: WireReaction; issue_id: string }>
  | WireWsFrame<"agent:status", { agent: WireAgent }>
  | WireWsFrame<"agent:archived", { agent: WireAgent }>
  | WireWsFrame<"agent:restored", { agent: WireAgent }>
  | WireWsFrame<"member:added", { member: WireWorkspaceMember; user: WireUser }>
  | WireWsFrame<"member:updated", { member: WireWorkspaceMember; user: WireUser }>
  | WireWsFrame<"member:removed", { member: WireWorkspaceMember; user: WireUser }>
  | WireWsFrame<"workspace:updated", { workspace: WireWorkspace }>;

/**
 * Status variants surfaced to the UI. Mirrors the lifecycle the
 * manager is in.
 *
 * - `idle` — constructed but never asked to connect (or asked to
 *   disconnect and not reconnected).
 * - `connecting` — a socket is being opened OR the bearer handshake
 *   is in flight. We collapse the two so the UI does not need to
 *   distinguish "TCP open" from "auth in progress" — both render
 *   the same subtle pulse.
 * - `connected` — the server has acknowledged the auth frame
 *   (or a cookie session was accepted). Events flow.
 * - `reconnecting` — a clean or unclean disconnect happened; the
 *   manager is waiting for the next backoff window. Already loaded
 *   views should keep rendering.
 * - `failed` — the manager gave up after `maxReconnectAttempts`
 *   failed attempts, or the server returned `auth_error`. The UI
 *   can show a "retry" affordance but must not erase loaded data.
 * - `closed` — the manager was explicitly disconnected. No
 *   reconnect will happen; this is the "signed out" terminal state.
 */
export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed"
  | "closed";

/**
 * A close-reason bag the manager reports on every transition. The
 * numeric code is the WebSocket `CloseEvent.code` (or `null` for
 * non-close transitions); the reason string is the raw
 * `CloseEvent.reason` / a human-readable summary for non-close
 * transitions the caller should know about.
 */
export interface CloseReason {
  code: number | null;
  reason: string;
}
