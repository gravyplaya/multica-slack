/**
 * Browser-safe Multica REST client.
 *
 * Contract of the client surface:
 *
 * 1. **One request path.** Every public method goes through
 *    `requestJson`, which applies auth, workspace, telemetry headers,
 *    JSON content-type, abort signals, and the redaction pipeline.
 *    Components do not call `fetch` directly.
 * 2. **Auth and workspace are injected once.** A client instance is
 *    constructed with a `SessionState` (see `lib/auth/session-source`)
 *    and an optional workspace selection. Callers never pass a token
 *    inline.
 * 3. **Typed errors.** Non-2xx responses throw `MulticaApiError` with
 *    a sanitized message. Network failures throw
 *    `MulticaNetworkError`. Aborted requests throw
 *    `MulticaAbortError`. Response bodies are discarded — only the
 *    sanitized `error` string is retained.
 * 4. **Abort support.** Every method accepts an `AbortSignal`.
 * 5. **No secret leakage.** All headers we send are constructed here,
 *    and we never log, persist, or surface the raw credential. The
 *    `redactCredential` step in `errors.ts` and the
 *    `credentialFingerprint` helper in `redact.ts` together enforce
 *    the Stage 2 gate.
 * 6. **SSR-safe.** No `window`, `document`, or `localStorage`
 *    references — those live in `lib/auth/session-source.ts` and
 *    `lib/stores/view-store.ts`. This module can be imported during
 *    server rendering without crashing.
 */

import { DEFAULT_CLIENT_CONFIG, type ClientConfig } from "./config";
import {
  MulticaAbortError,
  MulticaApiError,
  MulticaNetworkError,
  sanitizeMessage,
} from "./errors";
import { redactCredential } from "./redact";
import type { SessionState, WorkspaceSelection } from "../types";
import type {
  WireAgent,
  WireAttachment,
  WireComment,
  WireError,
  WireIssue,
  WireReaction,
  WireUser,
  WireWorkspace,
  WireWorkspaceMember,
} from "../types";

export interface RequestOptions {
  signal?: AbortSignal;
  /** Extra query parameters; values are stringified. */
  query?: Record<string, string | number | boolean | null | undefined>;
  /** Override the JSON body; if omitted we send `{}`. */
  body?: unknown;
  /** Extra headers — credentials are never accepted here. */
  headers?: Record<string, string>;
  /**
   * Public request: omit the `Authorization` and `X-Workspace-*`
   * headers. Use only for endpoints the Multica contract lists as
   * unauthenticated (currently `/auth/send-code` and `/auth/verify-code`).
   * The session credential is never sent on these calls.
   */
  unauthenticated?: boolean;
}

interface InternalRequestInit extends RequestOptions {
  method: string;
  path: string;
}

export class MulticaClient {
  private session: SessionState;
  private readonly config: ClientConfig;
  private readonly fetchImpl: typeof fetch;
  private workspace: WorkspaceSelection | null;

  constructor(params: {
    session: SessionState;
    workspace?: WorkspaceSelection | null;
    config?: Partial<ClientConfig>;
    /** Injectable for tests; defaults to the global `fetch`. */
    fetchImpl?: typeof fetch;
  }) {
    this.session = params.session;
    this.workspace = params.workspace ?? null;
    this.fetchImpl = params.fetchImpl ?? globalThis.fetch?.bind(globalThis);
    if (typeof this.fetchImpl !== "function") {
      throw new Error(
        "MulticaClient requires a fetch implementation; pass fetchImpl explicitly when running in a non-browser env without one.",
      );
    }
    this.config = { ...DEFAULT_CLIENT_CONFIG, ...(params.config ?? {}) };
  }

  // ---------------------------------------------------------------------
  // Session + workspace inspection / mutation
  // ---------------------------------------------------------------------

  /**
   * Read the current session. Used by the auth flows when swapping
   * credentials in and out for validation probes.
   */
  getSession(): SessionState {
    return this.session;
  }

  /**
   * Replace the current session. The credential itself is never
   * logged; the redaction layer in `lib/api/errors.ts` is the
   * load-bearing defense, so this is just a plain assignment.
   */
  setSession(next: SessionState): void {
    this.session = next;
  }

  /** Read the current workspace selection (or `null` for none). */
  getWorkspace(): WorkspaceSelection | null {
    return this.workspace;
  }

  /** Set or clear the workspace selection. */
  setWorkspace(next: WorkspaceSelection | null): void {
    this.workspace = next;
  }

  // ---------------------------------------------------------------------
  // Session bootstrap
  // ---------------------------------------------------------------------

  /**
   * Probe the authenticated session by calling `GET /api/me`. The
   * Stage 2 sign-in flows use this to validate the credential without
   * exposing the token in any error message.
   */
  async getCurrentUser(options: RequestOptions = {}): Promise<WireUser> {
    return this.requestJson<WireUser>({
      method: "GET",
      path: "/api/me",
      ...options,
    });
  }

