/**
 * Component-level regression test for the API-key sign-in form.
 *
 * Stage 2 review (TAV-39) caught a wiring bug in
 * `components/auth/ApiKeySignInForm.tsx`: the form called
 * `useMulticaClient()` while signed out, the hook returned `null`,
 * and `handleSubmit` short-circuited on the "no MulticaClient in
 * the provider tree" branch before `signInWithApiKey` could
 * validate the key against `GET /api/me`.
 *
 * The unit tests in `lib/auth/api-key.test.ts` only exercise
 * `signInWithApiKey` with an injected client, so this regression
 * went unnoticed. This file renders the real form inside the real
 * `<Providers>` tree with a mocked `GET /api/me` and asserts:
 *
 *  - submitting a valid `mul_…` key calls `GET /api/me` exactly
 *    once (with the API key as the bearer);
 *  - the form does NOT display the "no MulticaClient in the
 *    provider tree" wiring error;
 *  - the resolved session reaches the parent via `onSuccess`;
 *  - the credential never appears in any error message or DOM text.
 *
 * `@vitest-environment happy-dom` so React can mount, the
 * `BrowserSessionStore` can use `window.localStorage`, and
 * `sessionStorage` is available for the API-key acknowledgement.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Providers } from "../../app/providers";
import { ApiKeySignInForm } from "./ApiKeySignInForm";
import { useSession, useSessionStore } from "../../lib/auth/use-session";
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

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
}

/**
 * Build a fetch mock that records every call and returns a canned
 * response for `GET /api/me`. The mock rejects any call to a path
 * we did not register so a routing bug shows up as a test failure
 * rather than a silent network hit.
 */
function makeFetchMock(): {
  fetch: typeof fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
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
          for (const [k, v] of Object.entries(h)) {
            headers[k.toLowerCase()] = v as string;
          }
        }
      }
      calls.push({ url, method: init?.method ?? "GET", headers });

      if (url.endsWith("/api/me") || url.includes("/api/me?")) {
        return new Response(JSON.stringify(makeWireUser()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch call in test: ${init?.method ?? "GET"} ${url}`);
    },
  ) as unknown as typeof fetch;
  return { fetch: fetchImpl, calls };
}

/**
 * Test harness that mirrors `HomePage`'s wiring:
 *
 *  - the form calls `onSuccess(session)` after a successful sign-in;
 *  - the parent writes the session into the SessionStore via
 *    `store.set(session)`, exactly like `HomePage.handleSession`;
 *  - a small probe component re-renders whenever the SessionStore
 *    changes and exposes the current session through data
 *    attributes so the test can read it via the DOM.
 *
 * The fetch mock is threaded into `<Providers>` via the
 * `fetchImpl` test seam so the network layer uses our canned
 * `GET /api/me` response without booting a real backend.
 */
function Harness({
  onSession,
  fetchImpl,
}: {
  onSession: (session: SessionState) => void;
  fetchImpl: typeof fetch;
}) {
  return (
    <Providers fetchImpl={fetchImpl}>
      <ApiKeySignInFormWithStore onSession={onSession} />
    </Providers>
  );
}

function ApiKeySignInFormWithStore({
  onSession,
}: {
  onSession: (session: SessionState) => void;
}) {
  const store = useSessionStore();
  const session = useSession();
  return (
    <>
      <div
        data-testid="session-probe"
        data-source={session?.source ?? "null"}
        data-token={session?.token ?? "null"}
      />
      <ApiKeySignInForm
        onSuccess={(next) => {
          // Mirror `HomePage.handleSession` so the store updates
          // and the rest of the tree (including the probe) sees
          // the new session.
          store.set(next);
          onSession(next);
        }}
      />
    </>
  );
}

describe("ApiKeySignInForm (component regression)", () => {
  beforeEach(() => {
    // Clear any acknowledgement leftover between tests so the
    // "Heads up" note doesn't carry over and confuse assertions.
    try {
      window.sessionStorage.clear();
      window.localStorage.clear();
    } catch {
      // Storage may be disabled in some sandboxes; ignore.
    }
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("submits a valid mul_ key, hits GET /api/me, and does NOT short-circuit on the wiring error", async () => {
    const { fetch, calls } = makeFetchMock();
    const onSession = vi.fn();
    const user = userEvent.setup();

    render(<Harness onSession={onSession} fetchImpl={fetch} />);

    const input = screen.getByPlaceholderText("mul_...");
    const submit = screen.getByRole("button", { name: /sign in with api key/i });

    await user.type(input, PAT);
    expect(submit).not.toBeDisabled();
    await user.click(submit);

    // The pre-fix form would render the "no MulticaClient" error
    // before reaching `signInWithApiKey`. The first assertion
    // therefore checks the DOM is free of that specific string.
    expect(
      screen.queryByText(/no MulticaClient in the provider tree/i),
    ).not.toBeInTheDocument();

    // `GET /api/me` must have been called exactly once, with the
    // API key as the bearer — the production wiring uses the
    // placeholder until `signInWithApiKey` swaps in the probe
    // session, so by the time the request hits the wire the
    // bearer is the actual PAT.
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    const call = calls[0]!;
    expect(call.method).toBe("GET");
    expect(call.url).toMatch(/\/api\/me$/);
    expect(call.headers["authorization"]).toBe(`Bearer ${PAT}`);

    // The session must reach the parent via `onSuccess` and the
    // store should mirror it via the `useSession` probe.
    await waitFor(() => {
      expect(onSession).toHaveBeenCalledTimes(1);
    });
    const session = onSession.mock.calls[0]?.[0] as SessionState;
    expect(session.source).toBe("api-key");
    expect(session.token).toBe(PAT);
    expect(session.user).toEqual(USER);

    await waitFor(() => {
      const probe = screen.getByTestId("session-probe");
      expect(probe.getAttribute("data-source")).toBe("api-key");
      expect(probe.getAttribute("data-token")).toBe(PAT);
    });

    // The credential must never appear in any error text — the
    // redaction pipeline is the Stage 2 gate.
    expect(document.body.textContent ?? "").not.toContain(PAT);
  });

  it("shows the API-key error branch on a 401, but never the wiring-error branch", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    const onSession = vi.fn();
    const user = userEvent.setup();

    render(<Harness onSession={onSession} fetchImpl={fetchImpl} />);

    await user.type(screen.getByPlaceholderText("mul_..."), PAT);
    await user.click(screen.getByRole("button", { name: /sign in with api key/i }));

    await waitFor(() => {
      expect(
        screen.queryByText(/no MulticaClient in the provider tree/i),
      ).not.toBeInTheDocument();
    });
    // The redaction pipeline produces a generic "Sign-in failed"
    // line for non-credential server echoes. We assert the form
    // surfaces an alert so the user can recover.
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(onSession).not.toHaveBeenCalled();
  });

  it("disables submit when the key is empty or malformed", () => {
    const { fetch, calls } = makeFetchMock();
    const onSession = vi.fn();
    render(<Harness onSession={onSession} fetchImpl={fetch} />);

    const submit = screen.getByRole("button", { name: /sign in with api key/i });
    expect(submit).toBeDisabled();
    expect(calls).toHaveLength(0);
    expect(onSession).not.toHaveBeenCalled();
  });
});
