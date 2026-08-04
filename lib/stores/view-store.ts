/**
 * View store (Zustand).
 *
 * Zustand owns ONLY view state per the Stage 2 plan:
 * - selected issue/channel
 * - drawer + right-panel visibility
 * - sidebar search query
 * - per-issue composer drafts (preserved across navigation, cleared
 *   after a confirmed successful comment mutation)
 *
 * Server state (issues, comments, agents, workspaces, the session
 * itself) lives in TanStack Query and the session source. The view
 * store never holds a credential, never fetches anything, and never
 * touches `localStorage` directly. That boundary is enforced by the
 * fact that this file does not import any browser API.
 */

import { createStore, type StoreApi } from "zustand/vanilla";

import type { WorkspaceSelection } from "../types";

export type DrawerId = "sidebar" | "details" | "compose";

export interface ViewState {
  /** Currently selected workspace. `null` means no workspace chosen yet. */
  selectedWorkspace: WorkspaceSelection | null;
  /** Currently selected issue (channel). `null` means nothing selected. */
  selectedIssueId: string | null;
  /** Sidebar search query. */
  searchQuery: string;
  /** Open drawers. Used by the responsive layout. */
  openDrawers: Record<DrawerId, boolean>;
  /** Right details panel visibility on desktop. */
  rightPanelVisible: boolean;
  /**
   * Per-issue composer drafts. Drafts survive navigation; the
   * mutations layer is responsible for clearing them after a
   * confirmed successful send.
   */
  draftsByIssueId: Record<string, string>;

  // Selectors / mutations
  selectWorkspace(next: WorkspaceSelection | null): void;
  selectIssue(id: string | null): void;
  setSearchQuery(query: string): void;
  toggleDrawer(id: DrawerId, force?: boolean): void;
  setRightPanelVisible(visible: boolean): void;
  setDraft(issueId: string, content: string): void;
  clearDraft(issueId: string): void;
  resetForSignOut(): void;
}

const INITIAL_STATE: Omit<
  ViewState,
  | "selectWorkspace"
  | "selectIssue"
  | "setSearchQuery"
  | "toggleDrawer"
  | "setRightPanelVisible"
  | "setDraft"
  | "clearDraft"
  | "resetForSignOut"
> = {
  selectedWorkspace: null,
  selectedIssueId: null,
  searchQuery: "",
  openDrawers: { sidebar: true, details: false, compose: false },
  rightPanelVisible: true,
  draftsByIssueId: {},
};

export function createViewStore(): StoreApi<ViewState> {
  return createStore<ViewState>((set) => ({
    ...INITIAL_STATE,
    selectWorkspace(next) {
      set((state) => ({
        selectedWorkspace: next,
        selectedIssueId:
          next && state.selectedWorkspace?.workspaceId === next.workspaceId
            ? state.selectedIssueId
            : null,
      }));
    },
    selectIssue(id) {
      set({ selectedIssueId: id });
    },
    setSearchQuery(query) {
      set({ searchQuery: query });
    },
    toggleDrawer(id, force) {
      set((state) => ({
        openDrawers: {
          ...state.openDrawers,
          [id]: force ?? !state.openDrawers[id],
        },
      }));
    },
    setRightPanelVisible(visible) {
      set({ rightPanelVisible: visible });
    },
    setDraft(issueId, content) {
      set((state) => ({
        draftsByIssueId: {
          ...state.draftsByIssueId,
          [issueId]: content,
        },
      }));
    },
    clearDraft(issueId) {
      set((state) => {
        if (!(issueId in state.draftsByIssueId)) return state;
        const next = { ...state.draftsByIssueId };
        delete next[issueId];
        return { draftsByIssueId: next };
      });
    },
    resetForSignOut() {
      // Wipe everything; drafts are sensitive enough that we never
      // carry them across a sign-out boundary even when the user
      // signs back into the same workspace.
      set({ ...INITIAL_STATE });
    },
  }));
}

/**
 * Convenience selector helpers — pure functions over the state so
 * components can compose them with `useStore(store, selector)` without
 * re-rendering on unrelated state changes.
 */
export const selectSelectedWorkspace = (s: ViewState): WorkspaceSelection | null =>
  s.selectedWorkspace;
export const selectSelectedIssueId = (s: ViewState): string | null => s.selectedIssueId;
export const selectSearchQuery = (s: ViewState): string => s.searchQuery;
export const selectRightPanelVisible = (s: ViewState): boolean => s.rightPanelVisible;
export const selectDraftFor =
  (issueId: string) =>
  (s: ViewState): string =>
    s.draftsByIssueId[issueId] ?? "";
export const selectIsDrawerOpen =
  (id: DrawerId) =>
  (s: ViewState): boolean =>
    Boolean(s.openDrawers[id]);
