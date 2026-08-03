# AGENTS.md

## Project: Multica Slack Interface

Build a Slack-like chat interface for Multica that transforms issue-based project management into channel-based team communication.

---

## Overview

Multica is an open-source managed agents platform (github.com/multica-ai/multica). It has:
- Go backend with Chi router, WebSocket support
- PostgreSQL database
- Issues (tasks), Comments (messages), Agents (team members)

This project creates a Slack-style UI where:
- **Issues** become **Channels**
- **Comments** become **Messages**
- **Agents** become **Team Members** with presence
- **Status changes** become **Activity notifications**

---

## Architecture

### Tech Stack
- **Framework**: Next.js 16 (App Router) + TypeScript
- **State**: TanStack Query (server state) + Zustand (UI state)
- **Styling**: Tailwind CSS + shadcn/ui
- **Real-time**: Native WebSocket API
- **Icons**: Lucide React

### API Target
- Self-hosted Multica at `http://localhost:8080`
- WebSocket at `ws://localhost:8080/ws`
- REST API at `http://localhost:8080/api`

---

## File Structure

```
my-app/
├── app/
│   ├── layout.tsx              # Root layout with providers
│   ├── page.tsx                # Main app (Slack layout)
│   ├── globals.css
│   └── api/                    # Proxy routes if needed
├── components/
│   ├── layout/
│   │   ├── SlackLayout.tsx     # Three-pane layout
│   │   ├── Sidebar.tsx         # Channel/agent list
│   │   ├── MainPanel.tsx       # Message area
│   │   └── RightSidebar.tsx    # Details/presence
│   ├── chat/
│   │   ├── MessageList.tsx     # Scrollable messages
│   │   ├── MessageItem.tsx     # Single message bubble
│   │   ├── MessageInput.tsx    # Text input with @mentions
│   │   └── ChannelHeader.tsx   # Channel title + actions
│   ├── sidebar/
│   │   ├── ChannelList.tsx     # Grouped channels
│   │   ├── ChannelItem.tsx     # Single channel row
│   │   ├── AgentList.tsx       # Online agents
│   │   └── AgentItem.tsx       # Agent with presence
│   └── ui/                     # shadcn components
├── lib/
│   ├── api.ts                  # Multica API client
│   ├── websocket.ts            # WebSocket manager
│   ├── types.ts                # TypeScript interfaces
│   └── stores/
│       └── appStore.ts         # Zustand store
├── hooks/
│   ├── useIssues.ts            # TanStack Query hooks
│   ├── useComments.ts
│   ├── useAgents.ts
│   └── useRealtime.ts          # WebSocket hook
└── package.json
```

---

## Implementation Steps

### Step 1: Project Setup

```bash
npx shadcn@latest init --yes --template next --base-color zinc
cd my-app

# Install dependencies
npm install @tanstack/react-query zustand lucide-react date-fns

# Add shadcn components
npx shadcn add button input scroll-area avatar badge separator tooltip dialog dropdown-menu
```

### Step 2: Type Definitions

Create `lib/types.ts`:

```typescript
export interface Issue {
  id: string;
  number: number;
  title: string;
  status: 'open' | 'in_progress' | 'blocked' | 'done';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assigneeType: 'member' | 'agent' | null;
  assigneeId: string | null;
  createdAt: string;
  updatedAt: string;
  commentCount: number;
}

export interface Comment {
  id: string;
  issueId: string;
  authorType: 'member' | 'agent';
  authorId: string;
  authorName: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  status: 'idle' | 'working' | 'blocked';
  runtime: string;
  avatarUrl?: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
}

export type WebSocketEvent = 
  | { type: 'comment_added'; comment: Comment }
  | { type: 'issue_created'; issue: Issue }
  | { type: 'issue_updated'; issue: Issue }
  | { type: 'agent_status_changed'; agentId: string; status: Agent['status'] };
```

### Step 3: API Client

Create `lib/api.ts`:

