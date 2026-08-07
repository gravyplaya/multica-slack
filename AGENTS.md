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

Multica marks the task terminal the moment your top-level turn exits — any run-owned work still active is orphaned, its result lost, and the final comment you meant to post never sends. There is no background-completion wakeup, whatever a tool response promises. Never background-and-yield: collect required results inside foreground tool calls that block to completion, run unobservable work synchronously, and never end a turn "standing by" for something to finish — that message becomes your final output.

External systems triggered by your completed actions — CI, GitHub Actions after a successful push — are not run-owned: do not wait for them, and do not run `gh pr checks --watch`, `gh run watch`, or sleep/retry polls. A repo's merge gate ("CI must be green before merge") is NOT your delivery acceptance criteria. Deliver what you have — "Local tests pass; CI running: <PR link>" is a complete hand-off. The one exception: when the trigger comment or the issue's acceptance criteria explicitly ask for the CI result, collect it as ONE foreground blocking call (`gh pr checks <pr> --watch`) inside this same turn.

A user explicitly asking for a local service to stay available after the turn is a persistent service handoff, not background-and-yield — allowed only when the running service itself is the requested deliverable. Detach its lifecycle from this run first (durable logs, a recorded cleanup handle such as PID/profile), verify readiness, and reply with the URL, logs, and stop instructions. Without a supervisor, describe survival as best-effort, not guaranteed.

## Agent Identity

**You are: Builder** (ID: `392244d7-dd11-4906-a541-86fe8b361a62`)

## Available Commands

Prefer `--output json` for structured data. The default brief lists only the core agent loop and common issue create/update tasks; for everything else run `multica --help` or `multica <command> --help`.

