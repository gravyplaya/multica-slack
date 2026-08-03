/**
 * Session source — the single source of truth for the current
 * authentication state.
 *
 * The Stage 2 gate requires that both OAuth and API-key sign-in paths
 * produce the *same* downstream session shape, so the rest of the app
 * never branches on auth source. This module owns:
 *
 * - A typed accessor (`SessionStore`) that exposes the current
 *   session, the subscription list, and the change API.
 * - Two implementations:
 *     1. `MemorySessionStore` — pure JS, SSR-safe, used during server
 *        rendering and as the default inside tests.
 *     2. `BrowserSessionStore` — `localStorage`-backed, used in the
 *        browser so reloads preserve the chosen session. The store
 *        itself is the only place that touches `localStorage`, so the
 *        rest of the codebase can be tested in plain Node.
 * - A small Zustand-style hook interface so React components can
 *   subscribe via the React provider without coupling to any specific
 *   state library.
 *
 * Hard rule: the credential is *never* logged, never serialised into
 * React Query keys, never sent to telemetry, never written to any
 * origin other than the configured Multica backend (via the
 * `Authorization` header in `lib/api/client.ts`).
 */

import { credentialFingerprint } from "../api/redact";
import type { AuthSource, SessionState, UserView } from "../types";

/**
 * Stable localStorage key. The backend origin is hashed so two
 * deployments of Multica (e.g. self-hosted + cloud) can coexist in the
 * same browser without colliding. We deliberately do NOT include the
 * credential in the key — only the origin.
 */
function storageKey(backendOrigin: string): string {
  return `multica-slack:session:${credentialFingerprint(backendOrigin)}`;
}

export interface SessionListener {
  (next: SessionState | null): void;
}

export interface SessionStore {
  get(): SessionState | null;
  set(next: SessionState): void;
  clear(): void;
  subscribe(listener: SessionListener): () => void;
}

/**
 * Pure in-memory store. Default for SSR and tests.
 */
export class MemorySessionStore implements SessionStore {
  private current: SessionState | null = null;
  private listeners = new Set<SessionListener>();

  get(): SessionState | null {
    return this.current;
  }

  set(next: SessionState): void {
    this.current = next;
    for (const listener of this.listeners) listener(next);
  }

  clear(): void {
    this.current = null;
    for (const listener of this.listeners) listener(null);
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/**
 * `localStorage`-backed store. Browser-only. The store keeps a copy
 * of the session in memory so reads are sync and cheap, and writes
 * synchronously persist.
 *
 * The credential fingerprint is the cache key for React Query, *not*
 * the credential itself — see `lib/api/redact.ts` for the hashing.
 */
export class BrowserSessionStore implements SessionStore {
  private current: SessionState | null = null;
  private listeners = new Set<SessionListener>();
  private readonly storage: Storage;
  private readonly key: string;

  constructor(backendOrigin: string, storage: Storage = window.localStorage) {
    this.storage = storage;
    this.key = storageKey(backendOrigin);
    this.current = readFromStorage(this.storage, this.key);
  }

  get(): SessionState | null {
    return this.current;
  }

  set(next: SessionState): void {
    this.current = next;
    writeToStorage(this.storage, this.key, next);
    for (const listener of this.listeners) listener(next);
  }

  clear(): void {
    this.current = null;
    try {
      this.storage.removeItem(this.key);
    } catch {
      // Storage may be disabled (private mode); the in-memory clear
      // already prevents accidental re-use within the page lifecycle.
    }
    for (const listener of this.listeners) listener(null);
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

interface PersistedSession {
  source: AuthSource;
  token: string;
  user: UserView | null;
  backendOrigin: string;
}

function readFromStorage(storage: Storage, key: string): SessionState | null {
  let raw: string | null = null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedSession;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.source !== "oauth" && parsed.source !== "api-key") return null;
    if (typeof parsed.token !== "string" || parsed.token.length === 0) return null;
    if (typeof parsed.backendOrigin !== "string" || parsed.backendOrigin.length === 0) {
      return null;
    }
    return {
      source: parsed.source,
      token: parsed.token,
      user: parsed.user ?? null,
      backendOrigin: parsed.backendOrigin,
    };
  } catch {
    // Corrupt entry — drop it rather than crash.
    return null;
  }
}

function writeToStorage(storage: Storage, key: string, value: SessionState): void {
  const payload: PersistedSession = {
    source: value.source,
    token: value.token,
    user: value.user,
    backendOrigin: value.backendOrigin,
  };
  try {
    storage.setItem(key, JSON.stringify(payload));
  } catch {
    // Storage full / disabled — in-memory copy still keeps the session
    // alive for this page lifecycle.
  }
}

/**
 * Convenience factory: pick the right store for the current
 * environment. SSR callers get the memory store; browser callers get
 * the localStorage-backed one.
 */
export function createDefaultSessionStore(backendOrigin: string): SessionStore {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return new MemorySessionStore();
  }
  return new BrowserSessionStore(backendOrigin);
}