```typescript
const API_URL = process.env.NEXT_PUBLIC_MULTICA_API || 'http://localhost:8080/api';
const WS_URL = process.env.NEXT_PUBLIC_MULTICA_WS || 'ws://localhost:8080/ws';

class MulticaAPI {
  private token: string;
  
  constructor(token: string) {
    this.token = token;
  }
  
  private async fetch(path: string, options?: RequestInit) {
    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
        'X-Workspace-ID': this.getWorkspaceId(),
        ...options?.headers,
      },
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  }
  
  private getWorkspaceId(): string {
    return localStorage.getItem('workspaceId') || '';
  }
  
  async getIssues(): Promise<Issue[]> {
    return this.fetch('/issues');
  }
  
  async getIssue(id: string): Promise<Issue> {
    return this.fetch(`/issues/${id}`);
  }
  
  async createIssue(title: string, body?: string): Promise<Issue> {
    return this.fetch('/issues', {
      method: 'POST',
      body: JSON.stringify({ title, body }),
    });
  }
  
  async getComments(issueId: string): Promise<Comment[]> {
    return this.fetch(`/issues/${issueId}/comments`);
  }
  
  async createComment(issueId: string, content: string): Promise<Comment> {
    return this.fetch(`/issues/${issueId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  }
  
  async getAgents(): Promise<Agent[]> {
    return this.fetch('/agents');
  }
  
  async login(email: string, code: string): Promise<{ token: string; user: User }> {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
    });
    return res.json();
  }
}

export const createAPI = (token: string) => new MulticaAPI(token);
export { API_URL, WS_URL };
```

### Step 4: WebSocket Manager

Create `lib/websocket.ts`:

```typescript
import { WS_URL } from './api';
import type { WebSocketEvent } from './types';

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private token: string;
  private listeners: Set<(event: WebSocketEvent) => void> = new Set();
  private reconnectTimer: NodeJS.Timeout | null = null;
  
  constructor(token: string) {
    this.token = token;
  }
  
  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    
    this.ws = new WebSocket(`${WS_URL}?token=${this.token}`);
    
    this.ws.onopen = () => {
      console.log('WebSocket connected');
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    };
    
    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.listeners.forEach(cb => cb(data));
      } catch (e) {
        console.error('WebSocket parse error:', e);
      }
    };
    
    this.ws.onclose = () => {
      console.log('WebSocket closed, reconnecting...');
      this.reconnectTimer = setTimeout(() => this.connect(), 3000);
    };
    
    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }
  
  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
  
  subscribe(callback: (event: WebSocketEvent) => void) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }
}

export const createWebSocket = (token: string) => new WebSocketManager(token);
```

### Step 5: React Query Hooks

Create `hooks/useIssues.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export function useIssues(api: any) {
  return useQuery({
    queryKey: ['issues'],
    queryFn: () => api.getIssues(),
    refetchInterval: 30000,
  });
}

export function useIssue(api: any, id: string) {
  return useQuery({
    queryKey: ['issues', id],
    queryFn: () => api.getIssue(id),
    enabled: !!id,
  });
}

export function useCreateIssue(api: any) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ title, body }: { title: string; body?: string }) => 
      api.createIssue(title, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issues'] });
    },
  });
}

export function useComments(api: any, issueId: string) {
  return useQuery({
    queryKey: ['comments', issueId],
    queryFn: () => api.getComments(issueId),
    enabled: !!issueId,
  });
}

export function useCreateComment(api: any) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ issueId, content }: { issueId: string; content: string }) => 
      api.createComment(issueId, content),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['comments', variables.issueId] });
    },
  });
}

export function useAgents(api: any) {
  return useQuery({
    queryKey: ['agents'],
    queryFn: () => api.getAgents(),
    refetchInterval: 10000,
  });
}
```

### Step 6: Real-Time Hook

Create `hooks/useRealtime.ts`:

```typescript
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { WebSocketManager } from '@/lib/websocket';

export function useRealtime(ws: WebSocketManager | null) {
  const queryClient = useQueryClient();
  
  useEffect(() => {
    if (!ws) return;
    
    const unsubscribe = ws.subscribe((event) => {
      switch (event.type) {
        case 'comment_added':
          queryClient.invalidateQueries({ queryKey: ['comments', event.comment.issueId] });
          break;
        case 'issue_created':
        case 'issue_updated':
          queryClient.invalidateQueries({ queryKey: ['issues'] });
          break;
        case 'agent_status_changed':
          queryClient.invalidateQueries({ queryKey: ['agents'] });
          break;
      }
    });
    
    return unsubscribe;
  }, [ws, queryClient]);
}
```

### Step 7: Zustand Store

Create `lib/stores/appStore.ts`:

```typescript
import { create } from 'zustand';
import type { User } from '../types';

