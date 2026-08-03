/**
 * React hook bindings for the vanilla view store.
 *
 * `useViewStore` is a thin wrapper around `zustand/vanilla`'s
 * `createStore` so the same store instance can be used outside React
 * (tests, scripts) without bringing in a context provider that
 * doesn't actually need one.
 */

"use client";

import { createContext, useContext } from "react";
import { useStore } from "zustand";

import { createViewStore, type ViewState } from "./view-store";

let singletonStore: ReturnType<typeof createViewStore> | null = null;

export function getViewStore(): ReturnType<typeof createViewStore> {
  if (singletonStore === null) {
    singletonStore = createViewStore();
  }
  return singletonStore;
}

/**
 * Subscribe to the view store from a component. Use the selector form
 * to avoid re-renders on unrelated state changes.
 */
export function useViewStore<T>(selector: (state: ViewState) => T): T {
  return useStore(getViewStore(), selector);
}

/**
 * Optional context wrapper. The view store is a singleton via
 * `getViewStore()`, but a context wrapper keeps SSR rendering safe
 * when the tree is rendered on the server (the store is created
 * lazily on first access) and lets tests inject an isolated store.
 */
export const ViewStoreContext = createContext<ReturnType<typeof createViewStore> | null>(null);

export function useOptionalViewStore(): ReturnType<typeof createViewStore> | null {
  return useContext(ViewStoreContext);
}