  // ---------------------------------------------------------------------
  // Workspaces
  // ---------------------------------------------------------------------

  async listWorkspaces(options: RequestOptions = {}): Promise<WireWorkspace[]> {
    return this.requestJson<WireWorkspace[]>({
      method: "GET",
      path: "/api/workspaces/",
      ...options,
    });
  }

  async listWorkspaceMembers(
    workspaceId: string,
    options: RequestOptions = {},
  ): Promise<WireWorkspaceMember[]> {
    return this.requestJson<WireWorkspaceMember[]>({
      method: "GET",
      path: `/api/workspaces/${encodeURIComponent(workspaceId)}/members`,
      ...options,
    });
  }

  // ---------------------------------------------------------------------
  // Issues
  // ---------------------------------------------------------------------

  async listIssues(options: RequestOptions = {}): Promise<WireIssue[]> {
    return this.requestJson<WireIssue[]>({
      method: "GET",
      path: "/api/issues/",
      ...options,
    });
  }

  async getIssue(issueId: string, options: RequestOptions = {}): Promise<WireIssue> {
    return this.requestJson<WireIssue>({
      method: "GET",
      path: `/api/issues/${encodeURIComponent(issueId)}/`,
      ...options,
    });
  }

  async createIssue(
    payload: { title: string; description?: string | null },
    options: RequestOptions = {},
  ): Promise<WireIssue> {
    return this.requestJson<WireIssue>({
      method: "POST",
      path: "/api/issues/",
      body: payload,
      ...options,
    });
  }

  async listIssueAttachments(
    issueId: string,
    options: RequestOptions = {},
  ): Promise<WireAttachment[]> {
    return this.requestJson<WireAttachment[]>({
      method: "GET",
      path: `/api/issues/${encodeURIComponent(issueId)}/attachments`,
      ...options,
    });
  }

  // ---------------------------------------------------------------------
  // Comments
  // ---------------------------------------------------------------------

  async listComments(issueId: string, options: RequestOptions = {}): Promise<WireComment[]> {
    return this.requestJson<WireComment[]>({
      method: "GET",
      path: `/api/issues/${encodeURIComponent(issueId)}/comments`,
      ...options,
    });
  }

  async createComment(
    issueId: string,
    payload: { content: string; parent_id?: string | null; attachment_ids?: string[] },
    options: RequestOptions = {},
  ): Promise<WireComment> {
    return this.requestJson<WireComment>({
      method: "POST",
      path: `/api/issues/${encodeURIComponent(issueId)}/comments`,
      body: payload,
      ...options,
    });
  }

  // ---------------------------------------------------------------------
  // Agents
  // ---------------------------------------------------------------------

  async listAgents(options: RequestOptions = {}): Promise<WireAgent[]> {
    return this.requestJson<WireAgent[]>({
      method: "GET",
      path: "/api/agents/",
      ...options,
    });
  }

  // ---------------------------------------------------------------------
  // Reactions (shape for completeness; Stage 3 will consume)
  // ---------------------------------------------------------------------

  async listCommentReactions(
    commentId: string,
    options: RequestOptions = {},
  ): Promise<WireReaction[]> {
    return this.requestJson<WireReaction[]>({
      method: "GET",
      path: `/api/comments/${encodeURIComponent(commentId)}/reactions`,
      ...options,
    });
  }

  // ---------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------

  async sendCode(
    email: string,
    options: RequestOptions = {},
  ): Promise<{ ok: true }> {
    return this.requestJson<{ ok: true }>({
      method: "POST",
      path: "/auth/send-code",
      body: { email },
      unauthenticated: true,
      ...options,
    });
  }

  async verifyCode(
    email: string,
    code: string,
    options: RequestOptions = {},
  ): Promise<{ token: string; user: WireUser }> {
    return this.requestJson<{ token: string; user: WireUser }>({
      method: "POST",
      path: "/auth/verify-code",
      body: { email, code },
      unauthenticated: true,
      ...options,
    });
  }

  async signOut(options: RequestOptions = {}): Promise<{ ok: true }> {
    return this.requestJson<{ ok: true }>({
      method: "POST",
      path: "/auth/logout",
      body: {},
      // The contract lists `/auth/logout` as a public endpoint
      // (idempotent; clears the cookies server-side). We deliberately
      // do NOT need to send a session here — passing it through still
      // works, but skipping it lets the caller sign out even when the
      // local credential is gone.
      unauthenticated: true,
      ...options,
    });
  }

  // ---------------------------------------------------------------------
  // Core request loop
  // ---------------------------------------------------------------------

