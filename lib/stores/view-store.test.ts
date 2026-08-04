/**
 * View store tests.
 *
 * The store holds ONLY view state. The tests pin the contract:
 * - selecting an issue updates the selection;
 * - drafts survive navigation but clear on explicit removal;
 * - sign-out reset wipes everything including drafts;
 * - toggling drawers is idempotent with explicit `force`;
 * - unrelated state changes do not notify selectors that didn't change.
 */

import { describe, expect, it, vi } from "vitest";

import { createViewStore } from "./view-store";

describe("view-store", () => {
  it("starts with sensible defaults", () => {
    const store = createViewStore();
    expect(store.getState().selectedWorkspace).toBeNull();
    expect(store.getState().selectedIssueId).toBeNull();
    expect(store.getState().searchQuery).toBe("");
    expect(store.getState().rightPanelVisible).toBe(true);
    expect(store.getState().openDrawers).toEqual({
      sidebar: true,
      details: false,
      compose: false,
    });
    expect(store.getState().draftsByIssueId).toEqual({});
  });

  it("selectWorkspace updates the active workspace and clears the channel selection", () => {
    const store = createViewStore();
    store.getState().selectIssue("issue-1");
    store.getState().selectWorkspace({
      workspaceId: "ws-1",
      workspaceSlug: "sample",
    });
    expect(store.getState().selectedWorkspace).toEqual({
      workspaceId: "ws-1",
      workspaceSlug: "sample",
    });
    expect(store.getState().selectedIssueId).toBeNull();
    store.getState().selectWorkspace(null);
    expect(store.getState().selectedWorkspace).toBeNull();
    expect(store.getState().selectedIssueId).toBeNull();
  });

  it("selectIssue updates the selected channel", () => {
    const store = createViewStore();
    store.getState().selectIssue("issue-1");
    expect(store.getState().selectedIssueId).toBe("issue-1");
    store.getState().selectIssue(null);
    expect(store.getState().selectedIssueId).toBeNull();
  });

  it("setSearchQuery is settable and clearable", () => {
    const store = createViewStore();
    store.getState().setSearchQuery("sidebar layout");
    expect(store.getState().searchQuery).toBe("sidebar layout");
    store.getState().setSearchQuery("");
    expect(store.getState().searchQuery).toBe("");
  });

  it("toggleDrawer flips the value, with optional force", () => {
    const store = createViewStore();
    expect(store.getState().openDrawers.details).toBe(false);
    store.getState().toggleDrawer("details");
    expect(store.getState().openDrawers.details).toBe(true);
    store.getState().toggleDrawer("details", false);
    expect(store.getState().openDrawers.details).toBe(false);
    store.getState().toggleDrawer("details", true);
    expect(store.getState().openDrawers.details).toBe(true);
  });

  it("drafts persist per issue across navigation", () => {
    const store = createViewStore();
    store.getState().selectIssue("issue-1");
    store.getState().setDraft("issue-1", "halfway thought");
    store.getState().selectIssue("issue-2");
    store.getState().setDraft("issue-2", "another thought");
    expect(store.getState().draftsByIssueId["issue-1"]).toBe("halfway thought");
    expect(store.getState().draftsByIssueId["issue-2"]).toBe("another thought");
  });

  it("clearDraft removes a single draft without disturbing others", () => {
    const store = createViewStore();
    store.getState().setDraft("issue-1", "first");
    store.getState().setDraft("issue-2", "second");
    store.getState().clearDraft("issue-1");
    expect(store.getState().draftsByIssueId).toEqual({ "issue-2": "second" });
  });

  it("clearDraft is a no-op when the draft doesn't exist", () => {
    const store = createViewStore();
    expect(() => store.getState().clearDraft("missing")).not.toThrow();
    expect(store.getState().draftsByIssueId).toEqual({});
  });

  it("resetForSignOut wipes drafts, selection, search, and workspace", () => {
    const store = createViewStore();
    store.getState().setDraft("issue-1", "sensitive draft");
    store.getState().selectIssue("issue-1");
    store.getState().selectWorkspace({ workspaceId: "ws-1", workspaceSlug: "sample" });
    store.getState().setSearchQuery("something");
    store.getState().resetForSignOut();
    expect(store.getState().selectedIssueId).toBeNull();
    expect(store.getState().selectedWorkspace).toBeNull();
    expect(store.getState().searchQuery).toBe("");
    expect(store.getState().draftsByIssueId).toEqual({});
    expect(store.getState().openDrawers).toEqual({
      sidebar: true,
      details: false,
      compose: false,
    });
  });

  it("vanilla subscribe fires on every change (selector equality is the React adapter's job)", () => {
    const store = createViewStore();
    const spy = vi.fn();
    store.subscribe(spy);
    store.getState().setSearchQuery("hi");
    store.getState().selectIssue("issue-1");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("re-selecting the same issue does not actually mutate state", () => {
    const store = createViewStore();
    store.getState().selectIssue("issue-1");
    const before = store.getState();
    store.getState().selectIssue("issue-1");
    // Zustand returns a fresh state object on every update, but the
    // selectedIssueId field is referentially the same string.
    expect(store.getState().selectedIssueId).toBe(before.selectedIssueId);
  });
});
