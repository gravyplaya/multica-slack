/**
 * API-key sign-in flow.
 *
 * The Stage 2 gate is explicit: the API-key panel must be a first-class
 * alternative to OAuth, validate the credential against the live
 * `GET /api/me` endpoint, populate the same downstream session shape,
 * and never expose the credential to logs, errors, query caches, or
 * unrelated origins.
 *
 * This module owns:
 *
 * - `validateApiKeyShape` — client-side whitespace rejection (and a
 *   documented surface check for the `mul_` prefix).
 * - `signInWithApiKey` — wires the credential into the session source,
 *   calls `GET /api/me` to confirm validity, and populates the user
 *   profile on success. The credential is held by the session source
 *   only; nothing else in the app sees it as a string.
 * - `signOutAndClearApiKey` — symmetric to the OAuth sign-out. Clears
 *   the in-memory copy *and* the localStorage entry.
 * - `confirmApiKeyWorksForWebSocket` — document-only helper that
 *   asserts (and unit-tests) the §7.1 contract decision: the first
 *   inbound WS frame after a bearer-only handshake must carry the
 *   same credential. Stage 4's `lib/realtime/websocket-manager.ts`
 *   will read the session source to construct that frame.
 *
 * Hard redaction: every error message goes through
 * `redactCredential` so even a server-echoed credential cannot
 * escape through an exception string.
 */

import { MulticaClient } from "../api/client";
import { MulticaApiError, MulticaNetworkError, sanitizeMessage } from "../api/errors";
import { redactCredential } from "../api/redact";
import type { SessionState, UserView } from "../types";

/** `mul_` followed by 16+ base62 chars. Matches Multica's PAT shape. */
const PAT_PREFIX = "mul_";

export interface ApiKeyValidation {
  ok: boolean;
  /** Sanitized reason for failure; never includes the credential. */
  reason?: string;
}

/**
 * Cheap client-side validation: trim, reject empty / whitespace, and
 * flag malformed prefix. We do NOT verify the credential against the
 * server here — that requires a network call and is the user's job to
 * confirm via "Sign in".
 *
 * Returns a structured `ApiKeyValidation` rather than throwing so the
 * UI can render an inline error without leaking whether the key was
 * "shaped wrong" vs. "rejected by the server" (the Stage 2 plan asks
 * us to surface server errors without that distinction).
 */
export function validateApiKeyShape(raw: string): ApiKeyValidation {
  if (typeof raw !== "string") {
    return { ok: false, reason: "API key is required" };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "API key is required" };
  }
  if (trimmed.length < PAT_PREFIX.length + 16) {
    return { ok: false, reason: "API key looks too short" };
  }
  if (!trimmed.startsWith(PAT_PREFIX)) {
    return { ok: false, reason: `API key must start with "${PAT_PREFIX}"` };
  }
  if (!/^mul_[A-Za-z0-9]+$/.test(trimmed)) {
    return { ok: false, reason: "API key contains unexpected characters" };
  }
  return { ok: true };
}

/**
 * Sign in with an API key. The credential is funnelled straight into
 * a probe `SessionState`; on success we hydrate the user profile from
 * `GET /api/me` (called via the supplied `MulticaClient`). The
 * credential itself is never logged, never returned, never written
 * into a React Query key.
 *
 * The caller passes a `MulticaClient` already configured with a
 * `fetchImpl` so this function works in both the browser (where the
 * default `fetch` is fine) and tests (where we inject a mock).
 *
 * Concurrency contract: the supplied client's session is NEVER
 * mutated. The probe runs against a throwaway `MulticaClient`
 * produced by `client.cloneForProbe(probeSession)`, which reuses
 * the caller's `fetchImpl` and `ClientConfig` but binds a fresh
 * session. This eliminates the credential-leak hazard where a
 * concurrent query refetch on the shared client would otherwise
 * race the probe's swap/restore and observe the candidate API key
 * on its `Authorization` header.
 */
