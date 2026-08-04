"use client";

import { AlertCircle, FileText, Hash } from "lucide-react";

import { mapAgent, mapUser } from "../../lib/mappers";
import type { AuthorType } from "../../lib/enums";
import type { AgentView, CommentView, IssueView, UserView } from "../../lib/types";
import { statusClass, statusLabel } from "./status";

export interface ParticipantDirectory {
  members: ReadonlyMap<string, UserView>;
  agents: ReadonlyMap<string, AgentView>;
}

export interface MessageListProps extends ParticipantDirectory {
  issue: IssueView;
  comments: CommentView[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

export function formatMessageDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

export function formatMessageDateTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function participantName(
  participant: { type: AuthorType; id: string },
  directory: ParticipantDirectory,
): string {
  const record = participant.type === "agent"
    ? directory.agents.get(participant.id)
    : directory.members.get(participant.id);
  if (record) return record.name;
  return `${participant.type === "agent" ? "Agent" : "Member"} · ${participant.id.slice(0, 8)}`;
}

function initials(name: string): string {
  return name.trim().split(/\s+/).map((part) => part[0] ?? "").join("").slice(0, 2).toUpperCase() || "?";
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Unable to load messages.";
}

function MessageItem({
  comment,
  directory,
  pending,
}: {
  comment: CommentView;
  directory: ParticipantDirectory;
  pending: boolean;
}) {
  const name = participantName(comment.author, directory);
  const avatarUrl = comment.author.type === "agent"
    ? directory.agents.get(comment.author.id)?.avatarUrl
    : directory.members.get(comment.author.id)?.avatarUrl;

  return (
    <article className={`message${pending ? " message-pending" : ""}`}>
      {avatarUrl ? (
        // The URL is supplied by the API as an optional avatar field.
        // eslint-disable-next-line @next/next/no-img-element
        <img className="avatar" src={avatarUrl} alt="" />
      ) : (
        <div className={`avatar avatar-${comment.author.type}`} aria-hidden="true">{initials(name)}</div>
      )}
      <div className="message-body">
        <div className="message-meta">
          <strong>{name}</strong>
          <span className="author-kind">{comment.author.type}</span>
          <time dateTime={comment.createdAt.toISOString()} title={formatMessageDateTime(comment.createdAt)}>{formatMessageDate(comment.createdAt)}</time>
          {pending ? <span className="message-state">Sending…</span> : null}
        </div>
        <p>{comment.content}</p>
        {comment.attachments.length > 0 ? (
          <div className="attachment-list" aria-label="Attachments">
            {comment.attachments.map((attachment) => (
              <a key={attachment.id} href={attachment.downloadUrl} target="_blank" rel="noreferrer">
                <FileText size={14} aria-hidden="true" />{attachment.filename}
              </a>
            ))}
          </div>
        ) : null}
        {comment.reactions.length > 0 ? (
          <div className="reaction-list" aria-label="Reactions">
            {Array.from(new Set(comment.reactions.map((reaction) => reaction.emoji))).map((emoji) => (
              <span key={emoji}>{emoji} {comment.reactions.filter((reaction) => reaction.emoji === emoji).length}</span>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function ActivityNotice({ issue }: { issue: IssueView }) {
  return (
    <div className="activity-notice" role="status" aria-label="Issue activity">
      <span className={statusClass(issue.status)} aria-hidden="true" />
      <span>Issue status · <strong>{statusLabel(issue.status)}</strong></span>
      <span className="activity-source">from issue metadata</span>
      <time dateTime={issue.updatedAt.toISOString()}>{formatMessageDate(issue.updatedAt)}</time>
    </div>
  );
}

export function MessageList({
  issue,
  comments,
  members,
  agents,
  isLoading,
  error,
  onRetry,
}: MessageListProps) {
  const directory = { members, agents };
  return (
    <div className="message-list" aria-live="polite">
      <ActivityNotice issue={issue} />
      {isLoading ? (
        <div className="content-state"><span className="spinner" aria-hidden="true" /><p>Loading messages…</p></div>
      ) : error ? (
        <div className="content-state error-state"><AlertCircle size={20} aria-hidden="true" /><p>{errorText(error)}</p><button className="secondary-button" type="button" onClick={onRetry}>Retry</button></div>
      ) : comments.length === 0 ? (
        <div className="content-state"><Hash size={24} aria-hidden="true" /><h2>No messages yet</h2><p>Start the conversation in this channel.</p></div>
      ) : (
        comments.map((comment) => <MessageItem key={comment.id} comment={comment} directory={directory} pending={comment.id.startsWith("optimistic-")} />)
      )}
    </div>
  );
}

export function mapMemberUser(wire: unknown): UserView {
  return mapUser(wire);
}

export function mapWorkspaceAgent(wire: unknown): AgentView {
  return mapAgent(wire);
}