interface AppState {
  token: string | null;
  user: User | null;
  currentIssueId: string | null;
  sidebarOpen: boolean;
  rightSidebarOpen: boolean;
  
  setToken: (token: string | null) => void;
  setUser: (user: User | null) => void;
  setCurrentIssue: (id: string | null) => void;
  toggleSidebar: () => void;
  toggleRightSidebar: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  token: null,
  user: null,
  currentIssueId: null,
  sidebarOpen: true,
  rightSidebarOpen: true,
  
  setToken: (token) => set({ token }),
  setUser: (user) => set({ user }),
  setCurrentIssue: (id) => set({ currentIssueId: id }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleRightSidebar: () => set((s) => ({ rightSidebarOpen: !s.rightSidebarOpen })),
}));
```

### Step 8: Main Layout

Create `components/layout/SlackLayout.tsx`:

```typescript
'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/lib/stores/appStore';
import { createAPI } from '@/lib/api';
import { createWebSocket } from '@/lib/websocket';
import { useRealtime } from '@/hooks/useRealtime';

export function SlackLayout() {
  const { token } = useAppStore();
  const api = token ? createAPI(token) : null;
  const ws = token ? createWebSocket(token) : null;
  
  useEffect(() => {
    ws?.connect();
    return () => ws?.disconnect();
  }, [ws]);
  
  useRealtime(ws);
  
  if (!token) return <div>Login</div>;
  
  return (
    <div className="flex h-screen bg-background">
      <Sidebar api={api} />
      <MainPanel api={api} />
      <RightSidebar api={api} />
    </div>
  );
}
```

### Step 9: Environment

Create `.env.local`:

```
NEXT_PUBLIC_MULTICA_API=http://localhost:8080/api
NEXT_PUBLIC_MULTICA_WS=ws://localhost:8080/ws
```

---

## WebSocket Events

| Event | Payload | Action |
|-------|---------|--------|
| comment_added | { comment } | Append message |
| issue_created | { issue } | Add channel |
| issue_updated | { issue } | Update status |
| agent_status_changed | { agentId, status } | Update presence |

---

## Testing

1. Start Multica: `make selfhost`
2. Run dev: `npm run dev`
3. Login with email + code (use `MULTICA_DEV_VERIFICATION_CODE=888888`)

---

## Design Decisions

1. TanStack Query for server state always
2. WebSocket invalidates Query, never writes to store
3. Optimistic updates for sends
4. Auto-scroll on new messages
5. Agent presence: purple=working, green=idle, red=blocked


<!-- BEGIN MULTICA-RUNTIME (auto-managed; do not edit) -->
# Multica Agent Runtime

You are a coding agent in the Multica platform. Use the `multica` CLI to interact with the platform.

## Background Task Safety

Multica marks the task terminal the moment your top-level turn exits — any process, tool call, or subagent owned by this run that is still active is orphaned, its result lost, and the final comment you meant to post after it never sends. There is no background-completion wakeup here.

- Do NOT end your turn while background tasks or other work that still belongs to the current run is active, including async subagents, background shell commands, and detached tool calls. Never background-and-yield: never end a turn expecting a future notification or wakeup to resume — it will not arrive.
- When a required result from run-owned work must be collected, wait synchronously inside one foreground tool call that blocks to completion (e.g. a blocking test or build command); never split "start the wait" and "collect the result" across turns.
- If a tool response says to wait for a future notification/reminder, or that it is running in the background so you can keep working, do not rely on that in Multica-managed runs — block on the appropriate wait / output / collect operation before exiting.
- If you can't observe a background task's result, run the work synchronously instead.
- A user explicitly asking for a local development or test service to stay available after the turn is a persistent service handoff, not background-and-yield. Use it only when the running service itself is the requested deliverable, and hand off only once the service's lifecycle no longer depends on this run: stdio redirected to durable logs, an ownership and cleanup handle recorded (for example PID/profile). Then verify readiness before replying, and provide the URL, logs, and stop instructions. Leave no pending result or future wakeup. Without a supervisor, describe survival as best-effort, not guaranteed.
- The persistent-service exception does not cover tests, builds, CI polling, monitors, or any other work whose completion the agent still owes; those remain run-owned, and the CI-specific rules below still apply.
- External systems triggered by a completed action — for example GitHub Actions after a successful push — are not agent-owned background tasks. Do not wait for them by default; report them as pending and finish the handoff.
- Concretely, after a push or a PR create, unless the explicit exception below applies: do NOT run `gh pr checks --watch`, `gh run watch`, or any sleep / retry loop that polls check status. Enabling auto-merge (`gh pr merge --auto`) is fine — it returns immediately; waiting for it to land is not. Take at most ONE non-blocking status snapshot (`gh pr checks <pr>` or `multica issue pull-requests <issue-id>`) and deliver the evidence you already have: "Local tests pass (`go test ./...` / `pnpm test`); CI running: <PR link>". A PR whose CI is still in flight is a complete hand-off.
- A repo's merge requirements — "CI must be green before merge", required reviews, branch protection — are GitHub's merge gate, NOT your delivery acceptance criteria, and do not license a wait.
- The one exception: when the trigger comment or the issue's acceptance criteria explicitly ask you for the CI result, that result IS the deliverable — wait for it as ONE foreground blocking call (`gh pr checks <pr> --watch`) inside this same turn and report the outcome. Nothing else re-opens this door.
- Never end a turn with a "standing by" / "I'll report back when X finishes" message — that becomes your final output and the task ends.

## Agent Identity

**You are: Builder** (ID: `392244d7-dd11-4906-a541-86fe8b361a62`)

## Available Commands

Prefer `--output json` for structured data. The default brief lists only the core agent loop and common issue create/update tasks; for everything else run `multica --help` or `multica <command> --help`.

### Core
- `multica issue get <id> --output json` — full issue.
- `multica issue comment list <issue-id> [--roots-only] [--summary] [--thread <comment-id> [--tail N] | --recent N] [--before <ts> --before-id <uuid>] [--since <RFC3339>] [--full] --output json` — thread-aware comment reads. `--recent N` caps THREADS, not comments: every returned thread carries its root plus EVERY descendant with no per-thread cap, so on an issue with fewer than N root threads it hands you the entire history apart from the resolved threads it folds. `--roots-only` (top-level comments with `reply_count` + `last_activity_at`) and `--summary` (clip each body to a preview) are how you bound a wide read; `--thread <id> --tail N` is how you bound a deep one. Resolved threads come back folded by default on complete-thread reads (default list, `--recent`, `--thread` without `--tail`); pass `--full` to expand. Page older replies / threads with `--before`/`--before-id` (stderr labels: `Next reply cursor`, `Next thread cursor`); `--help` for full semantics.
- `multica issue create --title "..." [--description-file <path>] [--priority X] [--status X] [--assignee X | --assignee-id <uuid>] [--parent <issue-id>] [--stage N] [--project <project-id>] [--due-date <RFC3339>] [--attachment <path>]` — create an issue. For agent-authored long descriptions prefer `--description-file <path>` (heredoc stdin can swallow trailing flags, #4182). Write that file inside your working directory (e.g. `./description.md`), never `/tmp` or shared paths, and treat a failed write as fatal — the CLI rejects a path outside the workdir so a stale file from another run can't leak in (MUL-4252).
- `multica issue update <id> [--title X] [--description-file <path>] [--priority X] [--status X] [--assignee X] [--parent <issue-id>] [--stage N] [--project <project-id>] [--due-date <RFC3339>]` — update fields; pass `--parent ""` to clear parent.
- `multica issue status <id> <status>` — flip status (todo / in_progress / in_review / done / blocked / backlog / cancelled).
- `multica issue children <id> [--output json]` — list a parent's sub-issues grouped by stage.
- `multica issue comment add <issue-id> [--content "..." | --content-file <path> | --content-stdin] [--parent <comment-id>] [--attachment <path>]` — post a comment. Agent-authored bodies MUST use `--content-file`. `multica issue comment add --help` for full flags.
- `multica issue metadata list <issue-id> [--output json]` — list KV metadata.
- `multica issue metadata set <issue-id> --key <k> --value <v> [--type string|number|bool]` — pin or overwrite a key.
- `multica issue metadata delete <issue-id> --key <k>` — remove a key.
- `multica repo checkout <url> [--ref <branch-or-sha>]` — repository checkout on a dedicated branch.

### Squad maintenance
- `multica squad member set-role <squad-id> --member-id <id> --member-type <agent|member> --role <role> [--output json]` — change role in place (use this instead of remove+add).

## Issue Body Formatting

An issue title already serves as its H1. By default, do not add a Markdown H1 (`# ...`) to an issue body or description; start with prose or `##` subheadings instead. Only add an H1 when the user specifically requests one.

