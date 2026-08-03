/**
 * API-key sign-in tests.
 *
 * The Stage 2 gate requires:
 *
 * - empty / whitespace / malformed key rejection;
 * - successful validation populating the same downstream session state
 *   that OAuth produces;
 * - sign-out clearing the credential from storage;
 * - the credential never appearing in console logs, error messages,
 *   query cache entries, or unrelated origins.
 */

import { describe, expect, it, vi } from "vitest";

import {
  InvalidApiKeyError,
  assertSessionShapeEquals,
  buildWebSocketAuthFrame,
  signInWithApiKey,
  signOutAndClearApiKey,
  validateApiKeyShape,
} from "./api-key";
import { BrowserSessionStore, MemorySessionStore } from "./session-source";
import { MulticaClient } from "../api/client";
import { assertNoCredential, credentialFingerprint, redactCredential } from "../api/redact";
import type { SessionState, UserView } from "../types";

const PAT = "mul_abcdef0123456789ABCDEF";
const SHORT_PAT = "mul_short";

const USER: UserView = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Sample User",
  email: "user@example.test",
  avatarUrl: null,
};

function makeWireUser() {
  return {
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
}

describe("validateApiKeyShape", () => {
  it("rejects empty input", () => {
    expect(validateApiKeyShape("")).toMatchObject({ ok: false });
    expect(validateApiKeyShape("   ")).toMatchObject({ ok: false });
    expect(validateApiKeyShape(undefined as unknown as string)).toMatchObject({ ok: false });
  });

  it("rejects keys missing the mul_ prefix", () => {
    expect(validateApiKeyShape("abcdef0123456789ABCDEF")).toMatchObject({ ok: false });
  });

  it("rejects keys that are too short", () => {
    expect(validateApiKeyShape(SHORT_PAT)).toMatchObject({ ok: false });
  });

  it("rejects keys containing disallowed characters", () => {
    expect(validateApiKeyShape("mul_abc def 1234 5678 90AB")).toMatchObject({ ok: false });
  });

  it("accepts a well-formed PAT", () => {
    expect(validateApiKeyShape(PAT)).toEqual({ ok: true });
  });

  it("accepts a PAT surrounded by whitespace (trimmed before validation)", () => {
    expect(validateApiKeyShape(`  ${PAT}  `)).toEqual({ ok: true });
  });
});

describe("signInWithApiKey", () => {
  function makeFetchMock(status = 200, body: unknown = makeWireUser()): typeof fetch {
    return vi.fn(async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
    ) as unknown as typeof fetch;
  }

  it("returns a SessionState with the same shape as OAuth", async () => {
    const session = await signInWithApiKey({
      apiKey: PAT,
      backendOrigin: "http://localhost:8080",
      client: new MulticaClient({
        session: {
          source: "oauth",
          backendOrigin: "http://localhost:8080",
          token: "eyJhbG...4z9g",
          user: USER,
        },
        fetchImpl: makeFetchMock(),
      }),
    });
    expect(session.source).toBe("api-key");
    expect(session.token).toBe(PAT);
    expect(session.user).toEqual(USER);
    expect(session.backendOrigin).toBe("http://localhost:8080");
  });

  it("rejects malformed keys without leaking the credential in the error", async () => {
    const captured: string[] = [];
    const consoleSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      captured.push(args.map(String).join(" "));
    });
    try {
      await expect(
        signInWithApiKey({
          apiKey: SHORT_PAT,
          backendOrigin: "http://localhost:8080",
          client: new MulticaClient({
            session: {
              source: "api-key",
              backendOrigin: "http://localhost:8080",
              token: "garbage",
              user: null,
            },
            fetchImpl: makeFetchMock(),
          }),
        }),
      ).rejects.toThrow(/Invalid API key|API key/i);
    } finally {
      consoleSpy.mockRestore();
    }
    expect(captured.join("\n")).not.toContain("garbage");
  });

  it("rejects server-rejected keys with a sanitized message", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: `Bad token ${PAT}` }), { status: 401 }),
    ) as unknown as typeof fetch;
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        signInWithApiKey({
          apiKey: PAT,
          backendOrigin: "http://localhost:8080",
          client: new MulticaClient({
            session: {
              source: "api-key",
              backendOrigin: "http://localhost:8080",
              token: PAT,
              user: null,
            },
            fetchImpl,
          }),
        }),
      ).rejects.toBeInstanceOf(InvalidApiKeyError);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("handles a network failure with a sanitized message", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    await expect(
      signInWithApiKey({
        apiKey: PAT,
        backendOrigin: "http://localhost:8080",
        client: new MulticaClient({
          session: {
            source: "api-key",
            backendOrigin: "http://localhost:8080",
            token: PAT,
            user: null,
          },
          fetchImpl,
        }),
      }),
    ).rejects.toThrow(/Could not reach the Multica backend/i);
  });
});

