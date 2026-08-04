import type { AuthorType } from "../enums";
import type { CommentView, ParticipantRef } from "../types";

export interface OptimisticCommentInput {
  id: string;
  issueId: string;
  content: string;
  author: ParticipantRef;
  now?: Date;
}

export function createOptimisticComment(input: OptimisticCommentInput): CommentView {
  const content = input.content.trim();
  const now = input.now ?? new Date();
  return {
    id: input.id,
    issueId: input.issueId,
    author: input.author,
    content,
    type: "comment",
    parentId: null,
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
    resolvedBy: null,
    sourceTaskId: null,
    reactions: [],
    attachments: [],
  };
}

/** Replace an existing id and keep the result chronologically ordered. */
export function mergeCommentViews(comments: CommentView[], incoming: CommentView): CommentView[] {
  const withoutIncoming = comments.filter((comment) => comment.id !== incoming.id);
  return [...withoutIncoming, incoming].sort((a, b) => {
    const time = a.createdAt.getTime() - b.createdAt.getTime();
    return time || a.id.localeCompare(b.id);
  });
}

export function removeOptimisticComment(comments: CommentView[], id: string): CommentView[] {
  return comments.filter((comment) => comment.id !== id);
}

export function participant(type: AuthorType, id: string): ParticipantRef {
  return { type, id };
}
