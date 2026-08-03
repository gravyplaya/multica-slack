"use client";

/**
 * API-key sign-in panel.
 *
 * Stage 2 Task 2.4. The panel is presented as a first-class
 * alternative to OAuth: paste field, show/hide toggle, whitespace-only
 * rejection, submit disabled until the key is non-empty, and inline
 * server error surfaced WITHOUT disclosing whether the key was
 * malformed vs. rejected (see Task 2.4 step 2 and the corresponding
 * test in `lib/auth/api-key.test.ts`).
 *
 * Hard rules:
 *
 * - The credential value is stored in component state only and is
 *   never written to any prop, key, or string we log. Error messages
 *   go through `redactCredential` (via `InvalidApiKeyError`) so even
 *   an accidental server echo cannot escape through the UI.
 * - The submit button is disabled until the key passes
 *   `validateApiKeyShape` AND we are not already submitting.
 * - `showKey` defaults to OFF so shoulder-surfing the paste field is
 *   not the default UX.
 * - We never read or write to `localStorage` here — the
 *   `SessionStore` is the only owner.
 *
 * After a successful sign-in the parent (`SignInPage`) writes the
 * resulting `SessionState` into the store and the router moves on.
 */

import { useId, useState, type FormEvent } from "react";

import {
  InvalidApiKeyError,
  signInWithApiKey,
  validateApiKeyShape,
} from "../../lib/auth/api-key";
import { API_BASE_URL } from "../../lib/api/config";
import { useMulticaClient } from "../../hooks/use-multica-client";
import type { SessionState } from "../../lib/types";

export interface ApiKeySignInFormProps {
  /**
   * Called with the validated session when sign-in succeeds. The
   * parent is responsible for storing the session and routing
   * forward.
   */
  onSuccess: (session: SessionState) => void;
  /**
   * Optional override for the backend origin. Defaults to the
   * runtime-configured `API_BASE_URL`.
   */
  backendOrigin?: string;
}

export function ApiKeySignInForm({
  onSuccess,
  backendOrigin = API_BASE_URL,
}: ApiKeySignInFormProps) {
  const client = useMulticaClient();
  const inputId = useId();
  const errorId = useId();

  const [value, setValue] = useState("");
  const [reveal, setReveal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shape = validateApiKeyShape(value);
  const submitDisabled = submitting || !shape.ok;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitDisabled) return;
    // `useMulticaClient` always returns a client now: the provider
    // mounts a placeholder when no session exists, and the API-key
    // form reaches `signInWithApiKey` which swaps in a probe session
    // and calls `GET /api/me`. The old `if (!client) { ... }` branch
    // is removed because it is unreachable.
    setSubmitting(true);
    setError(null);
    try {
      const session = await signInWithApiKey({
        apiKey: value,
        backendOrigin,
        client,
      });
      // Wipe the paste field so the key does not linger in the React
      // tree after sign-in. The credential is now owned by the
      // SessionStore; we do not need it here.
      setValue("");
      onSuccess(session);
    } catch (cause) {
      if (cause instanceof InvalidApiKeyError) {
        setError(cause.message);
      } else {
        setError("Sign-in failed for an unknown reason. Try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-describedby={error ? errorId : undefined}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        width: "100%",
      }}
    >
      <label
        htmlFor={inputId}
        style={{
          color: "var(--color-fg-muted)",
          fontSize: 12,
          letterSpacing: 0.4,
          textTransform: "uppercase",
        }}
      >
        Multica API key
      </label>
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "stretch",
        }}
      >
        <input
          id={inputId}
          type={reveal ? "text" : "password"}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="mul_..."
          aria-invalid={Boolean(error) || (!shape.ok && value.length > 0)}
          aria-describedby={error ? errorId : undefined}
          style={{
            flex: 1,
            padding: "10px 12px",
            background: "var(--color-canvas)",
            color: "var(--color-fg)",
            border: `1px solid ${error ? "var(--color-danger)" : "var(--color-border)"}`,
            borderRadius: "var(--radius-md)",
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            outline: "none",
          }}
        />
        <button
          type="button"
          onClick={() => setReveal((prev) => !prev)}
          aria-pressed={reveal}
          aria-label={reveal ? "Hide API key" : "Show API key"}
          style={{
            padding: "0 12px",
            background: "var(--color-elevated)",
            color: "var(--color-fg-muted)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          {reveal ? "Hide" : "Show"}
        </button>
      </div>
      <p
        style={{
          margin: 0,
          color: "var(--color-fg-subtle)",
          fontSize: 12,
          lineHeight: 1.5,
        }}
      >
        Keys begin with <code style={{ fontFamily: "var(--font-mono)" }}>mul_</code>.
        Generate one in Multica under your account settings.
      </p>
      <button
        type="submit"
        disabled={submitDisabled}
        style={{
          padding: "10px 14px",
          background: submitDisabled
            ? "var(--color-elevated)"
            : "var(--color-accent)",
          color: submitDisabled
            ? "var(--color-fg-muted)"
            : "var(--color-accent-fg)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
          fontSize: 14,
          fontWeight: 600,
          cursor: submitDisabled ? "not-allowed" : "pointer",
        }}
      >
        {submitting ? "Signing in…" : "Sign in with API key"}
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
