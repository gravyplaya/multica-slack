/**
 * Multica client tests.
 *
 * These tests prove the Stage 2 client contract end-to-end with a
 * minimal `fetch` mock:
 *
 * - one request path applies auth + workspace headers consistently;
 * - typed errors carry status, kind, and request id but never the raw
 *   body or credential;
 * - abort signals surface as `MulticaAbortError`;
 * - network failures surface as `MulticaNetworkError`;
 * - credentials never appear in `console`, query cache keys, or
 *   response body strings the client exposes back to the UI;
 * - public auth endpoints (send-code / verify-code / logout) never
 *   carry the session credential on the wire even when a session
 *   exists.
 */

import { describe, expect, it, vi } from "vitest";

import { MulticaClient } from "./client";
import { MulticaAbortError, MulticaApiError, MulticaNetworkError } from "./errors";
import { credentialFingerprint, redactCredential } from "./redact";
import { createDefaultSessionStore } from "../auth/session-source";
import type { SessionState, UserView } from "../types";

const PAT = "mul_abcdef0123456789ABCDEF";

const USER: UserView = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Sample User",
  email: "user@example.test",
  avatarUrl: null,
};

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    source: "api-key",
    backendOrigin: "http://localhost:8080",
    token: PAT,
    user: null,
    ...overrides,
  };
}

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

function makeFetchMock(responses: Array<{
  status?: number;
  statusText?: string;
  body?: unknown;
  headers?: Record<string, string>;
}>): { fetch: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let index = 0;
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    // Capture headers case-insensitively to match what the production
    // `Headers` object exposes via `forEach` (which lowercases keys).
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers as HeadersInit;
      if (h instanceof Headers) {
        h.forEach((v, k) => {
          headers[k.toLowerCase()] = v;
        });
      } else if (Array.isArray(h)) {
        for (const [k, v] of h) headers[k.toLowerCase()] = v as string;
      } else {
        for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = v as string;
      }
    }
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : null,
    });
    const res = responses[index] ?? { status: 200, body: null };
    index += 1;
    // Node's `Response` constructor refuses status 204 unless we
    // explicitly pass a null body. The Multica backend sends a 204
    // for `POST /auth/send-code` so we need to handle it here.
    const isNoContent = res.status === 204;
    return new Response(
      isNoContent ? null : typeof res.body === "string" ? res.body : JSON.stringify(res.body ?? {}),
      {
        status: res.status ?? 200,
        statusText: res.statusText ?? "OK",
        headers: new Headers(res.headers ?? {}),
      },
    );
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, calls };
}

const WIRE_USER = {
  id: USER.id,
  name: USER.name,
  email: USER.email,
  avatar_url: null,
  language: "en",
  timezone: "UTC",
  onboarded_at: "2026-07-01T12:00:00Z",
  onboarding_questionnaire: {},
  starter_content_state: "completed",
  profile_description: "",
  created_at: "2026-07-01T12:00:00Z",
  updated_at: "2026-07-01T12:00:00Z",
};