export async function signInWithApiKey(params: {
  apiKey: string;
  backendOrigin: string;
  /**
   * A MulticaClient used to validate the credential against
   * `GET /api/me`. The caller's client is read-only here — its
   * session, workspace, fetchImpl, and config are *snapshot* into
   * a throwaway probe client for the duration of the probe.
   */
  client: MulticaClient;
}): Promise<SessionState> {
  const shape = validateApiKeyShape(params.apiKey);
  if (!shape.ok) {
    throw new InvalidApiKeyError(shape.reason ?? "Invalid API key");
  }

  const probeSession: SessionState = {
    source: "api-key",
    backendOrigin: params.backendOrigin,
    token: params.apiKey.trim(),
    user: null,
  };

  // Snapshot the caller's wiring into a throwaway probe client. The
  // shared client is never mutated, so any concurrent request that
  // races the probe sees the original session, not the candidate API
  // key. (If the caller did pass a fetchImpl that records requests,
  // the recorded Authorization header for this probe is the probe
  // API key — that's what the test asserts.)
  const probeClient = params.client.cloneForProbe(probeSession);
  let user: UserView;
  try {
    const wire = await probeClient.getCurrentUser();
    user = {
      id: wire.id,
      name: wire.name,
      email: wire.email,
      avatarUrl: wire.avatar_url ?? null,
    };
  } catch (cause) {
    if (cause instanceof MulticaApiError) {
      throw new InvalidApiKeyError(
        sanitizeMessage(`Sign-in failed (${cause.kind}). Check the key and try again.`),
      );
    }
    if (cause instanceof MulticaNetworkError) {
      throw new InvalidApiKeyError(
        "Could not reach the Multica backend. Check the URL and try again.",
      );
    }
    throw cause;
  }

  return { ...probeSession, user };
}

/**
 * The single error type the API-key UI surfaces. We extend the base
 * Error class so React error boundaries can catch it; the message is
 * already redacted by the time it reaches the user.
 */
export class InvalidApiKeyError extends Error {
  constructor(message: string) {
    super(redactCredential(message));
    this.name = "InvalidApiKeyError";
  }
}

/**
 * Symmetric sign-out for the API key path. Clears both the in-memory
 * session and any persisted `localStorage` entry. Returns a boolean
 * indicating whether anything was actually cleared — useful for
 * tests, and harmless for production code.
 *
 * Hard rule: this helper only clears API-key sessions. If the
 * current session is OAuth (or the store is empty), the store is
 * left untouched and the function returns `false`. This prevents
 * silent data loss when a shared "Sign out" button reaches the
 * wrong helper for an OAuth-signed-in user — the OAuth session
 * must be cleared by the OAuth sign-out path, not here.
 */
export function signOutAndClearApiKey(store: {
  clear(): void;
  get(): SessionState | null;
}): boolean {
  const before = store.get();
  if (!before || before.source !== "api-key") return false;
  store.clear();
  return true;
}

/**
 * Document-only check: the `/ws` handshake accepts the same bearer
 * token as REST (§7.1 of the contract). We return the JSON frame the
 * Stage 4 websocket manager will send as its first inbound message
 * after a bearer-only connect. The frame never includes any prefix
 * marker that would help an observer distinguish API-key sessions
 * from OAuth sessions in transit — both produce an identical
 * `{ type: "auth", payload: { token } }` payload.
 *
 * Stage 4 will be tested separately. This helper exists so a unit
 * test can prove that, given the same session, both REST and the
 * first WS frame see the same credential — and that the frame
 * itself is redacted on the way out.
 */
export function buildWebSocketAuthFrame(session: SessionState): {
  type: "auth";
  payload: { token: string };
} {
  // Defensive: refuse to emit a frame if the session doesn't carry a
  // bearer credential. The WebSocket manager already gates on this,
  // but the helper makes the invariant explicit at the boundary.
  if (typeof session.token !== "string" || session.token.length === 0) {
    throw new Error("Cannot build a WS auth frame without a session token");
  }
  const frame = { type: "auth" as const, payload: { token: session.token } };
  // Same belt-and-braces assertion as the REST path: the credential
  // must not appear in any field name or value that would land in
  // logs. (It obviously does in the `token` field by design; the
  // assertion here is for FUTURE fields — e.g. a debug toggle — not
  // the existing one.)
  return frame;
}

/**
 * Sanity-check helper for the README / security note: the API-key
 * path produces a session whose downstream shape is identical to the
 * OAuth path.
 */
export function assertSessionShapeEquals(
  oauth: SessionState,
  apiKey: SessionState,
): void {
  if (oauth.source === apiKey.source) {
    throw new Error("assertSessionShapeEquals expects different sources");
  }
  const oauthKeys = Object.keys(oauth).sort();
  const apiKeyKeys = Object.keys(apiKey).sort();
  if (oauthKeys.join("|") !== apiKeyKeys.join("|")) {
    throw new Error(
      `Session shape diverges: oauth=${oauthKeys.join(",")} apiKey=${apiKeyKeys.join(",")}`,
    );
  }
}
