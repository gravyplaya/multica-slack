/**
 * Tests for the query cache updaters.
 *
 * The Stage 4 gate calls for:
 *   - Unrelated channels must not be changed.
 *   - Duplicate events must be idempotent.
 *   - The minimum necessary cache key is rewritten.
 *
 * These tests drive `applyRealtimeEvent` directly with a
 * `QueryClient` from `@tanstack/react-query` so we can assert on
 * the resulting cache state.
 */

import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, beforeEach } from "vitest";

import { applyRealtimeEvent, type CacheContext } from "./query-updaters";
import type { RealtimeEvent } from "./events-types";
import type { WireAgent, WireComment, WireIssue } from "../types";

const SESSION_KEY = "tok-deadbeef";
const BACKEND_ORIGIN = "http://localhost:8080";
const CTX: CacheContext = {
  workspaceId: "ws-1",
  backendOrigin: BACKEND_ORIGIN,
  sessionKey: SESSION_KEY,
};

function makeClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function issue(overrides: Partial<WireIssue> = {}): WireIssue {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    workspace_id: "22222222-2222-4222-8222-222222222222",
    number: 1,
    identifier: "ACME-1",
    title: "Stage 4 realtime",
    description: null,
    status: "todo",
    priority: "none",
    assignee_type: null,
    assignee_id: null,
    creator_type: "member",
    creator_id: "11111111-1111-4111-8111-111111111111",
    parent_issue_id: null,
    project_id: null,
    position: 0,
    stage: null,
    start_date: null,
    due_date: null,
    created_at: "2026-08-04T12:00:00Z",
    updated_at: "2026-08-04T12:00:00Z",
    metadata: {},
    ...overrides,
  };
}

function comment(overrides: Partial<WireComment> = {}): WireComment {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    issue_id: "33333333-3333-4333-8333-333333333333",
    author_type: "member",
    author_id: "11111111-1111-4111-8111-111111111111",
    content: "hello",
    type: "comment",
    parent_id: null,
    created_at: "2026-08-04T12:00:00Z",
    updated_at: "2026-08-04T12:00:00Z",
    resolved_at: null,
    resolved_by_type: null,
    resolved_by_id: null,
    source_task_id: null,
    reactions: [],
    attachments: [],
    ...overrides,
  };
}

function asEvent(event: RealtimeEvent): RealtimeEvent {
  return event;
}