  /**
   * Single request path. All public methods funnel through here so
   * header construction, error handling, and redaction are applied in
   * one place.
   */
  async requestJson<T>(init: InternalRequestInit): Promise<T> {
    const url = this.buildUrl(init.path, init.query);
    const headers = this.buildHeaders(init.headers, { unauthenticated: init.unauthenticated });

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: init.method,
        headers,
        body:
          init.body === undefined
            ? undefined
            : typeof init.body === "string"
              ? init.body
              : JSON.stringify(init.body),
        signal: init.signal,
        credentials:
          // Public endpoints (send-code / verify-code / logout) must not
          // ride the cookie session. Authenticated PAT sessions omit
          // cookies by design; OAuth sessions need cookies for CSRF +
          // image-load auth.
          init.unauthenticated
            ? "omit"
            : this.session.source === "oauth"
              ? "include"
              : "omit",
        cache: "no-store",
      });
    } catch (cause) {
      if (init.signal?.aborted) {
        throw new MulticaAbortError();
      }
      throw new MulticaNetworkError(
        `Network error contacting ${redactCredential(url)}`,
        cause,
      );
    }

    if (init.signal?.aborted) {
      throw new MulticaAbortError();
    }

    if (response.ok) {
      // `204 No Content` (some Multica endpoints) and any 2xx with an
      // empty body (e.g. `POST /auth/send-code` per contract §2.1)
      // resolve to undefined. We test the body length first so we
      // never call `response.json()` on an empty payload.
      if (response.status === 204) {
        return undefined as T;
      }
      // Read the body as text first so we can gracefully handle
      // empty envelopes without throwing a NetworkError.
      const raw = await response.text();
      if (raw.length === 0) {
        return undefined as T;
      }
      try {
        return JSON.parse(raw) as T;
      } catch (cause) {
        throw new MulticaNetworkError(
          `Malformed JSON in ${init.method} ${redactCredential(init.path)}`,
          cause,
        );
      }
    }

    // Non-2xx — try to read a sanitized `error` string and throw.
    let message: string | null = null;
    try {
      // Use text() rather than json() so a non-JSON body still gives us
      // a useful message (then we sanitize).
      const raw = await response.text();
      if (raw.length > 0) {
        try {
          const parsed = JSON.parse(raw) as Partial<WireError>;
          message = sanitizeMessage(parsed.error ?? raw);
        } catch {
          message = sanitizeMessage(raw);
        }
      }
    } catch {
      // Body not readable — fall through to statusText fallback below.
    }
    if (message === null) {
      message = sanitizeMessage(response.statusText || "Request failed");
    }

    const requestId = response.headers.get("X-Request-Id");
    throw new MulticaApiError({
      status: response.status,
      message,
      requestId,
    });
  }

  private buildUrl(
    path: string,
    query: RequestOptions["query"],
  ): string {
    const base = this.config.apiBaseUrl.replace(/\/+$/, "");
    const normalized = path.startsWith("/") ? path : `/${path}`;
    if (!query) return `${base}${normalized}`;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === null || value === undefined) continue;
      params.append(key, String(value));
    }
    const qs = params.toString();
    return qs.length > 0 ? `${base}${normalized}?${qs}` : `${base}${normalized}`;
  }

  private buildHeaders(
    extra: Record<string, string> | undefined,
    options: { unauthenticated?: boolean } = {},
  ): Headers {
    const headers = new Headers();
    headers.set("Accept", "application/json");
    if (extra && "Content-Type" in extra) {
      headers.set("Content-Type", extra["Content-Type"]);
    } else {
      headers.set("Content-Type", "application/json");
    }
    if (options.unauthenticated) {
      // Public endpoints must never carry the session credential. The
      // server would either ignore it or, worse, echo it back in an
      // error page.
    } else {
      headers.set("Authorization", `Bearer ${this.session.token}`);
      if (this.workspace) {
        // Prefer slug (the contract's preferred convention).
        headers.set("X-Workspace-Slug", this.workspace.workspaceSlug);
      }
    }
    headers.set("X-Client-Platform", this.config.clientPlatform);
    headers.set("X-Client-Version", this.config.clientVersion);
    headers.set("X-Client-OS", this.config.clientOs);
    // CSRF for cookie auth only meaningful when source is oauth.
    // We don't need the cookie value here: browsers send the matching
    // multica_csrf cookie automatically on credentials include,
    // and PATs are exempt per contract section 1.2.
    if (extra) {
      for (const [k, v] of Object.entries(extra)) {
        if (k === "Content-Type") continue;
        headers.set(k, v);
      }
    }
    return headers;
  }
}

/**
 * Construct a client keyed by the current session. Stage 3 will move
 * the `useClient()` hook into `hooks/useMulticaClient.ts`; for now the
 * factory keeps the wiring explicit so tests can construct clients
 * without React.
 */
export function createMulticaClient(params: {
  session: SessionState;
  workspace?: WorkspaceSelection | null;
  config?: Partial<ClientConfig>;
  fetchImpl?: typeof fetch;
}): MulticaClient {
  return new MulticaClient(params);
}
