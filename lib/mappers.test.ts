/**
 * Mapper unit tests.
 *
 * Source of truth: the redacted wire fixtures under
 * `docs/contracts/fixtures/*.json`. Each test exercises either a
 * verbatim fixture or a deliberate mutation that simulates a future
 * server change (unknown enum, missing optional field, malformed
 * required field).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { MappingError, mapAgent, mapComment, mapIssue, mapUser, mapWorkspace } from "./mappers";

const FIXTURES = join(process.cwd(), "docs/contracts/fixtures");

function loadFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf-8")) as T;
}

describe("mapUser", () => {
  it("maps the redacted user-response fixture verbatim", () => {
    const view = mapUser(loadFixture("user-response.json"));
    expect(view).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
      name: "Sample User",
      email: "user@example.test",
      avatarUrl: null,
    });
  });

  it("accepts a missing optional avatar_url", () => {
    const fixture = loadFixture<Record<string, unknown>>("user-response.json");
    const { avatar_url: _drop, ...rest } = fixture;
    void _drop;
    expect(() => mapUser(rest)).not.toThrow();
  });

  it("throws when a required field is missing", () => {
    const fixture = loadFixture<Record<string, unknown>>("user-response.json");
    expect(() => mapUser({ ...fixture, email: undefined })).toThrow(MappingError);
  });

  it("throws when the input is not an object", () => {
    expect(() => mapUser(null)).toThrow(MappingError);
    expect(() => mapUser("nope")).toThrow(MappingError);
  });
});

describe("mapWorkspace", () => {
  it("maps the redacted workspace-response fixture", () => {
    const view = mapWorkspace(loadFixture("workspace-response.json"));
    expect(view).toMatchObject({
      id: "22222222-2222-4222-8222-222222222222",
      slug: "sample",
      issuePrefix: "SAM",
      description: "Workspace used for Slack-UI contract fixtures.",
    });
    expect(view.createdAt).toBeInstanceOf(Date);
    expect(view.createdAt.toISOString()).toBe("2026-07-01T12:00:00.000Z");
  });
});

describe("mapIssue", () => {
  it("maps the redacted issue-response fixture", () => {
    const view = mapIssue(loadFixture("issue-response.json"));
    expect(view).toMatchObject({
      id: "33333333-3333-4333-8333-333333333333",
      workspaceId: "22222222-2222-4222-8222-222222222222",
      number: 42,
      identifier: "SAM-42",
      title: "Build Slack-style channel sidebar",
      status: "in_progress",
      priority: "high",
      hasUnknownStatus: false,
      hasUnknownPriority: false,
    });
    expect(view.assignee).toEqual({
      type: "agent",
      id: "55555555-5555-4555-8555-555555555555",
    });
    expect(view.creator).toEqual({
      type: "member",
      id: "11111111-1111-4111-8111-111111111111",
    });
    expect(view.position).toBe(-2);
    expect(view.dueDate).toBeNull();
    expect(view.startDate).toBeNull();
  });

  it("flags unknown future status values", () => {
    const fixture = loadFixture<Record<string, unknown>>("issue-response.json");
    expect(() => mapIssue({ ...fixture, status: "icebox" })).not.toThrow();
    const view = mapIssue({ ...fixture, status: "icebox" });
    expect(view.status).toBe("icebox");
    expect(view.hasUnknownStatus).toBe(true);
  });

  it("flags unknown future priority values", () => {
    const fixture = loadFixture<Record<string, unknown>>("issue-response.json");
    const view = mapIssue({ ...fixture, priority: "p0" });
    expect(view.priority).toBe("p0");
    expect(view.hasUnknownPriority).toBe(true);
  });

  it("parses start_date and due_date as UTC calendar dates", () => {
    const fixture = loadFixture<Record<string, unknown>>("issue-response.json");
    const view = mapIssue({ ...fixture, start_date: "2026-08-01", due_date: "2026-08-15" });
    expect(view.startDate?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(view.dueDate?.toISOString()).toBe("2026-08-15T00:00:00.000Z");
  });

  it("rejects a malformed date", () => {
    const fixture = loadFixture<Record<string, unknown>>("issue-response.json");
    expect(() => mapIssue({ ...fixture, due_date: "soon" })).toThrow(MappingError);
  });

  it("never collapses assignee_type and assignee_id", () => {
    const fixture = loadFixture<Record<string, unknown>>("issue-response.json");
    expect(() => mapIssue({ ...fixture, assignee_type: null, assignee_id: "still-here" })).toThrow(
      MappingError,
    );
    expect(() =>
      mapIssue({ ...fixture, assignee_type: "robot", assignee_id: "uuid" }),
    ).toThrow(MappingError);
  });

  it("rejects missing required title", () => {
    const fixture = loadFixture<Record<string, unknown>>("issue-response.json");
    expect(() => mapIssue({ ...fixture, title: undefined })).toThrow(MappingError);
  });

  it("rejects missing identifier", () => {
    const fixture = loadFixture<Record<string, unknown>>("issue-response.json");
    expect(() => mapIssue({ ...fixture, identifier: undefined })).toThrow(MappingError);
  });
});

describe("mapComment", () => {
  it("maps the redacted comment-response fixture", () => {
    const view = mapComment(loadFixture("comment-response.json"));
    expect(view).toMatchObject({
      id: "44444444-4444-4444-8444-444444444444",
      issueId: "33333333-3333-4333-8333-333333333333",
      type: "comment",
      parentId: null,
      content: "What's the rough ETA on the sidebar layout?",
    });
    expect(view.author).toEqual({
      type: "member",
      id: "11111111-1111-4111-8111-111111111111",
    });
    expect(view.resolvedAt).toBeNull();
    expect(view.reactions).toEqual([]);
    expect(view.attachments).toEqual([]);
  });

  it("rejects a missing content body", () => {
    const fixture = loadFixture<Record<string, unknown>>("comment-response.json");
    expect(() => mapComment({ ...fixture, content: undefined })).toThrow(MappingError);
  });

  it("flags missing reactions/attachments arrays as empty (server may omit)", () => {
    const fixture = loadFixture<Record<string, unknown>>("comment-response.json");
    const { reactions: _r, attachments: _a, ...rest } = fixture;
    void _r;
    void _a;
    const view = mapComment(rest);
    expect(view.reactions).toEqual([]);
    expect(view.attachments).toEqual([]);
  });
});

describe("mapAgent", () => {
  it("maps the redacted agent-response fixture", () => {
    const view = mapAgent(loadFixture("agent-response.json"));
    expect(view).toMatchObject({
      id: "55555555-5555-4555-8555-555555555555",
      workspaceId: "22222222-2222-4222-8222-222222222222",
      name: "Helper",
      status: "working",
      hasUnknownStatus: false,
      avatarUrl: null,
      archivedAt: null,
    });
  });

  it("maps an empty status to the explicit-unknown path", () => {
    const fixture = loadFixture<Record<string, unknown>>("agent-response.json");
    const view = mapAgent({ ...fixture, status: "" });
    expect(view.status).toBe("");
    expect(view.hasUnknownStatus).toBe(false);
  });

  it("flags unknown future status values without throwing", () => {
    const fixture = loadFixture<Record<string, unknown>>("agent-response.json");
    const view = mapAgent({ ...fixture, status: "training" });
    expect(view.status).toBe("training");
    expect(view.hasUnknownStatus).toBe(true);
  });
});
