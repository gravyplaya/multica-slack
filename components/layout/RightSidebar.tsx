import { X } from "lucide-react";

import type { AgentView, IssueView, UserView } from "../../lib/types";
import { participantName } from "../chat/MessageList";
import { statusClass, statusLabel } from "../chat/status";

export interface RightSidebarProps {
  issue: IssueView | null;
  members: ReadonlyMap<string, UserView>;
  agents: ReadonlyMap<string, AgentView>;
  membersLoading: boolean;
  agentsLoading: boolean;
  participantsError: unknown;
  open: boolean;
  onClose: () => void;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function RightSidebar({
  issue,
  members,
  agents,
  membersLoading,
  agentsLoading,
  participantsError,
  open,
  onClose,
}: RightSidebarProps) {
  if (!open || !issue) return null;
  return (
    <aside className="details-panel" id="details-panel" aria-label="Issue details">
      <div className="details-heading">
        <div><span className="eyebrow">Channel details</span><h2>{issue.identifier}</h2></div>
        <button className="icon-button mobile-only" type="button" onClick={onClose} aria-label="Close issue details"><X size={18} /></button>
      </div>
      <div className="details-status"><span className={statusClass(issue.status)} /> <strong>{statusLabel(issue.status)}</strong></div>
      <dl>
        <dt>Priority</dt><dd><span className={`priority priority-${issue.priority}`}>{issue.priority}</span></dd>
        <dt>Assignee</dt><dd>{issue.assignee ? <span className="identity-chip"><span className="mini-avatar">{issue.assignee.type === "agent" ? "A" : "M"}</span>{participantName(issue.assignee, { members, agents })}<small>{issue.assignee.type}</small></span> : "Unassigned"}</dd>
        <dt>Project</dt><dd>{issue.projectId ?? "No project"}</dd>
        <dt>Created</dt><dd>{formatDate(issue.createdAt)}</dd>
        <dt>Updated</dt><dd>{formatDate(issue.updatedAt)}</dd>
        {issue.dueDate ? <><dt>Due</dt><dd>{formatDate(issue.dueDate)}</dd></> : null}
      </dl>
      {issue.description ? <section className="description-block"><h3>Description</h3><p>{issue.description}</p></section> : null}
      <section className="presence-block">
        <h3>Participants</h3>
        {membersLoading || agentsLoading ? <p className="muted">Loading participants…</p> : participantsError ? <p className="muted">Participant data unavailable.</p> : <div className="presence-list">{Array.from(members.values()).slice(0, 4).map((member) => <div className="presence-item" key={`member-${member.id}`}><span className="presence-dot unknown" /><span>{member.name}</span><small>member · unknown</small></div>)}{Array.from(agents.values()).filter((agent) => !agent.archivedAt).slice(0, 4).map((agent) => <div className="presence-item" key={`agent-${agent.id}`}><span className={`presence-dot ${agent.status || "unknown"}`} /><span>{agent.name}</span><small>agent · {agent.status || "unknown"}</small></div>)}</div>}
      </section>
    </aside>
  );
}
