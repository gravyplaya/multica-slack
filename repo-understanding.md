I read through the Multica-Slack repository and project plan. It is currently a greenfield repo: there is no Next.js source, package manifest, lockfile, or committed application code yet. The intended product is a Slack-like browser UI over Multica, mapping issues to channels, comments to messages, agents/members to participants, and issue/task status changes to activity notices.

The intended MVP journey is: authenticate → choose workspace → browse/search issue channels → open a channel → read real comments → post a comment → observe live issue/comment/participant updates.

Planned architecture: Next.js 16 App Router + TypeScript, Tailwind/shadcn/Lucide, TanStack Query for all server state, Zustand only for selection/drawers/drafts/preferences, a typed Multica API adapter, and a lifecycle-managed native WebSocket connection. The UI is a desktop-first three-pane workspace with responsive drawers on narrow screens.

The most important constraint is the backend contract gate. The API paths, auth/session mechanism, workspace scoping, response envelopes, pagination, real field names, and WebSocket handshake/events must be confirmed against Multica before components are wired. The plan explicitly rejects inventing response shapes or presenting fabricated presence data.

Recommended build order: establish README/.gitignore and the Next.js shell; document confirmed API contracts and fixtures; add typed models/mappers/client/session; build one vertical slice (issue list → channel → comments → send); then add details/sidebar, realtime reconciliation, resilience/accessibility/security checks, and final verification.

I also confirmed the repository has no commits yet, so the project is at the planning/bootstrap stage rather than partially implemented.