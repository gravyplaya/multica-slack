"use client";

/**
 * App-wide providers.
 *
 * Four responsibilities, mounted in this order:
 *
 * 1. `QueryClientProvider` — TanStack Query owns ALL server state.
 *    The default `staleTime` is 30s for issue/comment data and 10s
 *    for agents; both are below the WebSocket push cadence, so the
 *    realtime layer can rely on targeted invalidations rather than
 *    polling.
 *
 * 2. `SessionSourceProvider` — the single browser-side session store
 *    (`BrowserSessionStore`) keyed by the configured backend origin.
 *    Components read the session through `useSession()` and never
 *    touch `localStorage` directly.
 *
 * 3. `MulticaClientProvider` — mounts a `MulticaClient` in the
 *    context. The instance is built once and its session is kept in
 *    lock-step with the SessionStore: signed-out callers see a
 *    placeholder client that works for public endpoints
 *    (`/auth/send-code`, `/auth/verify-code`, `/auth/logout`); signed-in
 *    callers see the same instance carrying their real session.
 *    This is the fix for the Stage 2 review — the API-key sign-in
 *    form used to short-circuit on "no MulticaClient in the provider
 *    tree" because `useMulticaClient()` returned `null` before a
 *    session existed.
 *
 * 4. `ViewStoreProvider` — the Zustand view store. The store is
 *    already a singleton via `getViewStore()`, but a context wrapper
 *    keeps SSR rendering safe when the tree is rendered on the
 *    server (the store is created lazily on first access).
 */

import {
  QueryClient,
  QueryClientProvider,
  type QueryClientConfig,
} from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";

import { API_BASE_URL } from "../lib/api/config";
import {
  BrowserSessionStore,
  MemorySessionStore,
  type SessionStore,
} from "../lib/auth/session-source";
import { SessionSourceContext, useSession } from "../lib/auth/use-session";
import { getViewStore, ViewStoreContext } from "../lib/stores/use-view-store";
import { MulticaClientProvider } from "../hooks/use-multica-client";

const QUERY_DEFAULTS: QueryClientConfig = {
  defaultOptions: {
    queries: {
      // Realtime push (Stage 4) invalidates by query key, so we keep
      // polling cheap by default — only refetch on focus and on
      // explicit invalidation.
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
    },
    mutations: {
      retry: 0,
    },
  },
};

export interface ProvidersProps {
  children: ReactNode;
  /**
   * Override the underlying `fetch` for the mounted `MulticaClient`.
   * Production callers leave this unset so the global `fetch` is
   * used. Component tests pass a mock to exercise the network layer
   * without booting a real backend.
   */
  fetchImpl?: typeof fetch;
}

export function Providers({ children, fetchImpl }: ProvidersProps) {
  const [queryClient] = useState(() => new QueryClient(QUERY_DEFAULTS));
  const sessionStore = useMemo<SessionStore>(
    () => createSessionStore(API_BASE_URL),
    [],
  );
  const viewStore = useMemo(() => getViewStore(), []);

  return (
    <QueryClientProvider client={queryClient}>
      <SessionSourceContext.Provider value={sessionStore}>
        <MulticaClientBridge fetchImpl={fetchImpl}>
          <ViewStoreContext.Provider value={viewStore}>
            {children}
          </ViewStoreContext.Provider>
        </MulticaClientBridge>
      </SessionSourceContext.Provider>
    </QueryClientProvider>
  );
}

/**
 * Thin bridge that reads the live session from the SessionStore and
 * passes it down to `MulticaClientProvider`. Lifting the session
 * read out of `Providers` keeps the SessionSourceProvider and
 * MulticaClientProvider decoupled: the store is the single source of
 * truth, and the client mirror just follows.
 */
function MulticaClientBridge({
  children,
  fetchImpl,
}: {
  children: ReactNode;
  fetchImpl?: typeof fetch;
}) {
  const session = useSession();
  return (
    <MulticaClientProvider session={session} fetchImpl={fetchImpl}>
      {children}
    </MulticaClientProvider>
  );
}

function createSessionStore(backendOrigin: string): SessionStore {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return new MemorySessionStore();
  }
  return new BrowserSessionStore(backendOrigin);
}

/**
 * Re-export for convenience: `import { useSession } from
 * "@/app/providers"` is the documented entry point for components.
 */
export { useSession };
