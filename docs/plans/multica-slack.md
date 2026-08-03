# Multica Slack Interface Implementation Plan

> **For the implementer:** Work through the stages in order. Keep each task small enough to review independently, and do not invent backend response shapes when the running Multica API or source contract can answer the question.

**Goal:** Build a greenfield Next.js application that gives Multica issues the room-like feel of Buzz while preserving Multica's issue, comment, agent, authentication, and WebSocket semantics.

**Architecture:** The browser owns presentation and view state; TanStack Query owns all server state; Zustand owns only session/view preferences and selection; a typed Multica client and a lifecycle-managed `/ws` connection sit behind the UI. Buzz is a visual and interaction reference, not a backend dependency: adapt its channel/thread/sidebar language and dark, compact workspace feel, but do not import Nostr, Tauri, relay, or Buzz identity code. Issues are channels, comments are messages, agents and members are participants, and issue/activity events remain attributable to their Multica source.

**Tech Stack:** Next.js 16 App Router, React, TypeScript, Tailwind CSS, shadcn/ui primitives, Lucide React, TanStack Query, Zustand, native WebSocket API, and date-fns (or the project's equivalent date utility). Initial deployment target is a self-hosted or separately hosted persistent Next.js server alongside Multica; do not make a serverless-only WebSocket assumption.

**Starting state:** The local repository is initialized on `master` but has no commits or application source yet. The project-local `AGENTS.md` is the product brief. The only attached project resource is the local directory, so implementation should happen in this checkout. The illustrative API examples in `AGENTS.md` are hypotheses until checked against the actual Multica server/client contract.

---

## Product decisions carried forward

- **Greenfield:** Create the app in this local repository rather than checkout or fork Buzz.
- **Reference:** Use `block/buzz` (Apache License 2.0) for UI patterns: compact dark workspace chrome, channel navigation, message timeline, threads, participant presence, and activity-in-context.
- **Boundary:** Recreate/adapt only the relevant visual and interaction patterns. Do not carry over Buzz's Rust/Tauri shell, Nostr relay, cryptographic identity, event kinds, or dependency tree.
- **Domain mapping:** Multica issues become channels; comments become messages; agents/members become participants; issue status and task events become activity notices.
- **Licensing:** If source code, assets, or distinctive code-level components are copied rather than independently recreated, retain the applicable Apache 2.0 license and attribution/notice requirements. Prefer independent implementation of the visual language; add a project `NOTICE`/attribution record before distributing any copied material.
- **MVP journey:** authenticate → choose workspace → browse/search issue channels → open a channel → read comments → post a comment → observe live issue/comment/agent updates.
- **Authentication options:** The MVP must support two sign-in paths: the OAuth/browser-session flow and a direct Multica API key entry that bypasses OAuth entirely. Both paths must produce the same downstream session/client shape so the rest of the app does not branch on auth source. The API key path exists for self-hosted users, automation, and developer testing where the OAuth redirect is impractical; it is a first-class option, not a debug backdoor.
- **Responsive behavior:** desktop-first three-pane layout; collapse the right details panel and then the navigation into usable mobile drawers rather than allowing horizontal overflow.
- **State rule:** React Query for issues/comments/agents/auth-backed server data; Zustand only for selection, drawer state, drafts, and presentation preferences. WebSocket events update/invalidate Query caches and do not become a second server-state store.

## Open contracts to verify before implementation

These are discovery gates, not permission to guess:

1. Exact REST paths, verbs, query parameters, pagination, envelopes, and error payloads for auth, workspaces, issues, comments, agents/members, and status changes.
2. Whether browser auth uses an HttpOnly session cookie, bearer token, or both; how CSRF/origin handling works; and the correct workspace header/route convention.
3. Whether a Multica API key (typically a long-lived bearer token issued by the self-hosted backend) is accepted as a direct alternative to the OAuth session — confirm the header/format the server expects, whether it survives WebSocket handshakes, and how the server differentiates API-key sessions from interactive OAuth sessions for rate limits or audit.
4. The actual `/ws` handshake and event envelope. Current Multica source documents event names such as `issue:created`, `issue:updated`, `comment:created`, and related events; confirm the payload and subscription/workspace filtering behavior against the target server revision.
5. Real fields for issue status/priority/assignee, comment author identity, agent presence/runtime state, reactions, attachments, and activity/task progress.
6. Whether the first milestone needs only one active workspace or a workspace picker, and whether issue visibility is project-scoped, workspace-scoped, or both.
7. The repository's package-manager and Node version policy once the first application manifest exists. If no lockfile exists, use the team's selected package manager consistently and record it in the README.

If a contract is unavailable locally, build a narrow adapter with explicit contract gaps and fixtures rather than spreading guessed JSON shapes through components.

---

## Delivery stages

### Stage 1 — Contract and repository baseline

**Outcome:** A reproducible empty-app baseline and a written, tested boundary to the real Multica API.

#### Task 1.1: Capture the initial repository baseline

**Files:**
- Create: `docs/plans/` (this plan lives at `docs/plans/multica-slack.md`)
- Create: `.gitignore` entries appropriate for Next.js, local env files, build output, and editor files
- Create: `README.md`

**Steps:**
1. Record the chosen package manager, supported Node version, local dev commands, and the Multica backend assumptions in `README.md`.
2. Ensure `.env*` files containing secrets are ignored while a checked-in `.env.example` documents variable names without values.
3. Preserve `AGENTS.md`, `.agent_context/`, and `.multica/` according to the workspace/runtime convention; do not commit credentials or generated task context unless the repository owner explicitly wants them tracked.
4. Run `git status --short` and confirm only intentional baseline files are present.

**Verification:** README setup instructions are executable by a fresh developer, and no secret-bearing file is staged.

#### Task 1.2: Inspect and freeze the Multica contract

**Files:**
- Create: `docs/contracts/multica-api.md`
- Create: `docs/contracts/fixtures/` with redacted, minimal JSON fixtures for each consumed response/event

**Steps:**
1. Inspect the target Multica source/API documentation and, when available, a running local backend.
2. Document endpoint paths, auth/workspace headers or cookies, response envelopes, error behavior, pagination, and WebSocket event examples.
3. Mark every field as confirmed, optional, or intentionally unsupported in the first slice.
4. Add fixtures that represent issue list/detail, comments, agents/members, auth responses, and each supported realtime event.
5. Add a short “contract drift” note explaining how to refresh fixtures when the backend changes.

**Verification:** A reviewer can derive the TypeScript models and API methods from this document without consulting the illustrative examples in `AGENTS.md`.

#### Task 1.3: Bootstrap the Next.js application shell

**Files:**
- Create: `package.json`, lockfile, `tsconfig.json`, `next.config.*`, `postcss.config.*`
- Create: `app/layout.tsx`, `app/page.tsx`, `app/globals.css`
- Create: `lib/utils.ts` and path alias configuration if the chosen scaffold uses one

**Steps:**
1. Create a minimal Next.js 16 App Router + TypeScript app in the repository root; do not nest it under an unrequested `my-app/` directory.
2. Add only the dependencies needed for the first slice: TanStack Query, Zustand, Lucide React, date formatting, and selected shadcn primitives.
3. Establish a dark-first token system inspired by Buzz/Catppuccin-like contrast, but give the Multica app its own name and branding.
4. Render a temporary shell page that proves the app boots before adding data fetching.

**Verification:** Run the scaffold's install, typecheck, lint, and production build commands. The temporary page renders without a browser console error.

---

### Stage 2 — Data and session foundation

**Outcome:** Typed, testable server access with explicit auth/workspace handling and two interchangeable sign-in paths (OAuth and API key).

#### Task 2.1: Define domain types and normalization helpers

**Files:**
- Create: `lib/types.ts`
- Create: `lib/mappers.ts`
- Test: `lib/mappers.test.ts`

**Steps:**
1. Define types from `docs/contracts/multica-api.md`, including raw API types where the wire shape differs from UI types.
2. Keep status and author/assignee discriminated unions faithful to the server; do not collapse agent and member identity into an ambiguous string.
3. Normalize dates, optional avatars, display names, comment counts, and issue identifiers in one mapper layer.
4. Add tests for complete payloads, missing optional fields, unknown future status/event values, and malformed required fields.

**Verification:** Mapper tests pass and components need not contain `as any` casts for API data.

#### Task 2.2: Implement the browser-safe API client

**Files:**
- Create: `lib/api/client.ts`
- Create: `lib/api/errors.ts`
- Test: `lib/api/client.test.ts`

**Steps:**
1. Implement a small client with one request function that applies the confirmed auth and workspace mechanism, JSON headers, abort signals, and a useful typed error.
2. The client must accept a session token (from either OAuth exchange or an API key) sourced from a single accessor; do not let callers pass the credential inline per request.
3. Add methods only for the MVP: current user/session, workspace context, issue list/detail, comment list/create, participant/agent list, and any required status/activity read.
4. Handle non-2xx responses without leaking response bodies that may contain secrets; preserve server request IDs when provided.
5. Keep browser-only APIs out of modules that may be imported during server rendering; inject storage/cookie access where necessary.
6. Add fixture-backed tests for success envelopes, empty collections, unauthorized responses, validation errors, and network failures.

**Verification:** Client tests pass in the project's test environment, and a server render/import does not throw `window` or `localStorage` errors.

#### Task 2.3: Add session/workspace providers and view store

**Files:**
- Create: `app/providers.tsx`
- Create: `lib/stores/view-store.ts`
- Create: `lib/auth/session.ts` (or the server/client split required by the confirmed auth scheme)
- Modify: `app/layout.tsx`
- Test: `lib/stores/view-store.test.ts`

**Steps:**
1. Mount QueryClientProvider once at the client boundary with stable defaults and cancellation behavior.
2. Implement the confirmed session bootstrap and workspace selection flow; do not duplicate auth state in multiple stores.
3. Put selected issue/channel, open drawers, right-panel visibility, search query, and local drafts in Zustand.
4. Preserve drafts on navigation but clear them after a confirmed successful comment mutation.
5. Add accessible loading, signed-out, unauthorized, and retry states.

**Verification:** Refreshing the app preserves the intended session mechanism, changing the selected channel does not refetch unrelated queries, and store tests cover drawer/selection transitions.

#### Task 2.4: Support API key sign-in alongside OAuth

**Files:**
- Create: `lib/auth/api-key.ts`
- Create: `components/auth/ApiKeySignInForm.tsx`
- Create: `components/auth/SignInPage.tsx`
- Create: `lib/auth/session-source.ts`
- Test: `lib/auth/api-key.test.ts`
- Modify: `components/auth/SignInPage.tsx` (or the chosen routing entry) to mount the form
- Modify: `lib/auth/session.ts` to consume the unified session source

**Steps:**
1. Add a dedicated `API key` panel on the sign-in screen, presented as an equal alternative to the OAuth button — not a hidden "advanced" toggle. The panel must make the trade-off visible: API key sign-in keeps the credential in the browser for the session and is intended for self-hosted users, automation, and developer testing where the OAuth redirect is impractical.
2. Accept the key via a paste field with a `show/hide` toggle, basic client-side trim/whitespace-only rejection, and the same validation affordances (submit disabled until non-empty, server error surfaced inline, no credential echoed back in any error string).
3. Persist the key in a single, well-named session source (e.g. `sessionSource`: `'oauth' | 'api-key'`) keyed by Multica backend URL so multiple workspaces/backends can coexist. Choose browser storage that survives reloads but is cleared on explicit sign-out; never write the credential to `localStorage` keys shared with unrelated origins, never send it to telemetry, and never log it.
4. Verify the key on submit by calling the confirmed "current user/session" endpoint over the API client. On success, populate the same session state used by the OAuth flow and proceed to workspace selection. On failure, show the server error without disclosing whether the key was malformed vs. unauthorized.
5. Document in `docs/security-and-privacy.md` (created in Task 4.3) the API key flow's threat model: the credential lives in the user's browser session, anyone with device access can use it until sign-out, and the server's audit log will attribute activity to the API key identity rather than an interactive login. Surface that warning once per first use of the API key path.
6. Confirm the API key also works for the `/ws` handshake and document where the credential is injected for the WebSocket manager. If the server requires a separate event-channel mechanism for API keys, capture that as a contract decision.
7. Add unit tests covering: empty/whitespace input rejection, malformed key rejection, successful validation populating session state, sign-out clearing the key from storage, and that the API key never appears in console logs, error messages, or query cache entries.

**Verification:** A user can sign in with an API key and reach the same workspace/channel UI as an OAuth user; a reload preserves the session through the chosen storage; sign-out clears the credential; tests prove the credential is never logged or rendered; the API key flow is documented as a first-class option in the README and the security note.

---

### Stage 3 — Buzz-derived interface vertical slice

**Outcome:** A usable desktop workspace that can browse a real issue and converse in it.

#### Task 3.1: Establish layout primitives and visual tokens

**Files:**
- Modify: `app/globals.css`
- Create: `components/ui/` primitives actually used by the slice
- Create: `components/layout/WorkspaceFrame.tsx`
- Create: `components/layout/PanelResizer.tsx` only if resizing is required by the design

**Steps:**
1. Define semantic colors for canvas, sidebar, elevated panel, borders, muted text, accent, success, warning, and blocked states.
2. Use a compact information hierarchy: narrow navigation rail/sidebar, readable message column, and optional context panel.
3. Add focus-visible styles, reduced-motion behavior, keyboard-safe targets, and minimum contrast checks.
4. Keep layout widths bounded with flex/grid and explicit overflow containers; never rely on page-level horizontal scrolling.

**Verification:** The shell remains usable at desktop and mobile viewport widths, and keyboard focus is visible on every interactive control.

#### Task 3.2: Build workspace/sidebar navigation

**Files:**
- Create: `components/layout/Sidebar.tsx`
- Create: `components/sidebar/WorkspaceSwitcher.tsx`
- Create: `components/sidebar/ChannelList.tsx`
- Create: `components/sidebar/ChannelItem.tsx`
- Create: `components/sidebar/ParticipantList.tsx`
- Create: `components/sidebar/ParticipantItem.tsx`
- Create: `hooks/useIssues.ts`
- Create: `hooks/useParticipants.ts`

**Steps:**
1. Fetch accessible issues and participants with Query hooks and stable workspace-scoped keys.
2. Present issues as channels with a clear identifier, title, status indicator, unread/mention affordance only when backed by data, and selected state.
3. Group or filter channels in a way that matches the confirmed product decision; do not imply “active” semantics that the API does not provide.
4. Show agents and members with distinct but equal participant treatment; presence labels must come from real data or be explicitly “unknown,” never fabricated.
5. Add search/filter interaction and empty/error/loading states.

**Verification:** Selecting a channel updates the view store and URL/deep-link strategy (if chosen), preserves accessible labels, and does not trigger duplicate requests.

#### Task 3.3: Build channel header and message timeline

**Files:**
- Create: `components/chat/ChannelHeader.tsx`
- Create: `components/chat/MessageList.tsx`
- Create: `components/chat/MessageItem.tsx`
- Create: `components/chat/ActivityNotice.tsx`
- Create: `hooks/useComments.ts`

**Steps:**
1. Load comments for the selected issue and render a stable chronological timeline with author identity, timestamp, content, and supported attachments/reactions only.
2. Use Buzz-like message density and thread affordances, but map every action to a Multica comment or issue operation.
3. Render issue status/task transitions as clearly labeled activity notices rather than pretending they are human messages.
4. Handle first load, empty channel, failed load, pagination/infinite history (if the contract supports it), and new-message scroll behavior.
5. Prevent duplicate rendering when a mutation response and a WebSocket event describe the same comment.

**Verification:** A fixture-backed component or browser test demonstrates an empty channel, a populated channel with an agent message, an activity notice, and a long message without layout breakage.

#### Task 3.4: Build the composer and optimistic comment send

**Files:**
- Create: `components/chat/MessageComposer.tsx`
- Create: `hooks/useCreateComment.ts`
- Create: `lib/chat/optimistic-comments.ts`
- Test: `lib/chat/optimistic-comments.test.ts`

**Steps:**
1. Support plain text submission, Enter/Shift+Enter behavior, disabled/submitting state, and a clear error recovery path.
2. Add an explicit, modest mention affordance only if the confirmed API supports mention parsing; do not ship a nonfunctional autocomplete theatre.
3. Optimistically insert a temporary comment with a client-only ID, reconcile it with the server response, and roll back on failure.
4. Disable duplicate submits and preserve the draft when the request fails.
5. Ensure user-provided content is rendered safely; do not use unsafe HTML injection.

**Verification:** Unit tests cover optimistic insert, reconciliation, rollback, duplicate event suppression, blank/whitespace input, and retry. A browser smoke test sends a message and sees it once.

#### Task 3.5: Build the issue details/right panel

**Files:**
- Create: `components/layout/RightSidebar.tsx`
- Create: `components/issue/IssueDetails.tsx`
- Create: `components/issue/StatusBadge.tsx`
- Create: `components/issue/AssigneeSummary.tsx`

**Steps:**
1. Show confirmed issue metadata: title/identifier, status, priority, assignee, project/workspace context, timestamps, and comment count where available.
2. Link to supported issue actions only after the server contract and authorization rules are confirmed.
3. Show participant/task context without exposing private fields or runtime secrets.
4. Collapse the panel at the mobile breakpoint and provide an accessible drawer trigger.

**Verification:** Details remain synchronized with selected issue updates and clearly distinguish unavailable data from empty data.

---

### Stage 4 — Realtime and resilience

**Outcome:** Two clients can observe relevant changes without refresh, and connection failures degrade gracefully.

#### Task 4.1: Implement the WebSocket manager

**Files:**
- Create: `lib/realtime/websocket-manager.ts`
- Create: `lib/realtime/events.ts`
- Test: `lib/realtime/websocket-manager.test.ts`

**Steps:**
1. Implement the confirmed handshake, workspace scoping, auth, and event envelope.
2. Expose typed subscribe/unsubscribe callbacks and connection status without coupling the manager to React.
3. Add lifecycle cleanup, bounded exponential reconnect with jitter, close-reason handling, and no reconnect after intentional disconnect.
4. Validate event payloads at the boundary and ignore/log unknown events without crashing the UI.
5. Add heartbeat behavior only if required by the server contract; do not invent application-level frames.

**Verification:** Fake-WebSocket tests cover open, message, malformed message, error, close/reconnect, intentional disconnect, and listener cleanup.

#### Task 4.2: Connect realtime events to Query caches

**Files:**
- Create: `hooks/useRealtime.ts`
- Create: `lib/realtime/query-updaters.ts`
- Test: `lib/realtime/query-updaters.test.ts`
- Modify: `app/providers.tsx` or the authenticated workspace boundary

**Steps:**
1. Map issue-created/updated/deleted, comment-created/updated/deleted/resolved, presence, and task/activity events to targeted invalidation or cache updates.
2. Update only the affected workspace/issue query keys; avoid broad “invalidate everything” behavior for every event.
3. Reconcile server events with optimistic mutations using stable IDs and pending-client IDs.
4. Surface a subtle connection indicator and a recoverable stale-data state without blocking already loaded content.

**Verification:** Query updater tests prove unrelated channels are not changed, duplicate events are idempotent, and a reconnect triggers the minimum necessary refresh.

#### Task 4.3: Add resilience, accessibility, and security checks

**Files:**
- Modify: relevant components and API/realtime modules
- Create: `tests/e2e/workspace-smoke.spec.ts` (or the chosen browser test location)
- Create: `docs/security-and-privacy.md`

**Steps:**
1. Test signed-out access, expired session, forbidden issue, malformed server data, offline API, WebSocket outage, and reconnect.
2. Confirm no token or private response is logged, persisted in an unsafe store, or included in user-visible error text.
3. Add keyboard navigation, screen-reader names, live-region announcements for new messages/status where appropriate, and reduced-motion behavior.
4. Document workspace isolation assumptions, content rendering policy, auth storage, and known limitations.

**Verification:** Browser smoke tests pass against a fixture/mock backend and, when available, a local Multica instance; accessibility checks find no blocking violations in the primary journey.

---

### Stage 5 — Verification, documentation, and handoff

**Outcome:** A reviewable first milestone with reproducible checks and clear gaps.

#### Task 5.1: Add contract-backed test fixtures and test scripts

**Files:**
- Modify: `package.json`
- Create/modify: `tests/fixtures/`, unit/integration test files
- Create: `docs/testing.md`

**Steps:**
1. Define scripts for lint, typecheck, unit tests, production build, and browser smoke tests.
2. Keep fixture tests deterministic and separate from live-backend tests.
3. Document environment setup, fixed local verification code usage only for a non-public dev backend, and how to run live checks.
4. Add a test matrix mapping each MVP acceptance criterion to a command or test.

**Verification:** A fresh checkout can install dependencies and run the documented offline checks without credentials.

#### Task 5.2: Run the full local verification loop

**Commands:**

```bash
<package-manager> install
<package-manager> run lint
<package-manager> run typecheck
<package-manager> run test
<package-manager> run build
<package-manager> run test:e2e:smoke
```

When a local Multica backend is available, additionally run the documented live smoke path after starting it. Record actual output and any backend-contract blockers; never substitute a fabricated pass.

**Verification:** All applicable commands pass, or the handoff names the exact failing command and why it is environment/contract-related.

#### Task 5.3: Add Buzz/Multica attribution and review the diff

**Files:**
- Create/modify: `NOTICE` or `THIRD_PARTY_NOTICES.md`
- Modify: `README.md`

**Steps:**
1. If implementation independently recreates the visual language, document Buzz as inspiration/reference without implying endorsement or copied code.
2. If any Buzz source, asset, or NOTICE material was copied, retain Apache 2.0 text and required attribution notices, and mark modified files as required by the license.
3. Document that the app is a Multica client and preserve any applicable Multica branding/license obligations before distribution.
4. Run `git diff --check`, inspect `git status`, review the dependency tree, and remove accidental generated files/secrets.

**Verification:** License/attribution obligations are explicit, the diff is limited to the agreed product, and the repository is ready for the first human review.

---

## MVP acceptance criteria

1. A developer can install and start the app using the documented commands.
2. A user can sign in either via the OAuth/browser-session flow or by pasting a Multica API key, and both paths reach the same workspace/channel UI.
3. A signed-in user can select the intended workspace and see accessible Multica issues presented as channels.
4. Selecting a channel shows its real title/status/context and loads its comments with correct author identity and timestamps.
5. A user can post a non-empty comment, see a single optimistic message, and recover cleanly from failure.
6. A second client or live event can update an issue/comment/participant view without a full page refresh when the backend supports that event.
7. Realtime disconnects do not create an infinite reconnect loop or erase loaded content.
8. Desktop and narrow viewports remain usable; keyboard and screen-reader users can complete the primary journey.
9. No guessed API shape, unsafe token logging, fabricated presence, or unlicensed copied Buzz material is shipped. API keys are never logged, rendered, or transmitted to any destination other than the configured Multica backend.
10. Lint, typecheck, tests, and production build have real recorded results before claiming the milestone complete.

## Explicit non-goals for the first milestone

- Reusing Buzz's Rust/Tauri application shell or Nostr relay/backend.
- Reimplementing DMs, canvases, huddles, workflows, git hosting, reactions, media annotations, or full Buzz parity before the issue/comment/channel loop is solid.
- Adding a second server-state store or a speculative abstraction layer for providers not in the confirmed Multica contract.
- Building a mock UI that presents invented API data as production behavior.
- Committing secrets, local runtime credentials, generated `.multica` task state, or unrelated repository changes.
- Storing API keys in a way that survives sign-out (e.g. persisting a key after the user explicitly chose to sign out), or sharing the API key path with any other origin or analytics endpoint.

## Suggested implementation order

Complete Stage 1 and the contract gate first. Then implement one vertical slice through Stage 2 → 3 (list issues → open one → load comments → post one) before broadening the sidebar/details surface. Add Stage 4 realtime only after the mutation and cache identity rules are tested. Finish with Stage 5 verification and attribution review.

The plan is intentionally conservative about the backend boundary. A beautiful channel shell is useful; a beautiful channel shell wired to the wrong endpoint is merely an expensive screenshot.