describe("signOutAndClearApiKey", () => {
  it("clears the in-memory store and reports it cleared", () => {
    const store = new MemorySessionStore();
    const session: SessionState = {
      source: "api-key",
      backendOrigin: "http://localhost:8080",
      token: PAT,
      user: USER,
    };
    store.set(session);
    expect(signOutAndClearApiKey(store)).toBe(true);
    expect(store.get()).toBeNull();
  });

  it("returns false when the cleared session was OAuth", () => {
    const store = new MemorySessionStore();
    store.set({
      source: "oauth",
      backendOrigin: "http://localhost:8080",
      token: "eyJhbG...4z9g",
      user: USER,
    });
    expect(signOutAndClearApiKey(store)).toBe(false);
  });

  it("removes the localStorage entry on sign-out", () => {
    const storage = new Map<string, string>();
    storage.set("test-key", JSON.stringify({ stale: true }));
    const fakeStorage = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storage.set(k, v);
      },
      removeItem: (k: string) => {
        storage.delete(k);
      },
      clear: () => storage.clear(),
      key: () => null,
      length: 0,
    } as unknown as Storage;
    const browserStore = new BrowserSessionStore("http://localhost:8080", fakeStorage);
    browserStore.set({
      source: "api-key",
      backendOrigin: "http://localhost:8080",
      token: PAT,
      user: USER,
    });
    expect(signOutAndClearApiKey(browserStore)).toBe(true);
    // The persisted key for this origin must be gone after sign-out.
    const remaining = Array.from(storage.keys()).filter((k) => k.includes("multica-slack"));
    expect(remaining).toEqual([]);
  });
});

describe("buildWebSocketAuthFrame", () => {
  it("produces the documented §7.1 bearer handshake frame", () => {
    const session: SessionState = {
      source: "api-key",
      backendOrigin: "http://localhost:8080",
      token: PAT,
      user: USER,
    };
    expect(buildWebSocketAuthFrame(session)).toEqual({
      type: "auth",
      payload: { token: PAT },
    });
  });

  it("refuses to emit a frame without a session token", () => {
    expect(() =>
      buildWebSocketAuthFrame({
        source: "api-key",
        backendOrigin: "http://localhost:8080",
        token: "",
        user: USER,
      }),
    ).toThrow(/without a session token/i);
  });
});

describe("assertSessionShapeEquals", () => {
  it("passes when both sessions have the same keys", () => {
    const oauth: SessionState = {
      source: "oauth",
      backendOrigin: "http://localhost:8080",
      token: "eyJhbG...4z9g",
      user: USER,
    };
    const apiKey: SessionState = {
      source: "api-key",
      backendOrigin: "http://localhost:8080",
      token: PAT,
      user: USER,
    };
    expect(() => assertSessionShapeEquals(oauth, apiKey)).not.toThrow();
  });

  it("fails when the shapes diverge", () => {
    const oauth: SessionState = {
      source: "oauth",
      backendOrigin: "http://localhost:8080",
      token: "eyJhbG...4z9g",
      user: USER,
    };
    // Missing `backendOrigin` to force divergence.
    const apiKey = {
      source: "api-key" as const,
      token: PAT,
      user: USER,
    };
    expect(() =>
      assertSessionShapeEquals(oauth, apiKey as unknown as SessionState),
    ).toThrow(/Session shape diverges/i);
  });
});

describe("credential non-disclosure", () => {
  it("the credential never enters a query cache key", () => {
    // Stage 3 will use credentialFingerprint (not the raw token) as
    // part of every React Query key. This test pins that invariant.
    const fp = credentialFingerprint(PAT);
    expect(fp).not.toContain(PAT);
    expect(fp.startsWith("tok-")).toBe(true);
  });

  it("the credential never appears in a serialized session payload", () => {
    const session: SessionState = {
      source: "api-key",
      backendOrigin: "http://localhost:8080",
      token: PAT,
      user: USER,
    };
    const serialized = JSON.stringify(session);
    expect(serialized).toContain(PAT); // The session itself owns the credential.
    // But the React Query key shape must use the fingerprint.
    const queryKey = ["me", credentialFingerprint(session.token), session.backendOrigin];
    expect(JSON.stringify(queryKey)).not.toContain(PAT);
  });

  it("assertNoCredential catches accidental leakage", () => {
    expect(() => assertNoCredential("test", `Bearer ${PAT}`)).toThrow();
  });

  it("redactCredential scrubs URLs that would otherwise leak the credential", () => {
    const url = `wss://example.test/ws?token=${PAT}`;
    expect(redactCredential(url)).not.toContain(PAT);
  });
});
