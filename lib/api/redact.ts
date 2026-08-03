/**
 * Credential redaction.
 *
 * The Stage 2 gate is explicit: API keys must never appear in logs,
 * visible errors, query caches, telemetry, or unrelated origins. This
 * module is the *single* source of truth for what counts as a
 * credential and how to scrub it from text.
 *
 * The rules apply to:
 *
 * 1. `Authorization: Bearer <jwt|pat>` headers — replace the token,
 *    keep the scheme.
 * 2. Bare JWTs (three base64url segments starting with `eyJ`).
 * 3. Bare PATs (`mul_<base62>`).
 * 4. URL query strings — `?token=…`, `?api_key=…`, etc.
 * 5. JSON-ish text that contains the above patterns, so even an
 *    accidental server-echoed credential can't escape through an
 *    exception message.
 *
 * The replacement is the literal string `REDACTED_PLACEHOLDER`. Tests
 * assert on the exact value so the placeholder becomes part of the
 * public contract.
 */

/**
 * The replacement sentinel. It deliberately contains no characters the
 * URL / query-key redaction regex treats as boundary markers (`&`, `#`,
 * whitespace, `"`, `=`, `]`, `[`), so passing an already-redacted
 * string back through `redactCredential` is idempotent — a second
 * pass cannot truncate the placeholder itself.
 */
export const REDACTION_PLACEHOLDER = "<<REDACTED>>";

/** PAT shape: `mul_` followed by base62 of length ≥ 16. */
const PAT_PATTERN = /mul_[A-Za-z0-9]{16,}/g;

/**
 * JWT shape: three base64url segments, the first one starting with
 * `eyJ` (the base64url of `{"`). Real JWTs always have header +
 * payload + signature; we accept segments of any length ≥ 4 chars to
 * keep the matcher robust against clock-skew / signature tweaks.
 */
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{4,}\.eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g;

/**
 * `Bearer <token>` — we keep the scheme so the resulting string still
 * reads as a bearer header. The token part can be a JWT or a PAT.
 */
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._-]{8,}/gi;

/**
 * Common query / form keys that carry secrets. Match the value to the
 * next `&`, `#`, `=`, whitespace, `"`, or `]` so we don't accidentally
 * snip into the rest of the URL or eat our own redaction placeholder.
 */
const QUERY_KEY_PATTERN =
  /\b(token|access_token|api[_-]?key|secret|password|code|pat|multica[_-]?token)=([^&\s#"=\]]+)/gi;

export interface RedactionResult {
  text: string;
  /** Number of redactions that fired. Useful for diagnostics + tests. */
  redactions: number;
}

/**
 * Scrub every recognised credential pattern from `text`.
 *
 * Safe to call repeatedly (idempotent) and cheap enough to run on
 * every error message and response body.
 */
export function redactCredential(text: string): string {
  return redactCredentialDetailed(text).text;
}

export function redactCredentialDetailed(text: string): RedactionResult {
  let redactions = 0;
  let out = text;

  // Bearer headers first so we replace only the token half.
  out = out.replace(BEARER_PATTERN, () => {
    redactions += 1;
    return `Bearer ${REDACTION_PLACEHOLDER}`;
  });

  out = out.replace(JWT_PATTERN, () => {
    redactions += 1;
    return REDACTION_PLACEHOLDER;
  });

  out = out.replace(PAT_PATTERN, () => {
    redactions += 1;
    return REDACTION_PLACEHOLDER;
  });

  out = out.replace(QUERY_KEY_PATTERN, (_match, key: string) => {
    redactions += 1;
    return `${key}=${REDACTION_PLACEHOLDER}`;
  });

  return { text: out, redactions };
}

/**
 * Convenience guard for callers that want to assert a credential did
 * NOT leak through some channel. Returns the original text when no
 * credential is present and throws a descriptive error otherwise. The
 * error message itself goes through redaction, so accidental leakage
 * here cannot double-leak.
 */
export function assertNoCredential(label: string, text: string): void {
  const { redactions } = redactCredentialDetailed(text);
  if (redactions > 0) {
    throw new Error(
      `Credential redaction guard tripped for "${label}": ` +
        `${redactions} pattern(s) found. This is a Stage 2 gate violation.`,
    );
  }
}

/**
 * Hash a credential into a short, stable cache key. Stage 2 uses this
 * to keep React Query keys free of the raw token (the gate explicitly
 * forbids it from appearing in query cache entries).
 *
 * Implementation note: FNV-1a 32-bit hash in pure JS so we don't pull
 * in `crypto.subtle` (unavailable in some sandboxed browser contexts)
 * and so the function is sync / cheap to call inside `queryKey`.
 */
export function credentialFingerprint(token: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    // Equivalent to `hash *= 16777619` with overflow.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return `tok-${hash.toString(16).padStart(8, "0")}`;
}
