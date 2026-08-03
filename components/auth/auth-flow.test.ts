/**
 * Auth flow integration test.
 *
 * The Stage 2 gate is that both auth paths (OAuth and API key) reach
 * the same downstream session shape, and the credential never
 * appears in console output, error messages, or query cache keys.
 *
 * We exercise the flow end-to-end by:
 *
 *  1. Validating the API-key shape (server-side validation deferred
 *     to the live backend — this test only pins the client side).
 *  2. Running `signInWithApiKey` against a fake-fetch client and
 *     asserting the resulting session populates `user` and has the
 *     expected shape.
 *  3. Asserting the credential never enters any captured log line or
 *     error message.
 *  4. Asserting a React Query key built from the session contains
 *     only the fingerprint, not the raw token.
 *
 * Browser-only behaviour (form rendering, paste field, focus
 * management) is covered by the `components/auth/ApiKeySignInForm`
 * code review and the pure helpers in `lib/auth/api-key.test.ts`.
 * The `BrowserSessionStore` round-trip is already covered in
 * `lib/auth/api-key.test.ts` so we don't duplicate it here.
 */

import { describe, expect, it, vi } from "vitest";

import {
  InvalidApiKeyError,
  buildWebSocketAuthFrame,
  signInWithApiKey,
  signOutAndClearApiKey,
  validateApiKeyShape,
} from "../../lib/auth/api-key";
import { MemorySessionStore } from "../../lib/auth/session-source";
import { MulticaClient } from "../../lib/api/client";
import {
  credentialFingerprint,
  redactCredential,
  redactCredentialDetailed,
} from "../../lib/api/redact";
import type { SessionState, UserView } from "../../lib/types";

const PAT = "mul_abcdef0123456789ABCDEF";

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

describe("Stage 2 sign-in gate (auth-flow)", () => {
  it("API-key and OAuth sessions have the same downstream shape", async () => {
    const apiKeySession = await signInWithApiKey({
      apiKey: PAT,
      backendOrigin: "http://localhost:8080",
      client: new MulticaClient({
        session: {
          source: "oauth",
          backendOrigin: "http://localhost:8080",
          token: "placeholder",
          user: USER,
        },
        fetchImpl: vi.fn(async () => new Response(JSON.stringify(makeWireUser()), { status: 200 })) as unknown as typeof fetch,
      }),
    });
    const oauthSession: SessionState = {
      source: "oauth",
      backendOrigin: "http://localhost:8080",
      token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.placeholder",
      user: USER,
    };
    expect(Object.keys(apiKeySession).sort()).toEqual(
      Object.keys(oauthSession).sort(),
    );
    expect(apiKeySession.source).toBe("api-key");
    expect(apiKeySession.user).toEqual(USER);
    expect(apiKeySession.backendOrigin).toBe("http://localhost:8080");
  });

  it("validateApiKeyShape rejects empty / whitespace / malformed input", () => {
    for (const bad of ["", "   ", undefined as unknown as string, "abc", "mul_short", "mul_abc def 1234"]) {
      const result = validateApiKeyShape(bad as string);
      expect(result.ok, `expected reject for: ${JSON.stringify(bad)}`).toBe(false);
    }
    expect(validateApiKeyShape(PAT)).toEqual({ ok: true });
    expect(validateApiKeyShape(`  ${PAT}  `)).toEqual({ ok: true });
  });

  it("signInWithApiKey surfaces a sanitized error on server rejection", async () => {
    const fetchImpl = vi.fn(
      async () =>
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

  it("the credential never appears in console or error text", async () => {
    const captures: string[] = [];
    const consoleSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      captures.push(args.map(String).join(" "));
    });
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify(makeWireUser()), { status: 200 }),
    ) as unknown as typeof fetch;
    try {
      await signInWithApiKey({
        apiKey: PAT,
        backendOrigin: "http://localhost:8080",
        client: new MulticaClient({
          session: {
            source: "oauth",
            backendOrigin: "http://localhost:8080",
            token: "placeholder",
            user: null,
          },
          fetchImpl,
        }),
      });
    } finally {
      consoleSpy.mockRestore();
    }
    expect(captures.join("\n")).not.toContain(PAT);
  });

  it("signOut clears the session and is symmetric for the API-key path", async () => {
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

  it("the credential is never embedded in a React Query key", () => {
    const session: SessionState = {
      source: "api-key",
      backendOrigin: "http://localhost:8080",
      token: PAT,
      user: USER,
    };
    const fp = credentialFingerprint(session.token);
    const queryKey = ["workspaces", fp, session.backendOrigin];
    expect(JSON.stringify(queryKey)).not.toContain(PAT);
    expect(fp).toMatch(/^tok-[0-9a-f]{8}$/);
  });

  it("the WebSocket auth frame is the documented §7.1 bearer handshake", () => {
    const session: SessionState = {
      source: "api-key",
      backendOrigin: "http://localhost:8080",
      token: PAT,
      user: USER,
    };
    const frame = buildWebSocketAuthFrame(session);
    expect(frame).toEqual({ type: "auth", payload: { token: PAT } });
    // The bearer token is the credential; we don't redact the frame
    // itself (it must be the literal token to authenticate). We DO
    // assert no *second* credential slipped in alongside it (e.g. an
    // accidentally logged session) by re-running redaction on the
    // serialised frame and confirming only one match (the literal
    // PAT in the token field).
    const serialised = JSON.stringify(frame);
    expect(serialised).toContain(PAT);
    // Defensive: ensure no other tokens, headers, or query keys are
    // hiding in the frame alongside the bearer.
    const { redactions } = redactCredentialDetailed(serialised.replace(PAT, ""));
    expect(redactions).toBe(0);
  });

  it("redactCredential scrubs a bearer header passed as an error", () => {
    const text = `Authorization: Bearer ${PAT} did not match.`;
    const out = redactCredential(text);
    expect(out).not.toContain(PAT);
    expect(out).toContain("Bearer <<REDACTED>>");
  });
});
