import { describe, expect, it } from "vitest";

import { createOptimisticComment, mergeCommentViews, removeOptimisticComment } from "./optimistic-comments";
import type { CommentView } from "../types";

const author = { type: "member" as const, id: "user-1" };

function comment(id: string, createdAt: string, content = id): CommentView {
  const date = new Date(createdAt);
  return {
    id,
    issueId: "issue-1",
    author,
    content,
    type: "comment",
    parentId: null,
    createdAt: date,
    updatedAt: date,
    resolvedAt: null,
    resolvedBy: null,
    sourceTaskId: null,
    reactions: [],
    attachments: [],
  };
}

describe("optimistic comment helpers", () => {
  it("creates a visibly pending comment with a client-only id", () => {
    const now = new Date("2026-08-04T12:00:00Z");
    const result = createOptimisticComment({ id: "optimistic-1", issueId: "issue-1", content: "  hello  ", author, now });
    expect(result).toMatchObject({ id: "optimistic-1", issueId: "issue-1", content: "hello", author, type: "comment", createdAt: now, updatedAt: now });
  });

  it("sorts comments chronologically and suppresses duplicate server ids", () => {
    const older = comment("older", "2026-08-04T11:00:00Z");
    const newer = comment("newer", "2026-08-04T13:00:00Z");
    const replacement = comment("newer", "2026-08-04T13:00:00Z", "server version");
    expect(mergeCommentViews([newer, older], replacement).map((item) => item.content)).toEqual(["older", "server version"]);
  });

  it("removes only the failed optimistic comment", () => {
    const pending = comment("optimistic-1", "2026-08-04T12:00:00Z");
    const existing = comment("existing", "2026-08-04T11:00:00Z");
    expect(removeOptimisticComment([pending, existing], pending.id)).toEqual([existing]);
  });
});
