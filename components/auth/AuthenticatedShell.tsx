"use client";

import { Hash } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMulticaClient } from "../../hooks/use-multica-client";
import { MessageComposer } from "../../components/chat/MessageComposer";
import { ChannelHeader } from "../../components/chat/ChannelHeader";
import {
  MessageList,
  type ParticipantDirectory,
} from "../../components/chat/MessageList";
import { Sidebar } from "../../components/layout/Sidebar";
import { RightSidebar } from "../../components/layout/RightSidebar";
import { signOutAndClearApiKey } from "../../lib/auth/api-key";
import { credentialFingerprint } from "../../lib/api/redact";
import { mapAgent, mapComment, mapIssue, mapUser, mapWorkspace } from "../../lib/mappers";
import {
  createOptimisticComment,
  mergeCommentViews,
  removeOptimisticComment,
} from "../../lib/chat/optimistic-comments";
import { useSession, useSessionStore } from "../../lib/auth/use-session";
import { useViewStore } from "../../lib/stores/use-view-store";
import type {
  AgentView,
  CommentView,
  IssueView,
  UserView,
  WireComment,
  WorkspaceSelection,
  WorkspaceView,
} from "../../lib/types";

function randomOptimisticId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `optimistic-${crypto.randomUUID()}`;
  }
  return `optimistic-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function mergeCommentLists(...lists: CommentView[][]): CommentView[] {
  return lists.reduce(
    (result, list) => list.reduce(mergeCommentViews, result),
    [] as CommentView[],
  );
}

function mapParticipantDirectory(
  membersData: unknown[] | undefined,
  agentsData: unknown[] | undefined,
): ParticipantDirectory {
  const members = new Map<string, UserView>();
  for (const row of membersData ?? []) {
    if (typeof row !== "object" || row === null || !("user" in row)) continue;
    const user = mapUser((row as { user: unknown }).user);
    members.set(user.id, user);
  }
  const agents = new Map<string, AgentView>();
  for (const row of agentsData ?? []) {
    const agent = mapAgent(row);
    agents.set(agent.id, agent);
  }
  return { members, agents };
}

export function AuthenticatedShell() {
  const session = useSession();
  const sessionStore = useSessionStore();
  const client = useMulticaClient();
  const queryClient = useQueryClient();
  const selectedWorkspace = useViewStore((state) => state.selectedWorkspace);
  const selectedIssueId = useViewStore((state) => state.selectedIssueId);
  const selectWorkspace = useViewStore((state) => state.selectWorkspace);
  const selectIssue = useViewStore((state) => state.selectIssue);
  const searchQuery = useViewStore((state) => state.searchQuery);
  const setSearchQuery = useViewStore((state) => state.setSearchQuery);
  const draftMap = useViewStore((state) => state.draftsByIssueId);
  const setDraft = useViewStore((state) => state.setDraft);
  const clearDraft = useViewStore((state) => state.clearDraft);
  const resetForSignOut = useViewStore((state) => state.resetForSignOut);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingComments, setPendingComments] = useState<Record<string, CommentView[]>>({});

  const sessionKey = session
    ? credentialFingerprint(session.token)
    : "signed-out";
  const workspacesQuery = useQuery({
    queryKey: ["workspaces", session?.backendOrigin ?? "", sessionKey],
    queryFn: () => client.listWorkspaces(),
    enabled: Boolean(session),
  });
  const workspace = selectedWorkspace;
  const issuesQuery = useQuery({
    queryKey: ["issues", workspace?.workspaceId ?? "none", sessionKey],
    queryFn: () => client.listIssues({ query: { limit: 100, offset: 0 } }),
    enabled: Boolean(session && workspace),
  });
  const commentsQuery = useQuery({
    queryKey: ["comments", selectedIssueId, sessionKey],
    queryFn: () => client.listComments(selectedIssueId!),
    enabled: Boolean(session && selectedIssueId),
  });
  const membersQuery = useQuery({
    queryKey: ["members", workspace?.workspaceId ?? "none", sessionKey],
    queryFn: () => client.listWorkspaceMembers(workspace!.workspaceId),
    enabled: Boolean(session && workspace),
  });
  const agentsQuery = useQuery({
    queryKey: ["agents", workspace?.workspaceId ?? "none", sessionKey],
    queryFn: () => client.listAgents(),
    enabled: Boolean(session && workspace),
  });

  const workspaces = useMemo<WorkspaceView[]>(
    () => (workspacesQuery.data ?? []).map((item) => mapWorkspace(item)),
    [workspacesQuery.data],
  );
  const issues = useMemo<IssueView[]>(
    () => (issuesQuery.data ?? []).map((item) => mapIssue(item)),
    [issuesQuery.data],
  );
  const comments = useMemo<CommentView[]>(
    () => (commentsQuery.data ?? [])
      .map((item) => mapComment(item))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    [commentsQuery.data],
  );
  const directory = useMemo(
    () => mapParticipantDirectory(membersQuery.data, agentsQuery.data),
    [agentsQuery.data, membersQuery.data],
  );
  const selectedIssue = issues.find((issue) => issue.id === selectedIssueId) ?? null;
  const visibleComments = useMemo(
    () => mergeCommentLists(
      comments,
      selectedIssueId ? pendingComments[selectedIssueId] ?? [] : [],
    ),
    [comments, pendingComments, selectedIssueId],
  );

  const createComment = useMutation<
    WireComment,
    Error,
    { issueId: string; content: string },
    { issueId: string; optimisticId: string }
  >({
    mutationFn: ({ issueId, content }) => client.createComment(issueId, { content }),
    onMutate: async ({ issueId, content }) => {
      await queryClient.cancelQueries({ queryKey: ["comments", issueId, sessionKey] });
      const optimisticId = randomOptimisticId();
      const optimistic = createOptimisticComment({
        id: optimisticId,
        issueId,
        content,
        author: { type: "member", id: session?.user?.id ?? "current-user" },
      });
      setPendingComments((current) => ({
        ...current,
        [issueId]: [...(current[issueId] ?? []), optimistic],
      }));
      return { issueId, optimisticId };
    },
    onSuccess: (created, variables, context) => {
      if (context) {
        setPendingComments((current) => ({
          ...current,
          [context.issueId]: removeOptimisticComment(
            current[context.issueId] ?? [],
            context.optimisticId,
          ),
        }));
      }
      clearDraft(variables.issueId);
      queryClient.setQueryData<WireComment[] | undefined>(
        ["comments", variables.issueId, sessionKey],
        (current) => {
          const existing = current ?? [];
          return existing.some((comment) => comment.id === created.id)
            ? existing.map((comment) => comment.id === created.id ? created : comment)
            : [...existing, created];
        },
      );
    },
    onError: (_error, _variables, context) => {
      if (!context) return;
      setPendingComments((current) => ({
        ...current,
        [context.issueId]: removeOptimisticComment(
          current[context.issueId] ?? [],
          context.optimisticId,
        ),
      }));
    },
  });

  useEffect(() => {
    if (!selectedWorkspace && workspaces[0]) {
      const next = {
        workspaceId: workspaces[0].id,
        workspaceSlug: workspaces[0].slug,
      };
      selectWorkspace(next);
      client.setWorkspace(next);
    }
  }, [client, selectWorkspace, selectedWorkspace, workspaces]);

  useEffect(() => {
    if (!selectedIssueId && issues[0]) {
      selectIssue(issues[0].id);
      return;
    }
    if (
      selectedIssueId &&
      issues.length > 0 &&
      !issues.some((issue) => issue.id === selectedIssueId)
    ) {
      selectIssue(issues[0].id);
    }
  }, [issues, selectIssue, selectedIssueId]);

  function handleWorkspaceChange(next: WorkspaceSelection) {
    selectWorkspace(next);
    client.setWorkspace(next);
    setDetailsOpen(true);
  }

  function handleSignOut() {
    signOutAndClearApiKey(sessionStore);
    if (sessionStore.get()) sessionStore.clear();
    client.setWorkspace(null);
    resetForSignOut();
    queryClient.clear();
  }

  if (!session) return null;

  return (
    <main className="workspace-shell">
      <Sidebar
        sessionUser={session.user}
        workspaces={workspaces}
        workspace={workspace}
        issues={issues}
        selectedIssueId={selectedIssueId}
        searchQuery={searchQuery}
        workspacesLoading={workspacesQuery.isPending}
        issuesLoading={issuesQuery.isPending}
        workspacesError={workspacesQuery.error}
        issuesError={issuesQuery.error}
        sidebarOpen={sidebarOpen}
        onWorkspaceChange={handleWorkspaceChange}
        onIssueSelect={selectIssue}
        onSearch={setSearchQuery}
        onSignOut={handleSignOut}
        onClose={() => setSidebarOpen(false)}
      />
      {sidebarOpen ? (
        <button
          className="drawer-scrim"
          type="button"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}
      <section className="channel-panel" id="main-content">
        <ChannelHeader
          issue={selectedIssue}
          detailsOpen={detailsOpen}
          onOpenNavigation={() => setSidebarOpen(true)}
          onToggleDetails={() => setDetailsOpen((open) => !open)}
        />
        {selectedIssue ? (
          <>
            <MessageList
              issue={selectedIssue}
              comments={visibleComments}
              members={directory.members}
              agents={directory.agents}
              isLoading={commentsQuery.isPending}
              error={commentsQuery.error}
              onRetry={() => void commentsQuery.refetch()}
            />
            <MessageComposer
              issueIdentifier={selectedIssue.identifier}
              value={draftMap[selectedIssue.id] ?? ""}
              pending={createComment.isPending}
              error={createComment.error}
              onChange={(value) => setDraft(selectedIssue.id, value)}
              onSubmit={() => {
                const content = (draftMap[selectedIssue.id] ?? "").trim();
                if (content && !createComment.isPending) {
                  createComment.mutate({ issueId: selectedIssue.id, content });
                }
              }}
            />
          </>
        ) : (
          <div className="content-state empty-main">
            <Hash size={28} aria-hidden="true" />
            <h2>Choose a channel</h2>
            <p>Issues are presented as channels so the team can discuss work in context.</p>
          </div>
        )}
      </section>
      <RightSidebar
        issue={selectedIssue}
        members={directory.members}
        agents={directory.agents}
        membersLoading={membersQuery.isPending}
        agentsLoading={agentsQuery.isPending}
        participantsError={membersQuery.error ?? agentsQuery.error}
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
      />
    </main>
  );
}