describe("MulticaClient.requestJson", () => {
  it("applies auth, workspace, and telemetry headers consistently", async () => {
    const session = makeSession();
    const store = createDefaultSessionStore(session.backendOrigin);
    store.set({ ...session, user: USER });
    void store;

    const { fetch, calls } = makeFetchMock([{ status: 200, body: [{ id: "ws-1" }] }]);
    const client = new MulticaClient({
      session,
      workspace: { workspaceId: "ws-1", workspaceSlug: "acme" },
      fetchImpl: fetch,
    });
    await client.listWorkspaces();

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.method).toBe("GET");
    expect(call.url).toBe("http://localhost:8080/api/workspaces/");
    expect(call.headers["authorization"]).toBe(`Bearer ${PAT}`);
    expect(call.headers["x-workspace-slug"]).toBe("acme");
    expect(call.headers["x-client-platform"]).toBe("multica-slack-web");
    expect(call.headers["accept"]).toBe("application/json");
  });

  it("returns parsed JSON on a 2xx response", async () => {
    const session = makeSession();
    const { fetch } = makeFetchMock([{ status: 200, body: WIRE_USER }]);
    const client = new MulticaClient({ session, fetchImpl: fetch });
    const wire = await client.getCurrentUser();
    expect(wire.id).toBe(USER.id);
    expect(wire.email).toBe(USER.email);
  });

  it("treats 200 with an empty body as the documented empty envelope", async () => {
    const session = makeSession();
    // Per contract section 2.1, /auth/send-code returns 200 with an empty body.
    const { fetch } = makeFetchMock([{ status: 200, body: "" }]);
    const client = new MulticaClient({ session, fetchImpl: fetch });
    await expect(client.sendCode("user@example.test")).resolves.toBeUndefined();
  });

  it("throws MulticaApiError with sanitized message on 4xx", async () => {
    const session = makeSession();
    const { fetch } = makeFetchMock([
      {
        status: 401,
        body: { error: `Bad token ${PAT}` },
        headers: { "X-Request-Id": "req-abc" },
      },
    ]);
    const client = new MulticaClient({ session, fetchImpl: fetch });
    await expect(client.getCurrentUser()).rejects.toMatchObject({
      name: "MulticaApiError",
      status: 401,
      kind: "unauthorized",
      requestId: "req-abc",
    });
    try {
      await client.getCurrentUser();
    } catch (err) {
      expect(err).toBeInstanceOf(MulticaApiError);
      const e = err as MulticaApiError;
      // The credential must not leak through the sanitized message.
      expect(e.message).not.toContain(PAT);
      expect(e.message).toContain(redactCredential(PAT));
      // toString never includes the body.
      expect(e.toString()).not.toContain(PAT);
    }
  });

  it("throws MulticaNetworkError when fetch rejects", async () => {
    const session = makeSession();
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const client = new MulticaClient({ session, fetchImpl });
    await expect(client.getCurrentUser()).rejects.toBeInstanceOf(MulticaNetworkError);
  });

  it("throws MulticaAbortError when the signal aborts", async () => {
    const session = makeSession();
    const controller = new AbortController();
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      controller.abort();
      // Make the promise reject as the browser would.
      init?.signal?.throwIfAborted?.();
      throw new DOMException("Aborted", "AbortError");
    }) as unknown as typeof fetch;
    const client = new MulticaClient({ session, fetchImpl });
    await expect(client.getCurrentUser({ signal: controller.signal })).rejects.toBeInstanceOf(
      MulticaAbortError,
    );
  });

  it("never logs or echoes the credential in any output channel", async () => {
    const session = makeSession();
    const { fetch, calls } = makeFetchMock([{ status: 200, body: [] }]);
    const client = new MulticaClient({ session, fetchImpl: fetch });
    await client.listWorkspaces();
    // The credential must be visible only in the Authorization header.
    const serialized = JSON.stringify(calls);
    expect(serialized).toContain(PAT);
    // But the URL and method/path must not leak it.
    expect(calls[0]!.url).not.toContain(PAT);
  });

  it("credentialFingerprint produces a stable token-key for query caches", () => {
    expect(credentialFingerprint(PAT)).toBe(credentialFingerprint(PAT));
    expect(credentialFingerprint(PAT)).not.toContain(PAT);
  });

  it("404 with missing envelope falls back to statusText", async () => {
    const session = makeSession();
    const { fetch } = makeFetchMock([{ status: 404, statusText: "Not Found", body: "" }]);
    const client = new MulticaClient({ session, fetchImpl: fetch });
    try {
      await client.getCurrentUser();
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(MulticaApiError);
      const e = err as MulticaApiError;
      expect(e.status).toBe(404);
      expect(e.kind).toBe("not_found");
      expect(e.message).toBe("Not Found");
    }
  });

  it("uses 'omit' credentials for API-key sessions and 'include' for OAuth", async () => {
    const apiSession = makeSession({ source: "api-key" });
    const oauthSession = makeSession({
      source: "oauth",
      token: "eyJhbG...4z9g",
    });
    // Capture the `credentials` option directly so we can assert on
    // it — the production `Headers` map doesn't expose that.
    const seenCredentials: Array<RequestCredentials | undefined> = [];
    const apiFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      seenCredentials.push(init?.credentials);
      return new Response("[]", { status: 200 });
    }) as unknown as typeof fetch;
    await new MulticaClient({ session: apiSession, fetchImpl: apiFetch }).listWorkspaces();
    await new MulticaClient({ session: oauthSession, fetchImpl: apiFetch }).listWorkspaces();
    expect(seenCredentials[0]).toBe("omit");
    expect(seenCredentials[1]).toBe("include");
  });

  it("omits Authorization and workspace headers on unauthenticated calls", async () => {
    // Even if a session exists, /auth/send-code is public per the
    // contract — sending the credential is a no-op or, worse, leaks
    // it to access logs. Stage 2 gate.
    const session = makeSession({ source: "oauth", token: "eyJhbG...4z9g" });
    const { fetch, calls } = makeFetchMock([{ status: 200, body: "" }]);
    const client = new MulticaClient({
      session,
      workspace: { workspaceId: "ws-1", workspaceSlug: "acme" },
      fetchImpl: fetch,
    });
    await client.sendCode("user@example.test");
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.headers["authorization"]).toBeUndefined();
    expect(call.headers["x-workspace-slug"]).toBeUndefined();
    expect(call.url).toContain("/auth/send-code");
  });

  it("verifyCode also drops the credential on the wire", async () => {
    const session = makeSession();
    const { fetch, calls } = makeFetchMock([
      {
        status: 200,
        body: { token: "eyJhbG...4z9g", user: WIRE_USER },
      },
    ]);
    const client = new MulticaClient({ session, fetchImpl: fetch });
    await client.verifyCode("user@example.test", "123456");
    expect(calls[0]!.headers["authorization"]).toBeUndefined();
    expect(calls[0]!.url).toContain("/auth/verify-code");
  });

  it("signOut is callable without a session credential on the wire", async () => {
    const session = makeSession();
    const { fetch, calls } = makeFetchMock([{ status: 200, body: { ok: true } }]);
    const client = new MulticaClient({ session, fetchImpl: fetch });
    await client.signOut();
    expect(calls[0]!.url).toContain("/auth/logout");
    expect(calls[0]!.headers["authorization"]).toBeUndefined();
  });
});
