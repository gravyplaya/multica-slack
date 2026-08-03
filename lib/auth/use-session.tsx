"use client";

/**
 * React adapter for the SessionStore.
 *
 * The store itself is framework-agnostic (`MemorySessionStore` /
 * `BrowserSessionStore` in `session-source.ts`). This module exposes:
 *
 * 1. `SessionSourceContext` — the React context that carries the
 *    store instance created by `<Providers>`.
 * 2. `useSessionStore()` — returns the raw store. Components use it
 *    to call `set` / `clear` (sign-in, sign-out) and to subscribe
 *    to changes.
 * 3. `useSession()` — a reactive hook that returns the current
 *    `SessionState | null` and re-renders when it changes.
 *
 * The hook intentionally re-renders on every change so that a
 * top-level component can switch between the sign-in page and the
 * authenticated shell. Stage 3+ will refine this with selector hooks
 * once the auth boundary is the dominant re-render trigger.
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import type { SessionState } from "../types";
import type { SessionStore } from "./session-source";

export const SessionSourceContext = createContext<SessionStore | null>(null);

export function useSessionStore(): SessionStore {
  const store = useContext(SessionSourceContext);
  if (!store) {
    throw new Error(
      "useSessionStore called outside <Providers>. " +
        "Wrap your tree in app/providers.tsx so a SessionStore is mounted.",
    );
  }
  return store;
}

/**
 * Reactive subscription to the session. The returned value is the
 * current `SessionState` or `null` when signed out. Re-renders on
 * every change so call sites stay simple; components that need
 * fine-grained slicing can read individual fields directly.
 *
 * Implementation note: the lazy `useState` initializer captures the
 * current value at first render, and the effect's `store.subscribe`
 * callback picks up every subsequent change. The subscriber invokes
 * `setSession` from outside React's render path, which is the
 * recommended pattern for external state subscriptions.
 */
export function useSession(): SessionState | null {
  const store = useSessionStore();
  const [session, setSession] = useState<SessionState | null>(() => store.get());
  useEffect(() => store.subscribe((next) => setSession(next)), [store]);
  return session;
}

/**
 * Convenience provider wrapper. Mirrors the shape of
 * `app/providers.tsx` so an alternative test harness can mount the
 * session source in isolation (e.g. for component tests that want to
 * simulate sign-in without booting the rest of the providers).
 */
export function SessionSourceProvider({
  store,
  children,
}: {
  store: SessionStore;
  children: ReactNode;
}) {
  return (
    <SessionSourceContext.Provider value={store}>
      {children}
    </SessionSourceContext.Provider>
  );
}