describe("applyRealtimeEvent", () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    queryClient = makeClient();
  });

  it("issue:created appends to the issue list and writes a detail key", () => {
    const existing = issue({ id: "issue-A", number: 1 });
    queryClient.setQueryData(["issues", CTX.workspaceId, SESSION_KEY], [existing]);
    const incoming = issue({ id: "issue-B", number: 2, identifier: "ACME-2" });
    applyRealtimeEvent(
      queryClient,
      CTX,
      asEvent({ type: "issue:created", payload: { issue: incoming } }),
    );
    const list = queryClient.getQueryData(["issues", CTX.workspaceId, SESSION_KEY]) as WireIssue[];
    expect(list).toHaveLength(2);
    expect(list.map((i) => i.id).sort()).toEqual(["issue-A", "issue-B"]);
    const detail = queryClient.getQueryData(["issue", "issue-B", SESSION_KEY]);
    expect(detail).toEqual(incoming);
  });

  it("issue:updated upserts in place without duplicating the entry", () => {
    const original = issue({ id: "issue-A", title: "old" });
    queryClient.setQueryData(["issues", CTX.workspaceId, SESSION_KEY], [original]);
    const updated = issue({ id: "issue-A", title: "new" });
    applyRealtimeEvent(
      queryClient,
      CTX,
      asEvent({ type: "issue:updated", payload: { issue: updated } }),
    );
    const list = queryClient.getQueryData(["issues", CTX.workspaceId, SESSION_KEY]) as WireIssue[];
    expect(list).toHaveLength(1);
    expect(list[0]?.title).toBe("new");
  });

  it("issue:deleted removes from the list and clears the detail key", () => {
    const a = issue({ id: "issue-A" });
    const b = issue({ id: "issue-B" });
    queryClient.setQueryData(["issues", CTX.workspaceId, SESSION_KEY], [a, b]);
    queryClient.setQueryData(["issue", "issue-B", SESSION_KEY], b);
    applyRealtimeEvent(
      queryClient,
      CTX,
      asEvent({ type: "issue:deleted", payload: { issue_id: "issue-B" } }),
    );
    const list = queryClient.getQueryData(["issues", CTX.workspaceId, SESSION_KEY]) as WireIssue[];
    expect(list.map((i) => i.id)).toEqual(["issue-A"]);
    expect(queryClient.getQueryData(["issue", "issue-B", SESSION_KEY])).toBeUndefined();
  });

  it("comment:created appends to the issue's comment list", () => {
    const issueId = "33333333-3333-4333-8333-333333333333";
    queryClient.setQueryData(["comments", issueId, SESSION_KEY], []);
    const incoming = comment({ id: "c-1", content: "first" });
    applyRealtimeEvent(
      queryClient,
      CTX,
      asEvent({
        type: "comment:created",
        payload: {
          comment: incoming,
          issue_title: "ACME-1",
          issue_assignee_type: null,
          issue_assignee_id: null,
          issue_status: "todo",
        },
      }),
    );
    const list = queryClient.getQueryData(["comments", issueId, SESSION_KEY]) as WireComment[];
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe("c-1");
  });

  it("comment:created reconciles an optimistic placeholder by author + content", () => {
    const issueId = "33333333-3333-4333-8333-333333333333";
    const optimistic = comment({
      id: "optimistic-uuid-1",
      content: "draft text",
    });
    queryClient.setQueryData(["comments", issueId, SESSION_KEY], [optimistic]);
    // Server hands back a comment with the same author + content but
    // a fresh UUID.
    const server = comment({ id: "server-uuid-1", content: "draft text" });
    applyRealtimeEvent(
      queryClient,
      CTX,
      asEvent({
        type: "comment:created",
        payload: {
          comment: server,
          issue_title: "ACME-1",
          issue_assignee_type: null,
          issue_assignee_id: null,
          issue_status: "todo",
        },
      }),
    );
    const list = queryClient.getQueryData(["comments", issueId, SESSION_KEY]) as WireComment[];
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe("server-uuid-1");
  });

  it("comment:created is idempotent when the same server id arrives twice", () => {
    const issueId = "33333333-3333-4333-8333-333333333333";
    queryClient.setQueryData(["comments", issueId, SESSION_KEY], []);
    const incoming = comment({ id: "server-uuid-1", content: "hi" });
    const event = asEvent({
      type: "comment:created",
      payload: {
        comment: incoming,
        issue_title: "ACME-1",
        issue_assignee_type: null,
        issue_assignee_id: null,
        issue_status: "todo",
      },
    });
    applyRealtimeEvent(queryClient, CTX, event);
    applyRealtimeEvent(queryClient, CTX, event);
    const list = queryClient.getQueryData(["comments", issueId, SESSION_KEY]) as WireComment[];
    expect(list).toHaveLength(1);
  });

  it("comment:deleted removes by id without touching other issues or sessions", () => {
    const issueA = "issue-A";
    const issueB = "issue-B";
    const otherSession = "tok-other";
    queryClient.setQueryData(["comments", issueA, SESSION_KEY], [
      comment({ id: "c-1", issue_id: issueA }),
    ]);
    queryClient.setQueryData(["comments", issueB, SESSION_KEY], [
      comment({ id: "c-2", issue_id: issueB }),
    ]);
    queryClient.setQueryData(["comments", issueA, otherSession], [
      comment({ id: "c-1", issue_id: issueA }),
    ]);
    applyRealtimeEvent(
      queryClient,
      CTX,
      asEvent({ type: "comment:deleted", payload: { comment_id: "c-1" } }),
    );
    const a = queryClient.getQueryData(["comments", issueA, SESSION_KEY]) as WireComment[];
    const b = queryClient.getQueryData(["comments", issueB, SESSION_KEY]) as WireComment[];
    const other = queryClient.getQueryData(["comments", issueA, otherSession]) as WireComment[];
    expect(a).toEqual([]);
    expect(b).toHaveLength(1);
    expect(other).toHaveLength(1);
  });

  it("reaction:added updates the right comment without duplicating or crossing sessions", () => {
    const issueId = "33333333-3333-4333-8333-333333333333";
    const otherSession = "tok-other";
    const target = comment({ id: "c-1", issue_id: issueId, reactions: [] });
    queryClient.setQueryData(["comments", issueId, SESSION_KEY], [target]);
    queryClient.setQueryData(["comments", issueId, otherSession], [target]);
    const reaction = {
      id: "r-1",
      comment_id: "c-1",
      actor_type: "member" as const,
      actor_id: "11111111-1111-4111-8111-111111111111",
      emoji: "🎉",
      created_at: "2026-08-04T12:00:00Z",
    };
    applyRealtimeEvent(
      queryClient,
      CTX,
      asEvent({ type: "reaction:added", payload: { reaction, comment_id: "c-1" } }),
    );
    // Apply twice — must remain a single reaction.
    applyRealtimeEvent(
      queryClient,
      CTX,
      asEvent({ type: "reaction:added", payload: { reaction, comment_id: "c-1" } }),
    );
    const list = queryClient.getQueryData(["comments", issueId, SESSION_KEY]) as WireComment[];
    const other = queryClient.getQueryData(["comments", issueId, otherSession]) as WireComment[];
    expect(list[0]?.reactions).toHaveLength(1);
    expect(other[0]?.reactions).toHaveLength(0);
  });

  it("reaction:removed drops the matching reaction", () => {
    const issueId = "33333333-3333-4333-8333-333333333333";
    const reaction = {
      id: "r-1",
      comment_id: "c-1",
      actor_type: "member" as const,
      actor_id: "11111111-1111-4111-8111-111111111111",
      emoji: "🎉",
      created_at: "2026-08-04T12:00:00Z",
    };
    const target = comment({
      id: "c-1",
      issue_id: issueId,
      reactions: [reaction],
    });
    queryClient.setQueryData(["comments", issueId, SESSION_KEY], [target]);
    applyRealtimeEvent(
      queryClient,
      CTX,
      asEvent({ type: "reaction:removed", payload: { reaction, comment_id: "c-1" } }),
    );
    const list = queryClient.getQueryData(["comments", issueId, SESSION_KEY]) as WireComment[];
    expect(list[0]?.reactions).toEqual([]);
  });

  it("agent:status replaces the matching agent without losing other agents", () => {
    queryClient.setQueryData(["agents", CTX.workspaceId, SESSION_KEY], [
      { id: "a-1", name: "A", workspace_id: CTX.workspaceId, status: "idle", updated_at: "2026-08-04T12:00:00Z" },
      { id: "a-2", name: "B", workspace_id: CTX.workspaceId, status: "idle", updated_at: "2026-08-04T12:00:00Z" },
    ]);
    applyRealtimeEvent(
      queryClient,
      CTX,
      asEvent({
        type: "agent:status",
        payload: {
          agent: {
            id: "a-1",
            workspace_id: CTX.workspaceId,
            runtime_id: "rt-1",
            name: "A",
            description: "",
            instructions: "",
            avatar_url: null,
            runtime_mode: "openclaw",
            runtime_config: {},
            custom_args: [],
            mcp_config: {},
            has_custom_env: false,
            custom_env_key_count: 0,
            mcp_config_redacted: false,
            visibility: "workspace",
            status: "working",
            max_concurrent_tasks: 1,
            model: "test",
            thinking_level: "low",
            owner_id: "11111111-1111-4111-8111-111111111111",
            skills: [],
            created_at: "2026-08-04T11:00:00Z",
            updated_at: "2026-08-04T12:00:00Z",
            archived_at: null,
            archived_by: null,
          },
        },
      }),
    );
    const agents = queryClient.getQueryData(["agents", CTX.workspaceId, SESSION_KEY]) as Array<{ id: string; status: string }>;
    expect(agents).toHaveLength(2);
    const updated = agents.find((a) => a.id === "a-1");
    expect(updated?.status).toBe("working");
  });

  it("agent:archived removes the participant from the agents cache", () => {
    const archived: WireAgent = {
      id: "a-1",
      workspace_id: CTX.workspaceId,
      runtime_id: "rt-1",
      name: "A",
      description: "",
      instructions: "",
      avatar_url: null,
      runtime_mode: "openclaw",
      runtime_config: {},
      custom_args: [],
      mcp_config: {},
      has_custom_env: false,
      custom_env_key_count: 0,
      mcp_config_redacted: false,
      visibility: "workspace",
      status: "idle",
      max_concurrent_tasks: 1,
      model: "test",
      thinking_level: "low",
      owner_id: "11111111-1111-4111-8111-111111111111",
      skills: [],
      created_at: "2026-08-04T11:00:00Z",
      updated_at: "2026-08-04T12:00:00Z",
      archived_at: "2026-08-04T12:00:00Z",
      archived_by: "11111111-1111-4111-8111-111111111111",
    };
    queryClient.setQueryData(["agents", CTX.workspaceId, SESSION_KEY], [archived]);

    applyRealtimeEvent(
      queryClient,
      CTX,
      asEvent({ type: "agent:archived", payload: { agent: archived } }),
    );

    expect(
      queryClient.getQueryData(["agents", CTX.workspaceId, SESSION_KEY]),
    ).toEqual([]);
  });

  it("member:removed removes the participant from the members cache", () => {
    const user = {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Member",
      email: "member@example.com",
      avatar_url: null,
      language: "en",
      timezone: "UTC",
      onboarded_at: "2026-08-04T12:00:00Z",
      onboarding_questionnaire: {},
      starter_content_state: "complete",
      profile_description: "",
      created_at: "2026-08-04T12:00:00Z",
      updated_at: "2026-08-04T12:00:00Z",
    };
    const member = {
      id: "member-1",
      user,
      role: "member",
      created_at: "2026-08-04T12:00:00Z",
    };
    queryClient.setQueryData(["members", CTX.workspaceId, SESSION_KEY], [member]);

    applyRealtimeEvent(
      queryClient,
      CTX,
      asEvent({ type: "member:removed", payload: { member, user } }),
    );

    expect(
      queryClient.getQueryData(["members", CTX.workspaceId, SESSION_KEY]),
    ).toEqual([]);
  });

  it("workspace:updated invalidates the active backend's workspace query only", () => {
    const matchingKey = ["workspaces", BACKEND_ORIGIN, SESSION_KEY] as const;
    const otherBackendKey = ["workspaces", "https://other.example", SESSION_KEY] as const;
    queryClient.setQueryDefaults(matchingKey, { staleTime: Infinity });
    queryClient.setQueryDefaults(otherBackendKey, { staleTime: Infinity });
    queryClient.setQueryData(matchingKey, []);
    queryClient.setQueryData(otherBackendKey, []);

    expect(queryClient.getQueryState(matchingKey)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(otherBackendKey)?.isInvalidated).toBe(false);

    applyRealtimeEvent(
      queryClient,
      CTX,
      asEvent({
        type: "workspace:updated",
        payload: {
          workspace: {
            id: CTX.workspaceId,
            name: "Acme",
            slug: "acme",
            description: null,
            context: null,
            settings: {},
            repos: [],
            issue_prefix: "ACME",
            avatar_url: null,
            created_at: "2026-08-04T12:00:00Z",
            updated_at: "2026-08-04T12:00:00Z",
          },
        },
      }),
    );

    expect(queryClient.getQueryState(matchingKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherBackendKey)?.isInvalidated).toBe(false);
  });

  it("does not touch a separate workspace's cache", () => {
    const otherWorkspace = "ws-other";
    const otherList = [
      issue({ id: "issue-A", workspace_id: otherWorkspace }),
    ];
    queryClient.setQueryData(["issues", otherWorkspace, SESSION_KEY], otherList);
    const incoming = issue({ id: "issue-B" });
    applyRealtimeEvent(
      queryClient,
      CTX,
      asEvent({ type: "issue:created", payload: { issue: incoming } }),
    );
    const list = queryClient.getQueryData(["issues", otherWorkspace, SESSION_KEY]) as WireIssue[];
    expect(list).toEqual(otherList);
  });

  it("no-ops gracefully when the cache key is missing", () => {
    const incoming = comment({ id: "c-1" });
    expect(() =>
      applyRealtimeEvent(
        queryClient,
        CTX,
        asEvent({ type: "comment:created", payload: {
          comment: incoming,
          issue_title: "ACME-1",
          issue_assignee_type: null,
          issue_assignee_id: null,
          issue_status: "todo",
        } }),
      ),
    ).not.toThrow();
  });
});
