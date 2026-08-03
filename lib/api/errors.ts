/**
 * Typed Multica error envelope.
 *
 * The Multica contract has no machine-readable error code — the only
 * stable discriminator is the HTTP status (see §1.4 of
 * `docs/contracts/multica-api.md`). We surface that plus a sanitized
 * message and the optional request id from the response headers, and we
 * refuse to keep the raw response body. This is the single point where
 * credentials could leak through error reporting, so all `toString`
 * paths go through `sanitizeMessage` before reaching the UI.
 */

import { redactCredential, REDACTION_PLACEHOLDER } from "./redact";

/**
 * Numeric categories a component may want to branch on without leaking
 * the HTTP status into props. Mirrors the contract §1.4 status table.
 */
export type MulticaErrorKind =
  | "validation"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "service_unavailable"
  | "network"
  | "aborted"
  | "unknown";

const STATUS_TO_KIND: Record<number, MulticaErrorKind> = {
  400: "validation",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  422: "conflict",
  429: "rate_limited",
  503: "service_unavailable",
};

export function kindForStatus(status: number): MulticaErrorKind {
  if (status in STATUS_TO_KIND) return STATUS_TO_KIND[status]!;
  if (status >= 500) return "service_unavailable";
  return "unknown";
}

export class MulticaApiError extends Error {
  readonly status: number;
  readonly kind: MulticaErrorKind;
  readonly requestId: string | null;

  constructor(params: {
    status: number;
    message: string;
    requestId?: string | null;
    cause?: unknown;
  }) {
    // Always run the message through redaction so a leaked `Authorization`
    // header echoed by the server cannot escape through `error.message`.
    super(redactCredential(sanitizeMessage(params.message)));
    this.name = "MulticaApiError";
    this.status = params.status;
    this.kind = kindForStatus(params.status);
    this.requestId = params.requestId ?? null;
    if (params.cause !== undefined) {
      // Preserve the cause for debugging without leaking it through
      // `toString()` (Node's default Error.toString prints `.cause` only
      // when explicitly formatted; we override it below for safety).
      (this as { cause?: unknown }).cause = params.cause;
    }
  }

  /**
   * Never serialise the raw response body, even when callers stringify
   * the error to log it. The default `Error.prototype.toString` only
   * prints the name + message, which is exactly what we want; we
   * override here purely as a defensive measure to document the
   * contract.
   */
  override toString(): string {
    const suffix = this.requestId ? ` (request ${this.requestId})` : "";
    return `${this.name}: ${this.message}${suffix}`;
  }
}

export class MulticaNetworkError extends Error {
  readonly kind = "network" as const;

  constructor(message: string, cause?: unknown) {
    super(redactCredential(sanitizeMessage(message)));
    this.name = "MulticaNetworkError";
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

export class MulticaAbortError extends Error {
  readonly kind = "aborted" as const;

  constructor(message = "Request aborted") {
    super(message);
    this.name = "MulticaAbortError";
  }
}

/**
 * Trim and clamp the server's error message to a single short line.
 * The contract §1.4 messages can be long (e.g. enum validation
 * guidance); we keep the first sentence and append an ellipsis when
 * the text was truncated.
 */
export function sanitizeMessage(raw: string | null | undefined): string {
  if (typeof raw !== "string") return "Unknown error";
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (trimmed.length <= 240) return trimmed;
  return `${trimmed.slice(0, 237)}...`;
}

/** Marker so tests can assert the redaction actually fired. */
export const REDACTED = REDACTION_PLACEHOLDER;
