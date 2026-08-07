# Multica REST + WebSocket Contract

> **For the implementer:** This document is the single source of truth for everything Multica exposes to the browser. The illustrative shapes in `AGENTS.md` are hypotheses only — do **not** wire production code to them. Stage 2 models, the Stage 3 client, and the Stage 4 realtime manager all derive from this file plus the JSON fixtures in `fixtures/`.

> **Inspection basis:** All endpoints, headers, payloads, and WebSocket frames below were read directly from the Multica server source (`server/cmd/server/router.go`, `server/internal/handler/*.go`, `server/internal/middleware/auth.go`, `server/internal/realtime/hub.go`, `server/pkg/protocol/events.go`) at commit `a06fc273` on `main`. Field-level JSON tags are taken verbatim from the Go response structs (`IssueResponse`, `CommentResponse`, `AgentResponse`, `WorkspaceResponse`, `UserResponse`, `ReactionResponse`, `AttachmentResponse`). When the backend changes, refresh fixtures and bump the "Refreshed against" line below.

- **Refreshed against:** Multica `a06fc273` (2026-07-02 release branch; commit on `main`)
- **Backend minimum version:** `v0.3.35` (matches the upstream changelog entry from PR #4856)
- **Browser origin(s) allowed by CORS:** `http://localhost:3000` (Next.js dev) — extend via `CORS_ALLOWED_ORIGINS` or `FRONTEND_ORIGIN` env on the backend.

---

## 1. Conventions

### 1.1 Base URLs

| Channel | Default | Override |
| --- | --- | --- |
| REST | `http://localhost:8080` | `NEXT_PUBLIC_MULTICA_API` |
| WebSocket | `ws://localhost:8080/ws` | `NEXT_PUBLIC_MULTICA_WS` |

The default Next.js dev origin (`http://localhost:3000`) is allowed by the backend CORS list. Production deployments must set `CORS_ALLOWED_ORIGINS` (comma-separated) on the Multica server before pointing a public browser origin at it. The client config module promotes `ws://` → `wss://` automatically when `NEXT_PUBLIC_MULTICA_API` is an `https://` origin, so a TLS backend never receives a mixed-content WebSocket handshake; local self-host (`http://` + `ws://`) is left unchanged.

### 1.2 Headers

All authenticated requests carry **both**:

- `Authorization: Bearer <token>` — JWT (interactive login) or PAT (`mul_` prefix).
- One of:
  - `X-Workspace-Slug: <slug>` — preferred; the modern web frontend convention.
  - `X-Workspace-ID: <uuid>` — CLI / daemon compat.

For cookie-based sessions (browser OAuth/code login), `Authorization` is omitted; the `multica_auth` HttpOnly cookie carries the JWT. State-changing requests must additionally send `X-CSRF-Token: <csrf cookie value>` (the `multica_csrf` cookie is readable, so the browser can echo it back). PATs do not require a CSRF token because they don't ride on a cookie.

Optional metadata that the backend logs with every request:

- `X-Client-Platform`, `X-Client-Version`, `X-Client-OS` — used for telemetry + targeted compat warnings.

### 1.3 Authenticated vs public

- **Public (no auth):** `GET /health`, `GET /readyz`, `GET /api/config`, `POST /auth/send-code`, `POST /auth/verify-code`, `POST /auth/google`, `POST /auth/logout` (idempotent), webhook ingress paths.
- **Authenticated, user-scoped:** `GET /api/me`, `PATCH /api/me`, attachment downloads (`GET /api/attachments/{id}/download`), invitations, cloud billing, token management.
- **Authenticated, workspace-scoped:** issues, comments, projects, agents, squads, dashboards, runtimes, workspace members — anything under the `RequireWorkspaceMember` group.
- **Daemon-only:** `/api/daemon/*` (uses an `mat_` task token bound to a single workspace).

### 1.4 Error envelope

All non-2xx responses return JSON of the form `{"error": "<human readable>"}`. Some 4xx responses also carry the bare field name as the message (e.g. `{"error":"invalid status \"foo\"; valid values: backlog, todo, in_progress, in_review, done, blocked, cancelled"}`). There is **no** machine-readable error code field — the only stable discriminator is the HTTP status:

- `400` — validation (missing required field, bad enum, malformed UUID).
- `401` — missing/invalid token.
- `403` — authed but not a workspace member / not authorised for the action (CSRF failure surfaces here too).
- `404` — workspace slug unknown (distinct from "no identifier supplied" which is `400`).
- `409` / `422` — rare; used for state-machine conflicts.
- `429` — auth rate limit hit.
- `503` — cloud verifier temporarily unavailable (mcn_ tokens).

### 1.5 Timestamps

Every timestamp field is an RFC 3339 string in UTC (format `2006-01-02T15:04:05Z07:00` from Go's reference layout). The server never emits sub-second precision. Date-only fields (issue `start_date` / `due_date`) are `"YYYY-MM-DD"`.

### 1.6 Identifiers

- All IDs are UUIDv4 strings, lowercase, hyphenated.
- Issue identifiers (human-readable) are `<issue_prefix>-<int>` — e.g. `MUL-123`. The prefix is per-workspace and returned on `GET /api/workspaces/{id}`.
- Slugs are lowercase, URL-safe, immutable per workspace.

---

## 2. Authentication (Stage 2 will consume this section verbatim)

### 2.1 Email code login — interactive browser flow

`POST /auth/send-code`

```json
{ "email": "user@example.com" }
```

Response: `200 OK` (empty body) when the code is dispatched. `429` when the user requested another code in the last 60 seconds.

`POST /auth/verify-code`

```json
{ "email": "user@example.com", "code": "123456" }
```

Response: `200 OK` with the JWT + user profile; the backend **also** sets:

- `Set-Cookie: multica_auth=<jwt>; HttpOnly; SameSite=Strict; Path=/`
- `Set-Cookie: multica_csrf=<hmac(nonce, jwt)>; SameSite=Strict; Path=/`

The response body is `{ "token": "<jwt>", "user": <UserResponse> }`. The browser may either keep the JWT in memory (use the `Authorization` header for every call and rely on cookies for image loads) or treat the cookie as authoritative. **Stage 2 will use the JWT-in-memory path** so the same session source also supports PAT sign-in.

### 2.2 Personal Access Token (PAT)

Issued via `POST /api/tokens`. The token has the prefix `mul_`. The user-facing creation response returns the raw token once; the API only stores the SHA-256 hash after that. PATs work for both REST and the WebSocket handshake (see §7).

### 2.3 Sign-out

`POST /auth/logout` is idempotent. The browser also clears the local PAT session source on user action. The server clears both cookies.

### 2.4 Verifying "who am I"

`GET /api/me` returns the `UserResponse` for the authenticated user. This is the canonical "session is valid" probe — Stage 2 calls it on app load and after both OAuth + PAT sign-in to confirm the credential still works before showing the workspace picker.

---

## 3. Workspaces

| Endpoint | Notes |
| --- | --- |
| `GET /api/workspaces/` | List every workspace the caller is a member of. No workspace header needed (auth-only). |
| `POST /api/workspaces/` | Create a workspace. Reserved for self-hosted where `DISABLE_WORKSPACE_CREATION != "true"`. |
| `GET /api/workspaces/{id}/` | One workspace. Requires membership. |
| `GET /api/workspaces/{id}/members` | Members with embedded user object (see §6). |

The `WorkspaceResponse` shape:

```json
{
  "id": "5b1f…",
  "name": "Acme",
  "slug": "acme",
  "description": "Main workspace",
  "context": null,
  "settings": {},
  "repos": [],
  "issue_prefix": "MUL",
  "avatar_url": null,
  "created_at": "2026-07-01T12:00:00Z",
  "updated_at": "2026-07-01T12:00:00Z"
}
```

`settings` and `repos` are JSON-typed — `settings` is always an object (possibly empty), `repos` is always an array (possibly empty). Treat them as opaque on the client.

---

## 4. Issues (channels)

| Endpoint | Purpose | MVP? |
| --- | --- | --- |
| `GET /api/issues/` | List issues visible to the caller in the current workspace. Supports `?project_id=…`, `?status=…`, `?assignee_type=…`, `?assignee_id=…`, `?parent_issue_id=…`, `?stage=…` filters. | ✅ |
| `GET /api/issues/grouped` | Issues bucketed by parent + stage. Useful for a Slack-like sidebar grouping. | ✅ (later) |
| `GET /api/issues/{id}/` | Single issue detail. | ✅ |
| `POST /api/issues/` | Create. Stage 2 will expose "create channel" behind a button. | ✅ |
| `POST /api/issues/quick-create` | Lighter-weight creation flow used by the issue composer. | (Stage 3) |
| `POST /api/issues/{id}/rerun` | Re-trigger an agent on the issue. | out of scope |
| `POST /api/issues/{id}/comments` | Append a comment (the message-send path). | ✅ |
| `GET /api/issues/{id}/comments` | Threaded comments (see §5). | ✅ |
| `GET /api/issues/{id}/timeline` | Activity feed (status/assignee/system events). | ✅ (for activity notices) |
| `POST /api/issues/{id}/reactions`, `DELETE /api/issues/{id}/reactions` | Issue-level reactions. | (Stage 3) |
| `GET /api/issues/{id}/attachments` | Issue-level attachments (cover images, etc). | ✅ |
| `GET /api/issues/{id}/children` | Sub-issues. | (sidebar grouping) |
| `GET /api/issues/search` | Free-text search. | (Stage 3) |

### 4.1 `IssueResponse` (channel representation)

Confirmed from `handler/issue.go` `IssueResponse` struct:

```json
{
  "id": "uuid",
  "workspace_id": "uuid",
  "number": 123,
  "identifier": "MUL-123",
  "title": "Ship Slack UI shell",
  "description": null,
  "status": "in_progress",
  "priority": "high",
  "assignee_type": "agent",          // "member" | "agent" | null
  "assignee_id": "uuid",
  "creator_type": "member",
  "creator_id": "uuid",
  "parent_issue_id": null,
  "project_id": null,
  "position": -2.0,                  // float; ordering inside status column
  "stage": 1,                        // int | null — sub-issue stage
  "start_date": null,                // "YYYY-MM-DD" when set
  "due_date": null,
  "created_at": "2026-07-15T09:00:00Z",
  "updated_at": "2026-07-15T09:00:00Z",
  "metadata": {},                    // always an object; never null
  "reactions": [...],                // omitted on UpdateIssue + WS broadcasts
  "attachments": [...],              // omitted on UpdateIssue + WS broadcasts
  "labels": null                     // omitted unless the response path loaded labels
}
```

**Status** is one of: `backlog`, `todo`, `in_progress`, `in_review`, `done`, `blocked`, `cancelled`.

**Priority** is one of: `urgent`, `high`, `medium`, `low`, `none`.

**Assignee** has two distinct shapes — `assignee_type: "member"` / `"agent"` with the matching `assignee_id` UUID. Stage 3 will resolve the UUID against `/api/workspaces/{id}/members` (humans) and `/api/agents/` (agents) to render the participant chip. **Never** collapse these into a single string on the client.

### 4.2 Issue list query parameters (confirmed)

| Param | Type | Notes |
| --- | --- | --- |
| `status` | enum string (repeatable) | Filter by one or more statuses. |
| `assignee_id` | uuid (repeatable) | Filter by assignee. |
| `assignee_type` | enum string | `member` or `agent`. Pair with `assignee_id`. |
| `project_id` | uuid | Restrict to a project. |
| `parent_issue_id` | uuid | Restrict to children of one parent. |
| `stage` | int | Restrict to a stage under a parent. |
| `limit`, `offset` | int | Standard pagination. **Defaults NOT confirmed against a live backend yet** — see §4.3. |

### 4.3 Unconfirmed pagination defaults

Pagination defaults for `limit`/`offset` on `GET /api/issues/` are derived from upstream behaviour, not read verbatim from the router. Treat them as **unconfirmed** until verified against a seeded local Multica instance. Until then:

- `lib/api/issues.ts` (Stage 2) must declare its own `ISSUES_PAGE_SIZE` constant with a comment pointing at this section.
- The sidebar (Stage 3) must call `limit=` explicitly rather than relying on a server default.
- Once verified, bump this entry into §4.2 as **confirmed** and remove this note.

---

## 5. Comments (messages)

| Endpoint | Purpose |
| --- | --- |
| `GET /api/issues/{id}/comments` | Threaded listing. Supports `?thread=root_id`, `?summary=true`, `?fold=true`. |
| `POST /api/issues/{id}/comments` | Create a top-level comment. Body: `{ content: string, parent_id?: string, attachment_ids?: string[], preview_only?: bool }`. |
| `PUT /api/comments/{commentId}` | Edit the comment body. Author-only. |
| `DELETE /api/comments/{commentId}` | Soft-delete. |
| `POST /api/comments/{commentId}/resolve`, `DELETE /api/comments/{commentId}/resolve` | Mark thread resolved / unresolved. |
| `POST /api/comments/{commentId}/reactions`, `DELETE …` | Comment-level reactions. |

### 5.1 `CommentResponse` (message representation)

```json
{
  "id": "uuid",
  "issue_id": "uuid",
  "author_type": "member",           // "member" | "agent"
  "author_id": "uuid",
  "content": "Body — markdown safe, no HTML injection.",
  "type": "comment",                 // future-proof discriminator
  "parent_id": null,                 // uuid when this is a reply
  "created_at": "2026-07-15T09:01:00Z",
  "updated_at": "2026-07-15T09:01:00Z",
  "resolved_at": null,
  "resolved_by_type": null,
  "resolved_by_id": null,
  "source_task_id": null,            // populated when emitted by a task
  "reactions": [],
  "attachments": [],
  "reply_count": null,               // present only under summary=true
  "last_activity_at": null,          // present only under summary=true
  "content_truncated": null          // present only under summary=true
}
```

`type` is currently always `"comment"` but reserved for future subtypes (status updates, system notes). Stage 3 will treat unknown `type` values as visible comments without breaking the timeline.

### 5.2 Author identity

`author_type` + `author_id` are the only reliable identity fields. The author display name is **not** embedded — the client must resolve it against `GET /api/workspaces/{id}/members` or `GET /api/agents/`. The fixtures in `fixtures/` show how to cache this lookup per session.

### 5.3 Threading

Top-level comments have `parent_id: null`. Replies carry the root comment's UUID in `parent_id`. Stage 3 will fetch the whole tree per channel — a single thread depth is sufficient for the MVP.

### 5.4 Sending

`POST /api/issues/{id}/comments`

```json
{
  "content": "Plain text body, markdown escaped server-side.",
  "parent_id": null,
  "attachment_ids": []
}
```

Response: `201 Created` with the full `CommentResponse`. The server also publishes a `comment:created` WS event (see §7) to all members of the same workspace.

---

## 6. Participants (members + agents)

### 6.1 Members

`GET /api/workspaces/{id}/members` returns member rows with embedded user profiles. The exact shape includes the `UserResponse` fields; we don't need a separate `MemberResponse` for the MVP because every consumer wants the embedded user anyway. The exact field list is the `UserResponse` from §2.

### 6.2 Agents

`GET /api/agents/` returns every agent in the current workspace. The `AgentResponse` shape is large (and contains secrets if not redacted by the backend), so the **client must** use the already-redacted view the backend emits:

- `id`, `workspace_id`, `runtime_id`, `name`, `description`, `instructions` (trimmed), `avatar_url`, `runtime_mode`, `runtime_config` (gateway tokens are masked server-side as `"***"`), `custom_args`, `mcp_config`, `has_custom_env`, `custom_env_key_count`, `mcp_config_redacted`, `visibility`, `status`, `max_concurrent_tasks`, `model`, `thinking_level`, `owner_id`, `skills` (summary only), `created_at`, `updated_at`, `archived_at`, `archived_by`.

**No field is fabricated.** `status` is one of `idle`, `working`, `blocked` (or whatever the agent's last reported status was). Presence is **only** reflected when the agent last reported; the backend does not push live presence. Stage 3 will surface an explicit "unknown" state when `status` is empty.

### 6.3 Reaction counts

`ReactionResponse` shape:

```json
{ "id": "uuid", "comment_id": "uuid", "actor_type": "member", "actor_id": "uuid", "emoji": "👍", "created_at": "..." }
```

Reactions are scoped per actor; counts are derived client-side.

---

## 7. WebSocket protocol

The single endpoint is `GET /ws` (HTTP upgrade). Query parameters are mandatory because browsers cannot set custom headers on a WebSocket handshake:

| Param | Required | Notes |
| --- | --- | --- |
| `workspace_id` | yes (one of `workspace_id`/`workspace_slug`) | UUID. |
| `workspace_slug` | alternative | Resolved server-side to the UUID. |
| `client_platform`, `client_version`, `client_os` | optional | Logged for observability. |

### 7.1 Authentication

Two ways to authenticate the handshake, in priority order:

1. **Cookie session** — if the browser has `multica_auth` set, the server uses it. Membership is checked against the workspace.
2. **First-message bearer** — if no cookie, the server expects the *very next* inbound frame to be a bearer token:
   ```json
   { "type": "auth", "payload": { "token": "<jwt or mul_PAT>" } }
   ```
   The server validates the token, verifies membership, then sends `{"type":"auth_ack"}`. Any other first frame results in a `{"type":"auth_error"}` and a socket close.

PATs (`mul_…`) work over the WS just like over REST — this is the path API-key sign-in will use.

### 7.2 Frame envelope

Both inbound and outbound frames are JSON of the form:

```json
{ "type": "<string>", "payload": { ... } }
```

Server → client frames:

| `type` | Payload shape | Trigger |
| --- | --- | --- |
| `auth_ack` | `{}` | Handshake complete (only on the bearer path). |
| `auth_error` | `{ "error": "..." }` | Handshake failed. Socket closes. |
| `pong` | `{}` | Reply to client `ping`. |
| `subscribe_ack` | `{ "scope": "workspace" \| "user" \| "task" \| "chat", "id": "..." }` | Subscribe accepted. |
| `unsubscribe_ack` | same as above | Unsubscribe accepted. |
| `subscribe_error` | `{ "scope", "id", "error": "forbidden" \| "lookup_failed" \| "unknown_scope" \| "invalid payload" }` | Subscribe rejected. |
| `<event_type>` | the published event payload (see below) | Realtime update. |

Client → server frames:

| `type` | Payload | Effect |
| --- | --- | --- |
| `subscribe` | `{ "scope": "workspace"\|"user"\|"task"\|"chat", "id": "..." }` | Join a scope. Workspace + user scopes are implicit on connect; task/chat need explicit authz. |
| `unsubscribe` | same | Leave a scope. |
| `ping` | `{}` | Heartbeat; server replies `pong`. Server also sends native WS ping frames every `pingPeriod` (default 54s); clients reply with pong. |

### 7.3 Event types the MVP subscribes to

All are workspace-scoped. Confirmed names from `pkg/protocol/events.go`:

| Event | Payload | UI action |
| --- | --- | --- |
| `issue:created` | `{ "issue": <IssueResponse> }` | Add to sidebar. |
| `issue:updated` | `{ "issue": <IssueResponse> }` | Update sidebar + open channel. |
| `issue:deleted` | `{ "issue_id": "uuid" }` | Remove from sidebar. |
| `comment:created` | `{ "comment": <CommentResponse>, "issue_title", "issue_assignee_type", "issue_assignee_id", "issue_status" }` | Append to channel timeline. |
| `comment:updated` | `{ "comment": <CommentResponse> }` | Refresh message body. |
| `comment:deleted` | `{ "comment_id": "uuid" }` | Remove message from timeline. |
| `comment:resolved` | `{ "comment": <CommentResponse> }` | Mark thread visually resolved. |
| `comment:unresolved` | same | Mark thread visually re-opened. |
| `reaction:added` / `reaction:removed` | `{ "reaction": <ReactionResponse>, "comment_id" }` | Update counts. |
| `issue_reaction:added` / `issue_reaction:removed` | `{ "reaction": <IssueReactionResponse>, "issue_id" }` | Update sidebar reaction chips. |
| `agent:status` | `{ "agent": <AgentResponse> }` | Update participant presence. |
| `agent:archived` / `agent:restored` | `{ "agent": <AgentResponse> }` | Update sidebar. |
| `member:added` / `member:updated` / `member:removed` | `{ "member": <MemberResponse>, "user": <UserResponse> }` | Update participant list. |
| `workspace:updated` | `{ "workspace": <WorkspaceResponse> }` | Refresh workspace chrome. |
| `task:*` | various | Surfaced as activity notices only (we don't render full task telemetry in the MVP). |
| `inbox:*` | various | Out of scope for MVP. |

`issue_reaction:added/removed` payload shape (from `handler/issue_reaction.go`):

```json
{
  "reaction": { "id": "uuid", "issue_id": "uuid", "actor_type": "member", "actor_id": "uuid", "emoji": "🎉", "created_at": "..." },
  "issue_id": "uuid"
}
```

### 7.4 Activity notices

Status transitions arrive as `issue:updated` events. Stage 3 will diff the `status` field client-side and render the transition as an in-channel notice (mirroring Slack "X changed the channel topic"). **Do not invent activity notices** for fields the contract doesn't emit.

---

## 8. Files / attachments

`GET /api/issues/{id}/attachments` and `GET /api/comments/{commentId}/attachments` return the same `AttachmentResponse` shape:

```json
{
  "id": "uuid",
  "workspace_id": "uuid",
  "issue_id": "uuid",
  "comment_id": "uuid",
  "uploader_type": "member",
  "uploader_id": "uuid",
  "filename": "spec.pdf",
  "url": "https://storage/...",
  "download_url": "https://api/api/attachments/<id>/download?signature=...",
  "markdown_url": "https://api/api/attachments/<id>/download",
  "content_type": "application/pdf",
  "size_bytes": 12345,
  "created_at": "..."
}
```

- `url` — the storage backend's raw URL (may be private / signed; do not persist).
- `download_url` — short-lived signed URL valid for `ATTACHMENT_DOWNLOAD_URL_TTL` (default 30 min). Use this for `<img>`/`<video>` src.
- `markdown_url` — durable, absolute, no-TTL URL safe to embed in persisted comment bodies.

Image previews should bind to `download_url` and refresh on cache miss. Native `<img>` tags work because `GET /api/attachments/{id}/download` is authenticated against the cookie session.

---

## 9. Confirmed / optional / intentionally unsupported

### 9.1 Confirmed (MVP wires to)

- All REST endpoints in §3, §4, §5, §6, §8.
- Bearer JWT, PAT (`mul_…`), and cookie auth (CSRF for state-changing requests when using cookies).
- Workspace header `X-Workspace-Slug` (preferred) and `X-Workspace-ID` (fallback).
- WebSocket handshake + the §7.3 events.
- Attachment `markdown_url` for persisted images.
- Email-code login (`/auth/send-code` → `/auth/verify-code`).

### 9.2 Optional (only consumed when relevant for MVP)

- Issue reactions (only needed if the channel sidebar surfaces a chip).
- Issue groups (`GET /api/issues/grouped`) for richer sidebar grouping.
- `GET /api/issues/search` for the search box.
- `GET /api/issues/{id}/timeline` for richer activity surfaces.
- `GET /api/issues/{id}/active-task` if we want to render a "running" badge on channels.

### 9.3 Intentionally unsupported in MVP

- Daemon-only endpoints under `/api/daemon/*` — those are for the local agent runtime, not the browser.
- Cloud Node PAT (`mcn_`) verification — out of scope; the cloud verifier may not be deployed for self-hosted users.
- Agent task token (`mat_`) — server-internal only.
- Webhook ingress endpoints (`/api/webhooks/*`) — third-party callers.
- Onboarding shim endpoints (`/api/me/onboarding/runtime-bootstrap`) — desktop-only legacy paths.
- Stripe/GitHub/Slack/Lark integration endpoints — not relevant to the channel UI.

---

## 10. Contract-drift refresh

When the Multica backend moves on:

1. Pull the latest `main` and re-grep this contract file against `server/cmd/server/router.go` (REST), `server/pkg/protocol/events.go` (event names), and `server/internal/handler/{issue,comment,agent,workspace,auth}.go` (response shapes).
2. Update the **Refreshed against** line at the top of this document with the new commit SHA + backend version.
3. Re-record fixtures in `docs/contracts/fixtures/`, update `manifest.json` to match, and run `pnpm run validate:fixtures`. Any diff is either (a) a new field — add it to the contract as **confirmed**, or (b) a removed field — promote to **intentionally unsupported** with a link to the upstream PR.
4. Update `lib/types.ts` and `lib/mappers.ts` (Stage 2) to mirror the new contract.

If a contract change is **breaking** (field rename, enum value removal, auth scheme change), bump the minimum backend version in this file and in `README.md` before merging.

---

## 11. See also

- `docs/plans/multica-slack.md` — full delivery plan; contract verification is a Stage 1 gate before Stage 2 begins.
- `docs/contracts/fixtures/` — concrete redacted JSON examples for every resource listed above. Each fixture file is a **pure wire-shape sample** — top-level keys match the protocol exactly (no `_fixture` / `_source` / `_redaction` keys mixed in). Documentation about each fixture (source path, redaction policy, frame direction) lives in `docs/contracts/fixtures/manifest.json`. The `pnpm run validate:fixtures` script enforces this invariant and is part of Stage 1 verification.
- `AGENTS.md` — product brief; do **not** treat its API examples as authoritative.