import { AlertCircle, Hash, Search, Users, X } from "lucide-react";
import type { ChangeEvent } from "react";

import type { IssueView, UserView, WorkspaceSelection, WorkspaceView } from "../../lib/types";
import { statusClass, statusLabel } from "../chat/status";

export interface SidebarProps {
  sessionUser: UserView | null;
  workspaces: WorkspaceView[];
  workspace: WorkspaceSelection | null;
  issues: IssueView[];
  selectedIssueId: string | null;
  searchQuery: string;
  workspacesLoading: boolean;
  issuesLoading: boolean;
  workspacesError: unknown;
  issuesError: unknown;
  sidebarOpen: boolean;
  onWorkspaceChange: (selection: WorkspaceSelection) => void;
  onIssueSelect: (id: string) => void;
  onSearch: (value: string) => void;
  onSignOut: () => void;
  onClose: () => void;
}

function initials(name: string): string {
  return name.trim().split(/\s+/).map((part) => part[0] ?? "").join("").slice(0, 2).toUpperCase() || "?";
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Unable to load channels.";
}

export function Sidebar({
  sessionUser,
  workspaces,
  workspace,
  issues,
  selectedIssueId,
  searchQuery,
  workspacesLoading,
  issuesLoading,
  workspacesError,
  issuesError,
  sidebarOpen,
  onWorkspaceChange,
  onIssueSelect,
  onSearch,
  onSignOut,
  onClose,
}: SidebarProps) {
  const filteredIssues = issues.filter((issue) =>
    `${issue.identifier} ${issue.title}`.toLowerCase().includes(searchQuery.trim().toLowerCase()),
  );
  const groups = filteredIssues.reduce<Record<string, IssueView[]>>((result, issue) => {
    const key = statusLabel(issue.status);
    (result[key] ??= []).push(issue);
    return result;
  }, {});

  function handleWorkspace(event: ChangeEvent<HTMLSelectElement>) {
    const selected = workspaces.find((item) => item.id === event.target.value);
    if (selected) onWorkspaceChange({ workspaceId: selected.id, workspaceSlug: selected.slug });
  }

  return (
    <aside className={`workspace-sidebar ${sidebarOpen ? "is-open" : ""}`} aria-label="Workspace navigation">
      <div className="brand-row">
        <div className="brand-mark">M</div>
        <div><strong>Multica</strong><span>Team workspace</span></div>
        <button className="icon-button mobile-only" type="button" onClick={onClose} aria-label="Close navigation"><X size={18} /></button>
      </div>
      <div className="profile-row">
        <div className="mini-avatar">{initials(sessionUser?.name ?? "You")}</div>
        <div className="profile-copy"><strong>{sessionUser?.name ?? "Signed-in user"}</strong><span>{sessionUser?.email ?? ""}</span></div>
        <button className="text-button" type="button" onClick={onSignOut}>Sign out</button>
      </div>
      <label className="field-label workspace-select">
        <span>Workspace</span>
        <select value={workspace?.workspaceId ?? ""} onChange={handleWorkspace} disabled={workspacesLoading || workspaces.length === 0}>
          <option value="" disabled>Select workspace</option>
          {workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <label className="search-box">
        <Search size={16} aria-hidden="true" />
        <span className="sr-only">Search channels</span>
        <input value={searchQuery} onChange={(event) => onSearch(event.target.value)} placeholder="Search channels" />
      </label>
      <div className="sidebar-heading"><span>Channels</span><span className="count-badge">{filteredIssues.length}</span></div>
      <div className="channel-list" aria-live="polite">
        {workspacesLoading || issuesLoading ? <div className="sidebar-state"><span className="loading-line" /><span className="loading-line short" /></div> : workspacesError || issuesError ? <div className="sidebar-state error-state"><AlertCircle size={16} aria-hidden="true" /><span>{errorText(workspacesError ?? issuesError)}</span></div> : filteredIssues.length === 0 ? <div className="sidebar-state"><Hash size={16} aria-hidden="true" /><span>{searchQuery ? "No channels match your search." : "No channels in this workspace yet."}</span></div> : Object.entries(groups).map(([group, groupIssues]) => <section key={group} className="channel-group"><h2>{group}</h2>{groupIssues.map((issue) => <button className={`channel-item ${issue.id === selectedIssueId ? "selected" : ""}`} key={issue.id} type="button" onClick={() => { onIssueSelect(issue.id); onClose(); }}><span className="channel-item-main"><Hash size={15} aria-hidden="true" /><strong>{issue.identifier}</strong><span className={statusClass(issue.status)} title={statusLabel(issue.status)} /></span><span className="channel-item-title">{issue.title}</span></button>)}</section>)}
      </div>
      <div className="sidebar-footer"><Users size={15} aria-hidden="true" /><span>Participants are sourced from Multica</span></div>
    </aside>
  );
}
