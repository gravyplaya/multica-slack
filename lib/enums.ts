/**
 * Closed enums derived from the Multica contract.
 *
 * Source of truth: `docs/contracts/multica-api.md` (issue §4.1 status
 * + priority; comment §5 author_type; issue §4.1 assignee_type; agent
 * §6.2 status / runtime_mode / visibility).
 *
 * Each enum ships:
 * - the typed union (`IssueStatus`, `IssuePriority`, ...)
 * - the literal tuple (for runtime iteration)
 * - a predicate guard (`isIssueStatus(value)`)
 *
 * Unknown future values must reach the mapper as `__unknown__` via
 * `lib/types.ts` so the UI can flag them without throwing.
 */

export const ISSUE_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled",
] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const ISSUE_PRIORITIES = ["urgent", "high", "medium", "low", "none"] as const;
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number];

export const AUTHOR_TYPES = ["member", "agent"] as const;
export type AuthorType = (typeof AUTHOR_TYPES)[number];

export const ASSIGNEE_TYPES = ["member", "agent"] as const;
export type AssigneeType = (typeof ASSIGNEE_TYPES)[number];

export const AGENT_STATUSES = ["idle", "working", "blocked"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const AGENT_RUNTIME_MODES = ["openclaw"] as const;
export type AgentRuntimeMode = (typeof AGENT_RUNTIME_MODES)[number];

export const AGENT_VISIBILITIES = ["workspace", "private"] as const;
export type AgentVisibility = (typeof AGENT_VISIBILITIES)[number];

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

const toSet = <T extends readonly string[]>(values: T): ReadonlySet<string> =>
  new Set<string>(values);

const ISSUE_STATUS_SET = toSet(ISSUE_STATUSES);
const ISSUE_PRIORITY_SET = toSet(ISSUE_PRIORITIES);
const AUTHOR_TYPE_SET = toSet(AUTHOR_TYPES);
const ASSIGNEE_TYPE_SET = toSet(ASSIGNEE_TYPES);
const AGENT_STATUS_SET = toSet(AGENT_STATUSES);

export function isIssueStatus(value: unknown): value is IssueStatus {
  return typeof value === "string" && ISSUE_STATUS_SET.has(value);
}

export function isIssuePriority(value: unknown): value is IssuePriority {
  return typeof value === "string" && ISSUE_PRIORITY_SET.has(value);
}

export function isAuthorType(value: unknown): value is AuthorType {
  return typeof value === "string" && AUTHOR_TYPE_SET.has(value);
}

export function isAssigneeType(value: unknown): value is AssigneeType {
  return typeof value === "string" && ASSIGNEE_TYPE_SET.has(value);
}

export function isAgentStatus(value: unknown): value is AgentStatus {
  return typeof value === "string" && AGENT_STATUS_SET.has(value);
}