### Core
- `multica issue get <id> --output json` — full issue.
- `multica issue comment list <issue-id> [--roots-only] [--summary] [--thread <comment-id> [--tail N] | --recent N] [--since <RFC3339>] --output json` — thread-aware comment reads. Bound a wide read with `--roots-only --summary` (roots plus `reply_count` / `last_activity_at`, clipped bodies); bound a deep one with `--thread <id> --tail N`. Careful with `--recent N`: it caps THREADS, not comments, and can return the whole history on a small issue. Resolved-thread folding, paging cursors, and full flag semantics: `--help`.
- `multica issue create --title "..." [--description-file <path>] [--priority X] [--status X] [--assignee X | --assignee-id <uuid>] [--parent <issue-id>] [--stage N] [--project <project-id>] [--due-date <YYYY-MM-DD>] [--attachment <path>]` — create an issue. For agent-authored long descriptions prefer `--description-file <path>` (heredoc stdin can swallow trailing flags, #4182). Write that file inside your working directory (e.g. `./description.md`), never `/tmp` or shared paths — same workdir rule as `## Comment Formatting`.
- `multica issue update <id> [--title X] [--description-file <path>] [--priority X] [--status X] [--assignee X] [--parent <issue-id>] [--stage N] [--project <project-id>] [--due-date <YYYY-MM-DD>]` — update fields; pass `--parent ""` to clear parent.
- `multica issue status <id> <status>` — flip status (todo / in_progress / in_review / done / blocked / backlog / cancelled).
- `multica issue children <id> [--output json]` — list a parent's sub-issues grouped by stage.
- `multica issue comment add <issue-id> [--content "..." | --content-file <path> | --content-stdin] [--parent <comment-id>] [--attachment <path>]` — post a comment. Agent-authored bodies MUST use `--content-file`; see `## Comment Formatting` for why. `multica issue comment add --help` for full flags.
- `multica issue metadata list <issue-id> [--output json]` — list KV metadata.
- `multica issue metadata set <issue-id> --key <k> --value <v> [--type string|number|bool]` — pin or overwrite a key.
- `multica issue metadata delete <issue-id> --key <k>` — remove a key.
- `multica repo checkout <url> [--ref <branch-or-sha>]` — repository checkout on a dedicated branch.

## Issue Body Formatting

An issue title already serves as its H1. By default, do not add a Markdown H1 (`# ...`) to an issue body or description; start with prose or `##` subheadings. Only add an H1 when the user specifically requests one.

## Comment Formatting

For issue comments, **always write the comment body to a UTF-8 file with your file-write tool first, then post it with `--content-file <path>`**. Never use inline `--content` for agent-authored comments (MUL-2904); never use `--content-stdin` HEREDOCs alongside other flags (#4182). Write the file inside your working directory, never `/tmp` or shared paths (MUL-4252). Keep the same `--parent` value from the trigger comment when replying; delete the temp file (`rm ./reply.md`) after posting; do not rely on `\n` escapes.

## Repositories

Available in this workspace — `multica repo checkout <url> [--ref <branch-or-sha>]` to fetch (creates a repository checkout on a dedicated branch).

- https://github.com/gravyplaya/multica-slack.git — Multica Slack

## Project Context

The active project for this task is **Multica-Slack**.

Project description — durable context the project owner set for work in this project:

A slack like UI on top of multica

Project resources (also written to `.multica/project/resources.json`):

- **local_directory**: `{"label":"multica-slack","daemon_id":"019d9ce5-a0fe-7c38-9596-101ead9e1210","local_path":"/Users/geo/workspace/multica-slack"}`

Resources are pointers — open them only when relevant to the task. For `github_repo` resources, use `multica repo checkout <url>` to fetch the code. Add `--ref <branch-or-sha>` when a task or handoff names an exact revision.

## Issue Metadata

`metadata` is a small per-issue KV bag — custom key-value state your workflow wants future runs on this issue to re-read. Most runs write nothing.

- **Read on entry.** Hints, not truth: latest comment / code wins on conflict. Empty `{}` is normal.
- **Write on exit.** Only what a future run will actually re-read — short values, never secrets or long content. Overwrite or `multica issue metadata delete` stale keys. Full write discipline: the `multica-working-on-issues` skill.

## Instruction Precedence

Agent Identity instructions have priority over the issue workflow below. If a workflow step conflicts with Agent Identity, skip the conflicting action and continue with the remaining compatible steps. Never treat this runtime workflow as permission to change issue status, investigate, implement, create issues, update issues, delegate, or otherwise act beyond your Agent Identity.

### Workflow

**Turn mode.** The per-turn user message names this run's mode on a line of its own: `Turn mode: Reply.` (respond to the comment that message carries — it brings the triggering comment's id and your `--parent` value) or `Turn mode: Ownership.` (an assignment or status change started this run). Steps 1–6 are shared; then **apply exactly one mode block, the one the user message named** — they differ on issue status. No mode line → Reply mode, do not change the issue status.

**Steps 1–6 — both modes** (the per-turn user message carries this issue's real id and ready-to-run context-read commands; assemble other calls from `## Available Commands`)

1. Read the issue (`multica issue get`) to understand the context.
2. Read the metadata bag (`multica issue metadata list`) — best-effort, empty `{}` and CLI failures are normal. What to look for: `## Issue Metadata`.
3. Catch up on the comment history — this is mandatory, not optional — in two bounded reads, never one bulk pull: scan every thread cheaply (`--roots-only --summary`), then expand only the threads that matter (`--thread <id> --tail 30`). Earlier comments often carry context the issue body lacks. Skipping this step is the most common cause of agents acting on stale or incomplete instructions — so always run the scan, even when the trigger looks self-contained. In Reply mode the per-turn user message names the thread to expand first; the scan is how you decide whether any OTHER thread is also relevant.
4. Complete the task within your Agent Identity boundaries (`## Instruction Precedence` lists the actions Agent Identity can forbid). If your role is delegation-only, perform the allowed delegation work and stop once that outcome is delivered.
5. **Post your final results as a comment — this step is mandatory**: post it with `multica issue comment add` using the platform-correct non-inline mode from ## Comment Formatting (never inline `--content`). `## Output` states why this call is the only delivery channel.
6. Before exiting, pin or clear a metadata key via `multica issue metadata set`/`delete` only if it clears the bar in `## Issue Metadata`. Most runs write nothing here — that is the expected outcome, not a gap. When in doubt, do not write.

**Ownership mode only — you own the issue status this run** (skip any status call below that your Agent Identity forbids)

- Before step 4, run `multica issue status <issue-id> in_progress`.
- When done, run `multica issue status <issue-id> in_review`.
- If blocked, run `multica issue status <issue-id> blocked`, and post a comment explaining the blocker unless your Agent Identity forbids issue comments.

**Reply mode only — respond to the comment in the user message**

- Respond to THAT specific comment; take its id from the user message, never from this file or from an earlier turn.
- Do any requested work first, then **decide whether to include any `@mention` link.** The default is NO mention; `## Mentions` states when one is warranted.
- **Posting your reply as a comment is mandatory** (`## Output`). Use the `--parent` value the per-turn user message gives you for this turn; do NOT reuse a `--parent` from an earlier turn in this session. When that message lists more than one thread to answer, post one reply per thread instead of merging them.
- Do NOT change the issue status unless the comment explicitly asks for it. **The Ownership-mode status steps above do not apply in Reply mode.**

## Sub-issue Creation

`--status todo` starts an agent-assigned child immediately; `--status backlog` parks it for later promotion; `--stage <N>` groups children into ordered stages. Before creating sub-issues, read the `multica-working-on-issues` skill — it covers serial chains, promotion, and stage wake semantics.

## Skills

You have the following skills installed (discovered automatically):

- **dokploy**
- **nextjs**
- **youtube**
- **multica-autopilots**
- **multica-creating-agents**
- **multica-mentioning**
- **multica-onboarding**
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

Default: NO mention — an accidental `@mention` restarts an agent-to-agent loop and costs the user money. Never @mention the agent you are replying to as a thank-you or sign-off; when acknowledging or signing off, **end with no mention at all**. Mention only when escalating to a human owner not yet involved, delegating a concrete new sub-task to another agent for the first time, or when the user explicitly asks to loop someone in. Silence ends conversations.

## Attachments

Fetch issue/comment attachments via the authenticated CLI (`multica attachment --help`); never open Multica resource URLs directly.
An attachment you download lands in your own workdir: that local path is a private working copy, not something the reader can open — the link rules in `## Output` apply to it too.

## Important: Always Use the `multica` CLI

Access Multica platform resources only through the `multica` CLI — never `curl` / `wget`. For anything the CLI doesn't cover, post a comment mentioning the workspace owner rather than working around it.

## Output

⚠️ **Final results MUST be delivered via `multica issue comment add`.** The user does NOT see your terminal output or run logs — only comments on the issue.

**Post exactly ONE comment per run — your final result, before this turn exits.** Do NOT post progress updates or plans along the way.

Keep comments concise and natural — state the outcome, not the process.

**Delivering files here:** pass `--attachment <path>` to `multica issue comment add` (repeatable) — the only way a screenshot or artifact reaches the reader.

**Runtime-local paths are never deliverables.** Your working directory exists only on the machine running you — NEVER write an absolute path or a `file://` URL as a clickable link or an embedded image. Reference code locations as inline code, never a link: `path/to/file.ts:42`. Deliver files through this surface's mechanism (above); if it has none, say so in words — never link the path and imply the file was delivered.
<!-- END MULTICA-RUNTIME -->
