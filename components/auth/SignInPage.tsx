"use client";

/**
 * Two-path sign-in screen.
 *
 * Stage 2 Task 2.4. The screen presents OAuth (email + verification
 * code) and the API-key paste as EQUAL alternatives. The API-key path
 * is NOT a hidden "advanced" toggle: both panels have the same visual
 * weight and the same affordances.
 *
 * The first time a user clicks the API-key submit, we surface a
 * one-shot threat-model reminder. Subsequent submits in the same
 * browser session do not nag. The acknowledgement lives in
 * `sessionStorage` keyed by the backend origin so two deployments
 * can coexist.
 *
 * The parent (`AuthGate` in `app/page.tsx`) is responsible for
 * routing forward once `onSession` fires.
 */

import { useState } from "react";

import { ApiKeySignInForm } from "./ApiKeySignInForm";
import { OAuthSignInForm } from "./OAuthSignInForm";
import { API_BASE_URL, APP_NAME } from "../../lib/api/config";
import { useMulticaClient } from "../../hooks/use-multica-client";
import type { SessionState } from "../../lib/types";

const ACK_KEY = "multica-slack:api-key-acknowledged";

function readAcknowledgement(origin: string): boolean {
  if (typeof window === "undefined") return true; // SSR: never nag.
  try {
    return window.sessionStorage.getItem(`${ACK_KEY}:${origin}`) === "1";
  } catch {
    return false;
  }
}

function writeAcknowledgement(origin: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(`${ACK_KEY}:${origin}`, "1");
  } catch {
    // Storage disabled — nag again next visit. Acceptable trade-off.
  }
}

export interface SignInPageProps {
  onSession: (session: SessionState) => void;
  /** Override for tests; defaults to `API_BASE_URL`. */
  backendOrigin?: string;
}

export function SignInPage({
  onSession,
  backendOrigin = API_BASE_URL,
}: SignInPageProps) {
  // The acknowledgement flag reads from sessionStorage once at
  // mount. We deliberately do NOT subscribe to storage changes —
  // the acknowledgement only needs to be evaluated when the page
  // mounts for the first time per backend origin.
  const [acknowledged] = useState(() => readAcknowledgement(backendOrigin));

  // `useMulticaClient()` always returns a `MulticaClient`: the
  // provider mounts a placeholder when no session exists, and both
  // sign-in forms (OAuth + API key) use that placeholder to call
  // the public `/auth/*` endpoints. The pre-fix code constructed
  // a second `MulticaClient` here; sharing the context-provided
  // instance keeps a single source of truth and means the test
  // that asserts the API-key form reaches `signInWithApiKey`
  // exercises the same client the user sees in production.
  const client = useMulticaClient();

  function handleApiKeySubmit(session: SessionState) {
    if (!acknowledged) writeAcknowledgement(backendOrigin);
    onSession(session);
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "calc(var(--shell-pad) * 2)",
        background: "var(--color-canvas)",
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: 880,
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
        aria-labelledby="signin-title"
      >
        <header>
          <p
            style={{
              margin: 0,
              color: "var(--color-fg-subtle)",
              fontSize: 12,
              letterSpacing: 1.2,
              textTransform: "uppercase",
            }}
          >
            {APP_NAME}
          </p>
          <h1
            id="signin-title"
            style={{
              margin: "8px 0 4px",
              color: "var(--color-fg)",
              fontSize: 26,
              lineHeight: 1.2,
            }}
          >
            Sign in
          </h1>
          <p
            style={{
              margin: 0,
              color: "var(--color-fg-muted)",
              maxWidth: 540,
              lineHeight: 1.5,
            }}
          >
            Two equivalent ways to authenticate against{" "}
            <code style={{ fontFamily: "var(--font-mono)" }}>
              {backendOrigin}
            </code>
            . Pick the one that fits your setup.
          </p>
        </header>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: 20,
          }}
        >
          <article
            style={{
              background: "var(--color-elevated)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-lg)",
              padding: 24,
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <header>
              <h2
                style={{
                  margin: 0,
                  color: "var(--color-fg)",
                  fontSize: 16,
                }}
              >
                Email + verification code
              </h2>
              <p
                style={{
                  margin: "4px 0 0",
                  color: "var(--color-fg-muted)",
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                The standard Multica browser flow. We&rsquo;ll email you a
                6-digit code.
              </p>
            </header>
            <OAuthSignInForm
              client={client}
              backendOrigin={backendOrigin}
              onSuccess={onSession}
            />
          </article>

          <article
            style={{
              background: "var(--color-elevated)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-lg)",
              padding: 24,
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <header>
              <h2
                style={{
                  margin: 0,
                  color: "var(--color-fg)",
                  fontSize: 16,
                }}
              >
                API key
              </h2>
              <p
                style={{
                  margin: "4px 0 0",
                  color: "var(--color-fg-muted)",
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                Paste a Multica personal access token (<code>mul_…</code>).
                Best for self-hosted users, automation, and developer
                testing.
              </p>
            </header>
            {!acknowledged ? (
              <div
                role="note"
                style={{
                  background: "var(--color-canvas)",
                  border: "1px solid var(--color-border-strong)",
                  borderRadius: "var(--radius-md)",
                  padding: 12,
                  color: "var(--color-fg-muted)",
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              >
                <strong style={{ color: "var(--color-fg)" }}>
                  Heads up.
                </strong>{" "}
                The API key will be held in this browser until you sign
                out. Anyone with access to this device can use it. The
                Multica server will attribute activity to the key, not
                to your interactive login.
              </div>
            ) : null}
            <ApiKeySignInForm
              onSuccess={handleApiKeySubmit}
              backendOrigin={backendOrigin}
            />
          </article>
        </div>
      </section>
    </main>
  );
}
