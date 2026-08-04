/**
 * Realtime status store.
 *
 * A small Zustand-vanilla store (no React runtime imports here) that
 * tracks the WebSocket manager's connection status. We keep this
 * out of the existing view store because:
 *
 * 1. The view store is keyed to the UI's selection + drawer
 *    preferences; mixing in a transient connection state would
 *    cause unrelated subscribers to re-render.
 * 2. The status is intentionally write-only from the
 *    `WebSocketManager`'s perspective; the store just remembers
 *    the last value any subscriber can read.
 *
 * The hook is inlined at the top of `useRealtimeStatus` so the
 * store import only ships when a component actually subscribes.
 */

import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";

import type { CloseReason, ConnectionStatus } from "./events-types";

export type RealtimeStoreState = {
  status: ConnectionStatus;
  reason: CloseReason;
};

export type RealtimeStore = StoreApi<RealtimeStoreState>;

let store: RealtimeStore | null = null;

export function getRealtimeStore(): RealtimeStore {
  if (!store) {
    store = createStore<RealtimeStoreState>(() => ({
      status: "idle",
      reason: { code: null, reason: "not started" },
    }));
  }
  return store;
}

/**
 * Update the connection status. Called by the `WebSocketManager`'s
 * status callback. Idempotent — setting the same value with the
 * same reason is a no-op so we do not wake subscribers for noise.
 */
export function setRealtimeStatus(status: ConnectionStatus, reason: CloseReason): void {
  const current = getRealtimeStore().getState();
  if (current.status === status && current.reason.reason === reason.reason) {
    return;
  }
  getRealtimeStore().setState({ status, reason });
}

/**
 * Read the current connection status. Re-renders when the status
 * changes; reason is intentionally not exposed so the indicator
 * does not reflow on every transient reason bump.
 */
export function useRealtimeStatusFromStore(): ConnectionStatus {
  return useStore(getRealtimeStore(), (state) => state.status);
}
