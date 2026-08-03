"use client";

/**
 * OAuth / email-code sign-in panel.
 *
 * Standard Multica browser flow per `docs/contracts/multica-api.md`
 * section 2.1:
 *
 *   POST /auth/send-code  { email }            -> 200 (empty) | 429
 *   POST /auth/verify-code { email, code }     -> 200 { token, user }
 *
 * The browser keeps the JWT in memory (via the SessionStore) so the
 * same session shape feeds both this path and the API-key path. The
 * server also sets an HttpOnly cookie for image / asset auth.
 *
 * Hard rules:
 *
 * - We disable submit until the email and 6-digit code are both
 *   syntactically valid (we don't otherwise guess; the server is the
 *   authority on whether the code matches).
 * - 429 responses (too many codes requested) surface as a generic
 *   "Try again in a minute" message; we never include the limit
 *   window or any credential-shaped value.
 * - The JWT returned by the server is wrapped in `redactCredential`
 *   before being logged or echoed back. UI never shows it.
 */

import { useId, useState, type FormEvent } from "react";

import { MulticaClient } from "../../lib/api/client";
import {
  MulticaApiError,
  MulticaNetworkError,
} from "../../lib/api/errors";
import type { SessionState, UserView } from "../../lib/types";

export interface OAuthSignInFormProps {
  /**
   * A pre-built MulticaClient used to call the public auth endpoints.
   * The form does not require a session, so the client is constructed
   * by the parent with a placeholder bearer that the client drops on
   * unauthenticated calls.
   */
  client: MulticaClient;
  backendOrigin: string;
  onSuccess: (session: SessionState) => void;
}

const CODE_LENGTH = 6;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function OAuthSignInForm({
  client,
  backendOrigin,
  onSuccess,
}: OAuthSignInFormProps) {
  const emailId = useId();
  const codeId = useId();
  const errorId = useId();

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailOk = EMAIL_PATTERN.test(email.trim());
  const codeOk = /^\d{6}$/.test(code.trim());
  const sendDisabled = submitting || !emailOk;
  const verifyDisabled = submitting || !emailOk || !codeOk;

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sendDisabled) return;
    setSubmitting(true);
    setError(null);
    try {
      await client.sendCode(email.trim());
      setCodeSent(true);
    } catch (cause) {
      if (cause instanceof MulticaApiError) {
        if (cause.status === 429) {
          setError("Too many codes requested. Try again in a minute.");
        } else {
          setError(
            `Could not send a code (${cause.kind}). Check the email address and try again.`,
          );
        }
      } else if (cause instanceof MulticaNetworkError) {
        setError(
          "Could not reach the Multica backend. Check the URL and try again.",
        );
      } else {
        setError("Could not send a code for an unknown reason.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (verifyDisabled) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await client.verifyCode(email.trim(), code.trim());
      const user: UserView = {
        id: response.user.id,
        name: response.user.name,
        email: response.user.email,
        avatarUrl: response.user.avatar_url ?? null,
      };
      const session: SessionState = {
        source: "oauth",
        backendOrigin,
        token: response.token,
        user,
      };
      onSuccess(session);
    } catch (cause) {
      if (cause instanceof MulticaApiError) {
        if (cause.status === 401) {
          setError("That code is not valid (or expired). Request a new one.");
        } else {
          setError(
            `Sign-in failed (${cause.kind}). Try requesting a new code.`,
          );
        }
      } else if (cause instanceof MulticaNetworkError) {
        setError(
          "Could not reach the Multica backend. Check the URL and try again.",
        );
      } else {
        setError("Sign-in failed for an unknown reason.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={codeSent ? verify : send}
      aria-describedby={error ? errorId : undefined}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        width: "100%",
      }}
    >
      <label
        htmlFor={emailId}
        style={{
          color: "var(--color-fg-muted)",
          fontSize: 12,
          letterSpacing: 0.4,
          textTransform: "uppercase",
        }}
      >
        Email
      </label>
      <input
        id={emailId}
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        disabled={codeSent}
        aria-invalid={!emailOk && email.length > 0}
        style={{
          padding: "10px 12px",
          background: "var(--color-canvas)",
          color: "var(--color-fg)",
          border: `1px solid ${error ? "var(--color-danger)" : "var(--color-border)"}`,
          borderRadius: "var(--radius-md)",
          fontSize: 14,
          outline: "none",
        }}
      />
      {codeSent ? (
        <>
          <label
            htmlFor={codeId}
            style={{
              color: "var(--color-fg-muted)",
              fontSize: 12,
              letterSpacing: 0.4,
              textTransform: "uppercase",
            }}
          >
            Verification code
          </label>
          <input
            id={codeId}
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={CODE_LENGTH}
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="123456"
            aria-invalid={!codeOk && code.length > 0}
            style={{
              padding: "10px 12px",
              background: "var(--color-canvas)",
              color: "var(--color-fg)",
              border: `1px solid ${error ? "var(--color-danger)" : "var(--color-border)"}`,
              borderRadius: "var(--radius-md)",
              fontFamily: "var(--font-mono)",
              fontSize: 14,
              letterSpacing: 4,
              outline: "none",
            }}
          />
          <p
            style={{
              margin: 0,
              color: "var(--color-fg-subtle)",
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            Check your inbox for a 6-digit code. The self-hosted dev
            environment accepts the code <code>888888</code>.
          </p>
        </>
      ) : null}
      <button
        type="submit"
        disabled={codeSent ? verifyDisabled : sendDisabled}
        style={{
          padding: "10px 14px",
          background:
            (codeSent ? verifyDisabled : sendDisabled)
              ? "var(--color-elevated)"
              : "var(--color-accent)",
          color:
            (codeSent ? verifyDisabled : sendDisabled)
              ? "var(--color-fg-muted)"
              : "var(--color-accent-fg)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
          fontSize: 14,
          fontWeight: 600,
          cursor:
            (codeSent ? verifyDisabled : sendDisabled)
              ? "not-allowed"
              : "pointer",
        }}
      >
        {submitting
          ? codeSent
            ? "Verifying…"
            : "Sending code…"
          : codeSent
            ? "Sign in"
            : "Send code"}
      </button>
      {error ? (
        <p
          id={errorId}
          role="alert"
          style={{
            margin: 0,
            color: "var(--color-danger)",
            fontSize: 13,
          }}
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}
