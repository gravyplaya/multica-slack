# Multica Slack Interface

A Slack-style browser workspace on top of [Multica](https://github.com/multica-ai/multica). Issues become channels, comments become messages, and members/agents become participants — all driven by real Multica REST + WebSocket contracts.

> **Status:** Stage 2 — typed data + session foundation, two sign-in paths (OAuth + API key). The sign-in screen is live; the workspace/channel UI lands in Stage 3.

## Tech stack

- **Next.js 16** App Router + React + TypeScript
- **TanStack Query** for server state, **Zustand** for view state
- **Tailwind CSS** + shadcn/ui primitives + Lucide React
- **Native WebSocket** for realtime, **date-fns** for formatting
- **pnpm** as the package manager (consistent with the upstream Multica repo)

## Prerequisites

- **Node.js ≥ 20.18** (matches the upstream Multica `engines.node` policy and supports Next.js 16 + React 19)
- **pnpm ≥ 9** (install with `npm install -g pnpm` or via `corepack enable`)
- A running Multica backend (self-hosted or local dev). See "Connecting to Multica" below.

## Local commands

```bash
pnpm install            # install dependencies
pnpm run dev            # start the Next.js dev server on http://localhost:3000
pnpm run build          # production build
pnpm run start          # serve the production build
pnpm run lint           # ESLint
pnpm run typecheck      # tsc --noEmit
pnpm run validate:fixtures  # sanity-check docs/contracts/fixtures/ against manifest.json
pnpm run verify         # fixture check + typecheck + lint + build (full Stage 1 gate)
```

Vitest unit tests cover the typed-data, client, redaction, API-key
sign-in, and view-store layers. Run with `pnpm run test`. Component
tests live under `components/**/*.test.tsx`.

## Connecting to Multica

This app is a pure client of the Multica backend at `http://localhost:8080` by default. Copy `.env.example` to `.env.local` and adjust the URLs if your backend lives elsewhere.

The sign-in screen exposes two equivalent paths:

1. **OAuth / email-code** — the standard Multica browser flow (`POST /auth/send-code` → `POST /auth/verify-code`) which sets the `multica_auth` HttpOnly cookie + a CSRF cookie. Browser-only.
2. **Direct API key** — paste a Multica PAT (prefix `mul_`) issued from `/api/tokens`. The key is held in browser session storage, sent as `Authorization: Bearer ...` to the REST API and as the first WebSocket frame, and cleared on sign-out. First-class for self-hosted users, automation, and developer testing.

Both paths populate the same `SessionState` consumed by the rest of the app; the rest of the codebase never branches on auth source.

### Self-hosting Multica locally

```bash
cd ../multica
make selfhost   # spins up Postgres + Redis + backend on :8080
```

For development convenience, the self-hosted backend supports the dev verification code `MULTICA_DEV_VERIFICATION_CODE=888888`.

## Layout

```
.
├── app/                        # Next.js App Router routes
│   ├── layout.tsx              # root layout + <Providers> mount
│   ├── page.tsx                # auth gate (SignInPage ↔ AuthenticatedShell)
│   ├── providers.tsx           # QueryClient + SessionSource + ViewStore
│   └── globals.css             # Tailwind + design tokens
├── components/                 # Stage 2 sign-in, Stage 3+ UI
│   └── auth/                   # SignInPage, ApiKeySignInForm, OAuthSignInForm, AuthenticatedShell
├── docs/
│   ├── plans/multica-slack.md  # full delivery plan
│       └── contracts/
│       │   ├── multica-api.md      # frozen API + WebSocket contract
│       │   └── fixtures/           # redacted JSON examples + manifest.json
├── hooks/                      # TanStack Query / MulticaClient hooks
│   └── use-multica-client.ts   # client keyed by session + workspace
├── lib/                        # types, mappers, api/, auth/, stores/
└── utils.ts
└── components/                 # Stage 3+ UI (sidebar, chat, layout)
├── docs/
│   ├── plans/multica-slack.md  # full delivery plan
│       └── contracts/
│       │   ├── multica-api.md      # frozen API + WebSocket contract
│       │   └── fixtures/           # redacted JSON examples + manifest.json
├── hooks/                      # TanStack Query hooks (Stage 2+)
├── lib/                        # client, websocket, types, mappers, stores
│   └── utils.ts                # cn() — Stage 1 placeholder; Stage 2+ adds the rest
├── public/                     # static assets
├── AGENTS.md                   # product brief (do not edit)
├── README.md                   # this file
├── .env.example                # checked-in variable names (no secrets)
└── .gitignore                  # ignores .env.local, build output, node_modules
```

## Environment variables

All variables are public (`NEXT_PUBLIC_*`) so the browser can read them at build time. Never put secrets in `.env.local` — the backend itself is the source of authority for tokens.

| Variable | Purpose | Default |
| --- | --- | --- |
| `NEXT_PUBLIC_MULTICA_API` | REST API base URL (no trailing `/api`) | `http://localhost:8080` |
| `NEXT_PUBLIC_MULTICA_WS` | WebSocket URL (matches the `MULTICA_PUBLIC_URL` host) | `ws://localhost:8080/ws` |

See `.env.example` for the checked-in template.

## Stage 1 deliverables

- [x] Reproducible install + boot commands in this README.
- [x] `.gitignore` covers Next.js build output, `.env*.local`, IDE files, runtime artefacts, and the entire `.multica/` tree (which holds per-run agent IDs that should never leak into git).
- [x] `.env.example` declares every variable name the app reads — values stay out of git.
- [x] `docs/contracts/multica-api.md` + `docs/contracts/fixtures/` freeze the verified Multica contract as the source of truth for Stages 2+.
- [x] Next.js 16 App Router + TypeScript shell at the repository root, with a temporary landing page that proves the build.

## Next stage

Stage 2 — typed data + session foundation with OAuth and API-key sign-in paths behaving as one downstream session. Gate: both auth paths reach the same authenticated workspace state, and tests prove API keys never appear in logs, errors, query caches, or telemetry.