/**
 * Wire → UI projection helpers.
 *
 * Every wire type has exactly one mapper here. The mappers:
 *
 * 1. Validate required fields. A missing required field throws
 *    `MappingError` so callers (the API client) can surface a useful
 *    diagnostic instead of silently rendering broken UI.
 * 2. Normalise timestamps (`IsoTimestamp` → `Date`) and dates
 *    (`IsoDate` → `Date`) in one place.
 * 3. Coerce unknown future enum values to the literal `"__unknown__"`
 *    sentinel and set the matching `hasUnknown*` flag on the view, so
 *    Stage 3 can render the value but mark it as not-yet-supported.
 * 4. Never collapse agent and member identity into one string — the
 *    Stage 1 contract explicitly forbids it.
 */

import {
  isAgentStatus,
  isAssigneeType,
  isAuthorType,
  isIssuePriority,
  isIssueStatus,
} from "./enums";
import type {
  AgentView,
  AssigneeView,
  AttachmentView,
  CommentView,
  IssueView,
  ParticipantRef,
  ReactionView,
  UserView,
  WireAgent,
  WireAttachment,
  WireComment,
  WireIssue,
  WireReaction,
  WireUser,
  WireWorkspace,
  WorkspaceView,
} from "./types";

export class MappingError extends Error {
  readonly path: string;
  constructor(path: string, message: string) {
    super(`MappingError at ${path}: ${message}`);
    this.name = "MappingError";
    this.path = path;
  }
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/**
 * Parse an RFC 3339 UTC timestamp from the wire into a `Date`. The
 * Multica contract guarantees UTC and no sub-second precision, but we
 * accept any valid ISO string so a slightly loose backend doesn't
 * break the UI. Required-field variant — throws `MappingError` if the
 * wire value is `null`, `undefined`, or unparseable.
 */
export function parseTimestamp(value: unknown, path: string): Date {
  if (value === null || value === undefined) {
    throw new MappingError(path, "expected ISO timestamp string, got null");
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new MappingError(path, `expected ISO timestamp string, got ${typeof value}`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new MappingError(path, `unparseable timestamp "${value}"`);
  }
  return parsed;
}

/**
 * Nullable-field variant of `parseTimestamp`. Returns `null` when the
 * wire value is `null` or `undefined`; throws on unparseable strings
 * so a server bug is still surfaced.
 */
export function parseTimestampOrNull(value: unknown, path: string): Date | null {
  if (value === null || value === undefined) return null;
  return parseTimestamp(value, path);
}

/**
 * Parse a `YYYY-MM-DD` calendar date. We pin the time to UTC midnight so
 * date arithmetic in components stays timezone-stable.
 */
export function parseDateOnly(value: unknown, path: string): Date | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new MappingError(path, `expected "YYYY-MM-DD" or null, got ${typeof value}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new MappingError(path, `unparseable date "${value}"`);
  }
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime())) {
    throw new MappingError(path, `invalid calendar date "${value}"`);
  }
  return date;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new MappingError(path, `expected string, got ${typeof value}`);
  }
  return value;
}

function optionalString(value: unknown, path: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new MappingError(path, `expected string|null, got ${typeof value}`);
  }
  return value;
}

function requireUuid(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new MappingError(path, `expected uuid string, got ${typeof value}`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Participant refs (author + assignee + creator + resolver)
// ---------------------------------------------------------------------------

function toParticipantRef(
  authorType: unknown,
  authorId: unknown,
  path: string,
): ParticipantRef {
  const type = isAuthorType(authorType)
    ? authorType
    : authorType === null || authorType === undefined
      ? null
      : null;
  if (type === null) {
    throw new MappingError(path, `unknown author_type ${String(authorType)}`);
  }
  return { type, id: requireUuid(authorId, `${path}.author_id`) };
}

function toAssignee(
  assigneeType: unknown,
  assigneeId: unknown,
  path: string,
): AssigneeView | null {
  if (assigneeType === null || assigneeType === undefined) {
    if (assigneeId !== null && assigneeId !== undefined) {
      throw new MappingError(path, "assignee_id present without assignee_type");
    }
    return null;
  }
  if (!isAssigneeType(assigneeType)) {
    throw new MappingError(path, `unknown assignee_type ${String(assigneeType)}`);
  }
  return { type: assigneeType, id: requireUuid(assigneeId, `${path}.assignee_id`) };
}

// ---------------------------------------------------------------------------
// Reactions + attachments
// ---------------------------------------------------------------------------

export function mapReaction(wire: unknown, path = "reaction"): ReactionView {
  if (typeof wire !== "object" || wire === null) {
    throw new MappingError(path, "expected object");
  }
  const r = wire as Partial<WireReaction>;
  return {
    id: requireUuid(r.id, `${path}.id`),
    emoji: requireString(r.emoji, `${path}.emoji`),
    actor: toParticipantRef(r.actor_type, r.actor_id, `${path}.actor`),
    createdAt: parseTimestamp(r.created_at, `${path}.created_at`),
  };
}

export function mapAttachment(wire: unknown, path = "attachment"): AttachmentView {
  if (typeof wire !== "object" || wire === null) {
    throw new MappingError(path, "expected object");
  }
  const a = wire as Partial<WireAttachment>;
  return {
    id: requireUuid(a.id, `${path}.id`),
    filename: requireString(a.filename, `${path}.filename`),
    contentType: requireString(a.content_type, `${path}.content_type`),
    sizeBytes:
      typeof a.size_bytes === "number" ? a.size_bytes : Number(a.size_bytes ?? 0),
    downloadUrl: requireString(a.download_url, `${path}.download_url`),
    markdownUrl: requireString(a.markdown_url, `${path}.markdown_url`),
    createdAt: parseTimestamp(a.created_at, `${path}.created_at`),
  };
}

// ---------------------------------------------------------------------------
// Top-level mappers
// ---------------------------------------------------------------------------

export function mapUser(wire: unknown, path = "user"): UserView {
  if (typeof wire !== "object" || wire === null) {
    throw new MappingError(path, "expected object");
  }
  const u = wire as Partial<WireUser>;
  return {
    id: requireUuid(u.id, `${path}.id`),
    name: requireString(u.name, `${path}.name`),
    email: requireString(u.email, `${path}.email`),
    avatarUrl: optionalString(u.avatar_url, `${path}.avatar_url`),
  };
}

export function mapWorkspace(wire: unknown, path = "workspace"): WorkspaceView {
  if (typeof wire !== "object" || wire === null) {
    throw new MappingError(path, "expected object");
  }
  const w = wire as Partial<WireWorkspace>;
  return {
    id: requireUuid(w.id, `${path}.id`),
    name: requireString(w.name, `${path}.name`),
    slug: requireString(w.slug, `${path}.slug`),
    description: optionalString(w.description, `${path}.description`),
    issuePrefix: requireString(w.issue_prefix, `${path}.issue_prefix`),
    avatarUrl: optionalString(w.avatar_url, `${path}.avatar_url`),
    createdAt: parseTimestamp(w.created_at, `${path}.created_at`),
    updatedAt: parseTimestamp(w.updated_at, `${path}.updated_at`),
  };
}

export function mapAgent(wire: unknown, path = "agent"): AgentView {
  if (typeof wire !== "object" || wire === null) {
    throw new MappingError(path, "expected object");
  }
  const a = wire as Partial<WireAgent>;
  const status = typeof a.status === "string" ? a.status : "";
  return {
    id: requireUuid(a.id, `${path}.id`),
    workspaceId: requireUuid(a.workspace_id, `${path}.workspace_id`),
    name: requireString(a.name, `${path}.name`),
    description: typeof a.description === "string" ? a.description : "",
    status,
    hasUnknownStatus: status !== "" && !isAgentStatus(status),
    avatarUrl: optionalString(a.avatar_url, `${path}.avatar_url`),
    archivedAt: parseTimestampOrNull(a.archived_at, `${path}.archived_at`),
    updatedAt: parseTimestamp(a.updated_at, `${path}.updated_at`),
  };
}

export function mapIssue(wire: unknown, path = "issue"): IssueView {
  if (typeof wire !== "object" || wire === null) {
    throw new MappingError(path, "expected object");
  }
  const i = wire as Partial<WireIssue>;
  const status = requireString(i.status, `${path}.status`);
  const priority = requireString(i.priority, `${path}.priority`);
  return {
    id: requireUuid(i.id, `${path}.id`),
    workspaceId: requireUuid(i.workspace_id, `${path}.workspace_id`),
    number: typeof i.number === "number" ? i.number : Number(i.number ?? 0),
    identifier: requireString(i.identifier, `${path}.identifier`),
    title: requireString(i.title, `${path}.title`),
    description: optionalString(i.description, `${path}.description`),
    status,
    priority,
    hasUnknownStatus: !isIssueStatus(status),
    hasUnknownPriority: !isIssuePriority(priority),
    assignee: toAssignee(i.assignee_type, i.assignee_id, `${path}.assignee`),
    creator: {
      type: isAuthorType(i.creator_type) ? i.creator_type : "member",
      id: requireUuid(i.creator_id, `${path}.creator_id`),
    },
    parentIssueId:
      i.parent_issue_id === null || i.parent_issue_id === undefined
        ? null
        : requireUuid(i.parent_issue_id, `${path}.parent_issue_id`),
    projectId:
      i.project_id === null || i.project_id === undefined
        ? null
        : requireUuid(i.project_id, `${path}.project_id`),
    position: typeof i.position === "number" ? i.position : Number(i.position ?? 0),
    stage: typeof i.stage === "number" ? i.stage : null,
    startDate: parseDateOnly(i.start_date, `${path}.start_date`),
    dueDate: parseDateOnly(i.due_date, `${path}.due_date`),
    createdAt: parseTimestamp(i.created_at, `${path}.created_at`),
    updatedAt: parseTimestamp(i.updated_at, `${path}.updated_at`),
  };
}

export function mapComment(wire: unknown, path = "comment"): CommentView {
  if (typeof wire !== "object" || wire === null) {
    throw new MappingError(path, "expected object");
  }
  const c = wire as Partial<WireComment>;
  const reactions = Array.isArray(c.reactions)
    ? c.reactions.map((r, idx) => mapReaction(r, `${path}.reactions[${idx}]`))
    : [];
  const attachments = Array.isArray(c.attachments)
    ? c.attachments.map((a, idx) => mapAttachment(a, `${path}.attachments[${idx}]`))
    : [];
  return {
    id: requireUuid(c.id, `${path}.id`),
    issueId: requireUuid(c.issue_id, `${path}.issue_id`),
    author: toParticipantRef(c.author_type, c.author_id, `${path}.author`),
    content: requireString(c.content, `${path}.content`),
    type: typeof c.type === "string" ? c.type : "comment",
    parentId:
      c.parent_id === null || c.parent_id === undefined
        ? null
        : requireUuid(c.parent_id, `${path}.parent_id`),
    createdAt: parseTimestamp(c.created_at, `${path}.created_at`),
    updatedAt: parseTimestamp(c.updated_at, `${path}.updated_at`),
    resolvedAt:
      c.resolved_at === null || c.resolved_at === undefined
        ? null
        : parseTimestamp(c.resolved_at, `${path}.resolved_at`),
    resolvedBy:
      c.resolved_at === null || c.resolved_at === undefined
        ? null
        : toParticipantRef(c.resolved_by_type, c.resolved_by_id, `${path}.resolved_by`),
    sourceTaskId:
      c.source_task_id === null || c.source_task_id === undefined
        ? null
        : requireUuid(c.source_task_id, `${path}.source_task_id`),
    reactions,
    attachments,
  };
}
