/**
 * Multica wire + UI types.
 *
 * This file is the single TypeScript source of truth for everything the
 * browser exchanges with the Multica backend. The shapes are derived
 * verbatim from `docs/contracts/multica-api.md` (refreshed against Multica
 * `a06fc273`); the illustrative examples in `AGENTS.md` are hypotheses only
 * and intentionally do NOT inform these types.
 *
 * Conventions
 * -----------
 * 1. Every wire type lives in the `Wire*` namespace and mirrors the
 *    confirmed REST / WS field names byte-for-byte. UI components must
 *    never read wire types directly — use the `*View` types in the same
 *    file or the result of `lib/mappers.ts` instead.
 * 2. Wire timestamps are RFC 3339 UTC strings; wire dates are `YYYY-MM-DD`.
 *    UI types normalise these to `Date` objects in one place.
 * 3. Discriminated unions (`IssueStatus`, `IssuePriority`, `AuthorType`,
 *    `AssigneeType`, `AgentStatus`) are *closed* on the wire side. The
 *    `Wire*Unknown` companion types capture future server values so the
 *    mapper can flag, but never silently coerce, an unknown value.
 * 4. Identifiers are UUIDv4 strings. Issue identifiers (`SAM-42`) are
 *    separate from issue IDs; both are present in the wire response.
 * 5. Anything `null` on the wire is `T | null` here. Anything `undefined`
 *    on the wire (i.e. omitted) is `T | undefined` here.
 */

import type {
  AgentRuntimeMode,
  AgentStatus,
  AgentVisibility,
  AssigneeType,
  AuthorType,
  IssuePriority,
  IssueStatus,
} from "./enums";

// ---------------------------------------------------------------------------
// Identifiers and primitives
// ---------------------------------------------------------------------------

export type Uuid = string;

/** Human-readable issue identifier (`<prefix>-<int>`). */
export type IssueIdentifier = string;

/** RFC 3339 UTC timestamp. Multica never emits sub-second precision. */
export type IsoTimestamp = string;

/** `YYYY-MM-DD` calendar date (no time). */
export type IsoDate = string;

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * `POST /auth/verify-code` response. The JWT may be carried either
 * through the `Authorization` header (preferred for our session) or as
 * the HttpOnly `multica_auth` cookie. Stage 2 uses the in-memory token
 * path so the OAuth and API-key flows share one session shape.
 */
export interface WireAuthVerifyCodeResponse {
  token: string;
  user: WireUser;
}

/**
 * `POST /auth/send-code` request body. The endpoint returns 200 with an
 * empty body on dispatch and 429 when the user has requested another
 * code inside the last minute.
 */
export interface WireSendCodeRequest {
  email: string;
}

