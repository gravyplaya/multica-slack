"use client";

/**
 * React hook + context that exposes a `MulticaClient` for the entire
 * component tree.
 *
 * Why a context (and not just a top-level module singleton):
 *
 * The Stage 2 sign-in flow needs a `MulticaClient` BEFORE the user is
 * signed in — `signInWithApiKey` swaps in a probe session and calls
 * `GET /api/me` to validate the key. The previous design made
 * `useMulticaClient()` return `null` until a session existed, which
 * forced the API-key form into a defensive "no client in the
 * provider tree" branch and silently broke the submit path.
 *
 * The fix: mount a placeholder `MulticaClient` at the provider root
 * that is always present, and call `setSession` on the same instance
 * whenever the session changes. From the consumer's perspective the
 * hook now always returns a `MulticaClient` — the placeholder works
 * for public endpoints (`/auth/send-code`, `/auth/verify-code`,
 * `/auth/logout`) and for any unauthenticated probe that explicitly
 * swaps in its own session via `client.setSession(...)` before
 * calling `getCurrentUser()`.
 *
 * The placeholder session carries a `placeholder` bearer that the
 * network layer drops on `unauthenticated: true` requests. Callers
 * that want a real call must `setSession(...)` first — see
 * `lib/api/client.ts` for the credential-swap mechanic.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";

import { MulticaClient } from "../lib/api/client";
import { API_BASE_URL, WS_URL } from "../lib/api/config";
import type { SessionState, WorkspaceSelection } from "../lib/types";

export interface UseMulticaClientOptions {
  workspace?: WorkspaceSelection | null;
  /**
   * Override the underlying `fetch` — only used in tests. Production
   * callers leave it unset so the global `fetch` is used.
   */
  fetchImpl?: typeof fetch;
}

const MulticaClientContext = createContext<MulticaClient | null>(null);
MulticaClientContext.displayName = "MulticaClientContext";

/**
 * Build the placeholder `SessionState` the signed-out tree uses.
 * The credential is the literal string `placeholder` (matching the
 * convention `SignInPage` already used locally); the network layer
 * drops the bearer on unauthenticated calls and any later caller
 * that wants a real call must `setSession(...)` first.
 *
 * `source: "api-key"` is the same placeholder convention the
 * pre-fix `SignInPage` used. The placeholder is NOT a real session:
 * a misuse that branches on `client.getSession().source` to decide
 * whether to render authenticated UI would be wrong, because the
 * placeholder is only valid for unauthenticated public calls. The
 * canonical way to gate on "is the user signed in?" is
 * `useSession() !== null` — never the client's session.
 */
function buildPlaceholderSession(backendOrigin: string): SessionState {
  return {
    source: "api-key",
    backendOrigin,
    token: "placeholder",
    user: null,
  };
}

export interface MulticaClientProviderProps {
  children: ReactNode;
  /**
   * The current session, or `null` if the user is signed out. The
   * provider swaps the underlying client's session in/out so the
   * context value is always a `MulticaClient` (session-bound when
   * the user is signed in, placeholder otherwise).
   */
  session: SessionState | null;
  /**
   * Override the underlying `fetch` — only used in tests. Production
   * callers leave it unset so the global `fetch` is used.
   */
  fetchImpl?: typeof fetch;
}

/**
 * Provider that mounts a `MulticaClient` in the tree. The instance
 * is stable for the lifetime of the provider; only the session it
 * carries changes, and we keep that swap cheap by calling
 * `setSession` (no re-allocation) so React Query keys that are
 * derived from the client instance stay stable.
 */
export function MulticaClientProvider({
  children,
  session,
  fetchImpl,
}: MulticaClientProviderProps) {
  const client = useMemo(() => {
    const initial: SessionState = session ?? buildPlaceholderSession(API_BASE_URL);
    return new MulticaClient({
      session: initial,
      fetchImpl,
      config: { apiBaseUrl: API_BASE_URL, wsUrl: WS_URL },
    });
    // The client is built once per (fetchImpl) — subsequent session
    // changes flow through the effect below so sign-in / sign-out
    // re-use the same instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchImpl]);

  // Keep the client's session in lock-step with the store. We use
  // an effect (not a render-time call) so the swap happens after
  // React has committed, which keeps the client's "current session"
  // consistent with the rest of the tree even when renders interleave.
  useEffect(() => {
    client.setSession(session ?? buildPlaceholderSession(API_BASE_URL));
  }, [client, session]);

  return (
    <MulticaClientContext.Provider value={client}>
      {children}
    </MulticaClientContext.Provider>
  );
}

/**
 * Read the mounted `MulticaClient` from the provider tree. Throws
 * when no provider is mounted so misuse is loud (this used to
 * silently return `null`, which is the bug the Stage 2 review
 * caught).
 */
export function useMulticaClientContext(): MulticaClient {
  const client = useContext(MulticaClientContext);
  if (!client) {
    throw new Error(
      "useMulticaClient called outside <MulticaClientProvider>. " +
        "Wrap your tree in app/providers.tsx so a client is mounted at the root.",
    );
  }
  return client;
}

/**
 * Backwards-compatible hook: the pre-fix signature returned
 * `MulticaClient | null`. After the Stage 2 fix the provider is
 * always mounted, so the hook now always returns a `MulticaClient`.
 *
 * Callers that needed to gate on "do we have a session?" should
 * read the session directly via `useSession()` instead — the
 * client instance is meaningful even when it carries the
 * placeholder, and the provider keeps the client's session
 * in lock-step with the store.
 *
 * The `workspace` option is forwarded to the same client instance
 * via `setWorkspace` so React Query keys that include the client
 * stay stable. Callers that need a new client (e.g. tests
 * injecting a custom `fetchImpl`) can pass `fetchImpl` here.
 */
export function useMulticaClient(
  options: UseMulticaClientOptions = {},
): MulticaClient {
  const client = useMulticaClientContext();
  // Forward the optional `workspace` selection to the same client
  // instance via an effect (never a render-time call) so React
  // Query keys that include the client stay stable across renders.
  // The provider owns session lifecycle; this hook owns per-call
  // workspace selection.
  useEffect(() => {
    if (options.workspace !== undefined) {
      client.setWorkspace(options.workspace ?? null);
    }
  }, [client, options.workspace]);
  return client;
}