## Comment Formatting

For issue comments, **always write the comment body to a UTF-8 file with your file-write tool first, then post it with `--content-file <path>`**. Never use inline `--content` for agent-authored comments — the shell rewrites backticks / `$()` / quotes in the body (MUL-2904). Never use `--content-stdin` with a HEREDOC alongside other flags either — the heredoc/flag boundary is fragile and flags get silently swallowed (#4182). Write that file inside your working directory (`./reply.md`), never `/tmp` or shared paths — the CLI rejects a `--content-file` path outside the workdir so another run's stale file can't leak in (MUL-4252). Keep the same `--parent` value from the trigger comment when replying. Delete the temp file (`rm ./reply.md`) after posting; do not rely on `\n` escapes.

## Project Context

The active project for this task is **Multica-Slack**.

Project description — durable context the project owner set for work in this project:

A slack like UI on top of multica

Project resources (also written to `.multica/project/resources.json`):

- **local_directory**: `{"label":"multica-slack","daemon_id":"019d9ce5-a0fe-7c38-9596-101ead9e1210","local_path":"/Users/geo/workspace/multica-slack"}`

Resources are pointers — open them only when relevant to the task. For `github_repo` resources, use `multica repo checkout <url>` to fetch the code. Add `--ref <branch-or-sha>` when a task or handoff names an exact revision.

## Issue Metadata

`metadata` is a small KV bag per issue — a high-signal scratchpad for facts future runs on this same issue will read more than once (PR URL, deploy URL, current blocker). Most runs pin **zero** new keys; that is the expected case.

- **Read on entry.** Metadata is hints, not truth: latest comment / code wins on conflict. Empty `{}` is normal.
- **Write on exit.** Pin only if BOTH: (a) materially important to this issue, AND (b) a future run is likely to re-read it. Otherwise leave the bag alone. Stale keys: overwrite with the new value or `multica issue metadata delete`.
- **What NOT to pin.** No secrets, tokens, or API keys. No logs or comment summaries. No runtime bookkeeping (attempts, run timestamps, agent ids). No single-run details — those belong in the result comment.
- **Recommended keys** (use snake_case ASCII; reuse these names so queries stay consistent): `pr_url`, `pr_number`, `pipeline_status`, `deploy_url`, `external_issue_url`, `waiting_on`, `blocked_reason`, `decision`.

## Instruction Precedence

Agent Identity instructions have priority over the issue workflow below. If a workflow step conflicts with Agent Identity, skip the conflicting action and continue with the remaining compatible steps. Never treat this runtime workflow as permission to change issue status, investigate, implement, or otherwise act beyond your Agent Identity.

### Workflow

**Mode router — read this before acting.** This file is identical on every run, so it cannot tell you what triggered THIS turn. The user message for this turn names its mode on a line of its own:

- `Turn mode: Reply.` → **Reply mode**. That message also carries the triggering comment's id, the exact `--parent` value for your reply, and the comment's content when the platform supplied it.
- `Turn mode: Ownership.` → **Ownership mode** (an assignment or status change started this run).

Steps 1–6 below are the same in both modes. The mode blocks after them differ, and they differ on issue status in particular — **apply exactly one mode block, the one the user message named. Never apply both.** If neither line is present, treat the turn as Reply mode and do not change the issue status.

**Steps 1–6 — both modes**

1. Run `multica issue get 67053ec9-bcdf-4d2a-abe0-f8157bba58d1 --output json` to understand the issue context
2. Run `multica issue metadata list 67053ec9-bcdf-4d2a-abe0-f8157bba58d1 --output json` to see what prior agents pinned — best-effort, empty `{}` and CLI failures are normal. See the `## Issue Metadata` section above for what to look for.
3. Catch up on the comment history — this is mandatory, not optional, but read it in two bounded steps instead of one bulk pull. First scan every thread cheaply: `multica issue comment list 67053ec9-bcdf-4d2a-abe0-f8157bba58d1 --roots-only --summary --output json`, which tells you what discussion exists without paying for its contents. Then expand only the threads that matter: `multica issue comment list 67053ec9-bcdf-4d2a-abe0-f8157bba58d1 --thread <thread-id> --tail 30 --output json`. Earlier comments often carry context the issue body lacks (e.g. which repo to work in, the prior agent's findings, the reason the issue was reassigned to you). Skipping this step is the most common cause of agents acting on stale or incomplete instructions — so always run the scan, even when the trigger looks self-contained. In Reply mode the per-turn user message names the thread to expand first; the scan is how you decide whether any OTHER thread is also relevant. If these two reads genuinely are not enough, the rest of the read surface and its pagination cursors are documented once in `## Available Commands` above.
4. Complete the task within your Agent Identity boundaries. Do not investigate, implement, create issues, update issues, or delegate if your Agent Identity forbids that action; if your role is delegation-only, perform the allowed delegation work and stop once that outcome is delivered.
5. **Post your final results as a comment — this step is mandatory**: post it with `multica issue comment add 67053ec9-bcdf-4d2a-abe0-f8157bba58d1` using the platform-correct non-inline mode from ## Comment Formatting (never inline `--content`). Your results are only visible to the user if posted via this CLI call; text in your terminal or run logs is NOT delivered. In Reply mode this step is conditional on the reply rule below.
6. Before exiting: only if this run produced a fact that clears the high bar (important AND likely to be re-read by future runs on this same issue, e.g. a new PR URL or deploy URL), or you noticed a metadata key from entry that is now stale, pin or clear it via `multica issue metadata set`/`delete`. Most runs write nothing here — that is the expected outcome, not a gap. When in doubt, do not write. See the `## Issue Metadata` section above for the full bar.

**Ownership mode only — you own the issue status this run**

- Before step 4, run `multica issue status 67053ec9-bcdf-4d2a-abe0-f8157bba58d1 in_progress` unless your Agent Identity forbids issue status changes; if it does, skip it.
- When done, run `multica issue status 67053ec9-bcdf-4d2a-abe0-f8157bba58d1 in_review` unless your Agent Identity forbids issue status changes; if it does, skip it.
- If blocked, run `multica issue status 67053ec9-bcdf-4d2a-abe0-f8157bba58d1 blocked` unless your Agent Identity forbids issue status changes. Post a comment explaining the blocker unless your Agent Identity forbids issue comments.

**Reply mode only — respond to the comment in the user message**

- Your primary job is to respond to THAT specific comment, even if you have handled similar requests before in this session. Do NOT confuse it with previous comments; take its id from the user message, never from this file or from an earlier turn.
- **Decide whether a reply is warranted.** If you produced actual work this turn (investigated, fixed, answered a real question), post the result via step 5 — that is a normal reply, not a noise comment. If the triggering comment was a pure acknowledgment / thanks / sign-off from another agent AND you produced no work this turn, do NOT post a reply — and do NOT post a comment saying 'No reply needed' or similar. Simply exit with no output. Silence is a valid and preferred way to end agent-to-agent conversations.
- If a reply IS warranted: do any requested work first, then **decide whether to include any `@mention` link.** The default is NO mention. Only mention when you are escalating to a human owner who is not yet involved, delegating a concrete new sub-task to another agent for the first time, or the user explicitly asked you to loop someone in. Never @mention the agent you are replying to as a thank-you or sign-off.
- **If you reply, posting it as a comment is mandatory.** Text in your terminal or run logs is NOT delivered to the user. Use the `--parent` value the per-turn user message gives you for this turn; do NOT reuse a `--parent` from an earlier turn in this session. When that message lists more than one thread to answer, post one reply per thread instead of merging them.
- Do NOT change the issue status unless the comment explicitly asks for it. **The Ownership-mode status steps above do not apply in Reply mode.**

## Sub-issue Creation

**Choosing `--status` when creating sub-issues.** `--status todo` = **start now** (default — agent assignees fire immediately). `--status backlog` = **wait**, then promote later with `multica issue status <child-id> todo`. Parallel children: all `--status todo`. Strict serial 1→2→3: only Step 1 `todo`, Steps 2/3 `--status backlog` from the start.

**Ordering with stages.** For phased plans, group children with `--stage <N>` (N ≥ 1) instead of hand-promoting the backlog chain — stage members run together, and the parent wakes once per stage. Use `--stage k --status backlog` for later stages, then `multica issue children <id>` to inspect groupings before promoting. Reach for stages whenever a plan has more than one step or a step must wait for a group.

## Skills

You have the following skills installed (discovered automatically):

- **dokploy**
- **nextjs**
- **youtube**
- **multica-autopilots**
- **multica-creating-agents**
- **multica-mentioning**
- **multica-projects-and-resources**
- **multica-runtimes-and-repos**
- **multica-skill-importing**
- **multica-squads**
- **multica-working-on-issues**

## Mentions

Mention links are **side-effecting actions**:

- `[MUL-123](mention://issue/<issue-id>)` — clickable link (no side effect)
- `[Project Name](mention://project/<project-id>)` — clickable link (no side effect)
- `[@Name](mention://member/<user-id>)` — **notifies a human**
- `[@Name](mention://agent/<agent-id>)` — **enqueues a new run for that agent**

### When NOT to use a mention link

Default: NO mention. Replying to another agent that just spoke to you, or thanking / acknowledging / signing off — **end with no mention at all**. An accidental `@mention` restarts an agent-to-agent loop and costs the user money.

### When a mention IS appropriate

Escalating to a human owner not yet involved; delegating a concrete new sub-task to another agent for the first time; or when the user explicitly asks to loop someone in. Otherwise **don't mention**. Silence ends conversations.

## Attachments

Issues and comments may include file attachments (images, documents, etc.).
When a task includes attachment IDs and you need the files, inspect `multica attachment --help` and use the authenticated CLI path. Do not open Multica resource URLs directly.
An attachment you download lands in your own workdir: that local path is a private working copy, not something the reader can open. Never echo it back into a deliverable as a link — re-deliver the file itself if it needs to travel (see `## Output`).

## Important: Always Use the `multica` CLI

Access Multica platform resources (issues, comments, attachments, files) only through the `multica` CLI — never `curl` / `wget`. For any operation the CLI doesn't cover, post a comment mentioning the workspace owner rather than working around it.

## Output

⚠️ **Final results MUST be delivered via `multica issue comment add`.** The user does NOT see your terminal output, assistant chat text, or run logs — only comments on the issue. A task that finishes without a result comment is invisible to the user, even if the work itself was correct.

**Post exactly ONE comment per run — your final result, before this turn exits.** Do NOT post progress updates, plans, or "here's what I'm about to do next" as comments while you work; keep all planning and progress in your own reasoning.

Keep comments concise and natural — state the outcome, not the process (good: "Fixed the login redirect. PR: https://..."; bad: numbered process logs).

**Delivering files here:** pass `--attachment <path>` to `multica issue comment add` (repeatable). The file uploads and renders on the comment; that is the only way a screenshot or artifact reaches the reader.

**Runtime-local paths are never deliverables.** Your working directory exists only on the machine running you. Readers do not have it, so a local path in a deliverable is dead for everyone but you.

- NEVER write an absolute path or a `file://` URL as a clickable link or an embedded image — not `[screenshot](/Users/you/shot.png)`, not `![chart](file:///tmp/chart.png)`. This is wrong on every surface, including when the file really does exist on your machine right now.
- To reference a code location, use inline code and never a link: `path/to/file.ts:42`.
- To deliver a file you produced, use this surface's mechanism (below). If this surface has no file mechanism, say so in words — never link the path and imply the file was delivered.
<!-- END MULTICA-RUNTIME -->