/** `POST /auth/verify-code` request body. */
export interface WireVerifyCodeRequest {
  email: string;
  code: string;
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

export interface WireWorkspace {
  id: Uuid;
  name: string;
  slug: string;
  description: string | null;
  context: unknown | null;
  settings: Record<string, unknown>;
  repos: unknown[];
  issue_prefix: string;
  avatar_url: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

export interface WireIssue {
  id: Uuid;
  workspace_id: Uuid;
  number: number;
  identifier: IssueIdentifier;
  title: string;
  description: string | null;
  status: IssueStatus | WireUnknownEnum;
  priority: IssuePriority | WireUnknownEnum;
  assignee_type: AssigneeType | null;
  assignee_id: Uuid | null;
  creator_type: AuthorType;
  creator_id: Uuid;
  parent_issue_id: Uuid | null;
  project_id: Uuid | null;
  position: number;
  stage: number | null;
  start_date: IsoDate | null;
  due_date: IsoDate | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
  metadata: Record<string, unknown>;
  reactions?: WireReaction[];
  attachments?: WireAttachment[];
  labels?: unknown;
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export interface WireComment {
  id: Uuid;
  issue_id: Uuid;
  author_type: AuthorType;
  author_id: Uuid;
  content: string;
  /** Currently always `"comment"`, reserved for future subtypes. */
  type: "comment" | string;
  parent_id: Uuid | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
  resolved_at: IsoTimestamp | null;
  resolved_by_type: AuthorType | null;
  resolved_by_id: Uuid | null;
  source_task_id: Uuid | null;
  reactions: WireReaction[];
  attachments: WireAttachment[];
  /** Present only when the caller asked for `?summary=true`. */
  reply_count?: number | null;
  /** Present only when the caller asked for `?summary=true`. */
  last_activity_at?: IsoTimestamp | null;
  /** Present only when the caller asked for `?summary=true`. */
  content_truncated?: boolean | null;
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export interface WireAgent {
  id: Uuid;
  workspace_id: Uuid;
  runtime_id: string;
  name: string;
  description: string;
  instructions: string;
  avatar_url: string | null;
  runtime_mode: AgentRuntimeMode | string;
  runtime_config: Record<string, unknown>;
  custom_args: unknown[];
  mcp_config: Record<string, unknown>;
  has_custom_env: boolean;
  custom_env_key_count: number;
  mcp_config_redacted: boolean;
  visibility: AgentVisibility | string;
  status: AgentStatus | "" | WireUnknownEnum;
  max_concurrent_tasks: number;
  model: string;
  thinking_level: string;
  owner_id: Uuid;
  skills: { name: string; enabled?: boolean }[];
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
  archived_at: IsoTimestamp | null;
  archived_by: Uuid | null;
}

// ---------------------------------------------------------------------------
// Members / users
// ---------------------------------------------------------------------------

export interface WireUser {
  id: Uuid;
  name: string;
  email: string;
  avatar_url: string | null;
  language: string;
  timezone: string;
  onboarded_at: IsoTimestamp;
  onboarding_questionnaire: Record<string, unknown>;
  starter_content_state: string;
  profile_description: string;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/**
 * Workspace members are returned with an embedded user profile (no
 * separate `MemberResponse` shape).
 */
export interface WireWorkspaceMember {
  id: Uuid;
  user: WireUser;
  role: string;
  created_at: IsoTimestamp;
}

// ---------------------------------------------------------------------------
// Reactions + attachments
// ---------------------------------------------------------------------------

export interface WireReaction {
  id: Uuid;
  comment_id?: Uuid;
  issue_id?: Uuid;
  actor_type: AuthorType;
  actor_id: Uuid;
  emoji: string;
  created_at: IsoTimestamp;
}

export interface WireAttachment {
  id: Uuid;
  workspace_id: Uuid;
  issue_id: Uuid | null;
  comment_id: Uuid | null;
  uploader_type: AuthorType;
  uploader_id: Uuid;
  filename: string;
  url: string;
  download_url: string;
  markdown_url: string;
  content_type: string;
  size_bytes: number;
  created_at: IsoTimestamp;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Multica error envelope. The only stable discriminator is the HTTP
 * status — there is no machine-readable error code field. See §1.4 of
 * `docs/contracts/multica-api.md`.
 */
export interface WireError {
  error: string;
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

/**
 * Frame envelope for `/ws`. Both directions are `{ type, payload }`.
 *
 * The first inbound frame after a bearer-only handshake MUST be
 * `{ type: "auth", payload: { token } }`; the server replies with
 * `auth_ack` (or `auth_error` and closes).
 */
export interface WireWsFrame<T extends string = string, P = unknown> {
  type: T;
  payload: P;
}

export interface WireWsAuthFrame {
  type: "auth";
  payload: { token: string };
}
export interface WireWsAuthAck {
  type: "auth_ack";
  payload: Record<string, never>;
}
export interface WireWsAuthError {
  type: "auth_error";
  payload: { error: string };
}
export interface WireWsSubscribeFrame {
  type: "subscribe";
  payload: { scope: "workspace" | "user" | "task" | "chat"; id: string };
}
export interface WireWsUnsubscribeFrame {
  type: "unsubscribe";
  payload: { scope: "workspace" | "user" | "task" | "chat"; id: string };
}
export interface WireWsPingFrame {
  type: "ping";
  payload: Record<string, never>;
}
export interface WireWsPongFrame {
  type: "pong";
  payload: Record<string, never>;
}

/**
 * Discriminated union of every server-pushed event the MVP subscribes to.
 * See `docs/contracts/multica-api.md` §7.3 for the full list and §7.4
 * for activity-notice semantics.
 */
export type WireWsServerEvent =
  | WireWsAuthAck
  | WireWsAuthError
  | WireWsPongFrame
  | WireWsFrame<"subscribe_ack", { scope: string; id: string }>
  | WireWsFrame<"unsubscribe_ack", { scope: string; id: string }>
  | WireWsFrame<"subscribe_error", { scope: string; id: string; error: string }>
  | WireWsFrame<"issue:created", { issue: WireIssue }>
  | WireWsFrame<"issue:updated", { issue: WireIssue }>
  | WireWsFrame<"issue:deleted", { issue_id: Uuid }>
  | WireWsFrame<
      "comment:created",
      {
        comment: WireComment;
        issue_title: string;
        issue_assignee_type: AssigneeType | null;
        issue_assignee_id: Uuid | null;
        issue_status: IssueStatus | WireUnknownEnum;
      }
    >
  | WireWsFrame<"comment:updated", { comment: WireComment }>
  | WireWsFrame<"comment:deleted", { comment_id: Uuid }>
  | WireWsFrame<"comment:resolved", { comment: WireComment }>
  | WireWsFrame<"comment:unresolved", { comment: WireComment }>
  | WireWsFrame<"reaction:added", { reaction: WireReaction; comment_id: Uuid }>
  | WireWsFrame<"reaction:removed", { reaction: WireReaction; comment_id: Uuid }>
  | WireWsFrame<"issue_reaction:added", { reaction: WireReaction; issue_id: Uuid }>
  | WireWsFrame<"issue_reaction:removed", { reaction: WireReaction; issue_id: Uuid }>
  | WireWsFrame<"agent:status", { agent: WireAgent }>
  | WireWsFrame<"agent:archived", { agent: WireAgent }>
  | WireWsFrame<"agent:restored", { agent: WireAgent }>
  | WireWsFrame<"member:added", { member: WireWorkspaceMember; user: WireUser }>
  | WireWsFrame<"member:updated", { member: WireWorkspaceMember; user: WireUser }>
  | WireWsFrame<"member:removed", { member: WireWorkspaceMember; user: WireUser }>
  | WireWsFrame<"workspace:updated", { workspace: WireWorkspace }>
  | WireWsFrame<string, unknown>; // Catch-all so the manager logs unknown events instead of throwing.

/** Sentinel for any future enum value the server may emit. */
export type WireUnknownEnum = "__unknown__";

// ---------------------------------------------------------------------------
// UI types — the projection components consume these.
// ---------------------------------------------------------------------------

export interface IssueView {
  id: Uuid;
  workspaceId: Uuid;
  number: number;
  identifier: IssueIdentifier;
  title: string;
  description: string | null;
  status: IssueStatus | string;
  priority: IssuePriority | string;
  /** Whether the status was a known value at the time of mapping. */
  hasUnknownStatus: boolean;
  /** Whether the priority was a known value at the time of mapping. */
  hasUnknownPriority: boolean;
  assignee: AssigneeView | null;
  creator: ParticipantRef;
  parentIssueId: Uuid | null;
  projectId: Uuid | null;
  position: number;
  stage: number | null;
  startDate: Date | null;
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CommentView {
  id: Uuid;
  issueId: Uuid;
  author: ParticipantRef;
  content: string;
  type: string;
  parentId: Uuid | null;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  resolvedBy: ParticipantRef | null;
  sourceTaskId: Uuid | null;
  reactions: ReactionView[];
  attachments: AttachmentView[];
}

export interface AgentView {
  id: Uuid;
  workspaceId: Uuid;
  name: string;
  description: string;
  status: AgentStatus | string;
  hasUnknownStatus: boolean;
  avatarUrl: string | null;
  archivedAt: Date | null;
  updatedAt: Date;
}

export interface WorkspaceView {
  id: Uuid;
  name: string;
  slug: string;
  description: string | null;
  issuePrefix: string;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserView {
  id: Uuid;
  name: string;
  email: string;
  avatarUrl: string | null;
}

export interface AssigneeView {
  type: AssigneeType;
  id: Uuid;
}

export interface ParticipantRef {
  type: AuthorType;
  id: Uuid;
}

export interface ReactionView {
  id: Uuid;
  emoji: string;
  actor: ParticipantRef;
  createdAt: Date;
}

export interface AttachmentView {
  id: Uuid;
  filename: string;
  contentType: string;
  sizeBytes: number;
  /** Short-lived signed URL. Refresh on cache miss. */
  downloadUrl: string;
  /** Durable absolute URL safe to embed in markdown bodies. */
  markdownUrl: string;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/**
 * The unified session source. Both OAuth and API-key sign-in feed the
 * same shape so the rest of the app never branches on auth source.
 *
 * The credential lives in browser-side storage keyed by the backend
 * origin; the OAuth JWT also rides the `multica_auth` HttpOnly cookie
 * set by the server. Stage 2 only reads the in-memory copy.
 */
export type AuthSource = "oauth" | "api-key";

export interface SessionState {
  source: AuthSource;
  /** Backend origin this session belongs to (e.g. `http://localhost:8080`). */
  backendOrigin: string;
  /** Bearer credential. For OAuth this is the JWT; for API-key it is the PAT. */
  token: string;
  /** Populated after `GET /api/me`. */
  user: UserView | null;
}

export interface WorkspaceSelection {
  workspaceId: Uuid;
  workspaceSlug: string;
}
