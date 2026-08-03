/**
 * Credential redaction tests.
 *
 * The Stage 2 gate requires that the API key never appears in logs,
 * visible errors, query caches, telemetry, or unrelated origins. These
 * tests are the executable proof that the redaction layer covers the
 * realistic shapes a credential can take.
 */

import { describe, expect, it } from "vitest";

import {
  REDACTION_PLACEHOLDER,
  assertNoCredential,
  credentialFingerprint,
  redactCredential,
  redactCredentialDetailed,
} from "./redact";

const PAT = "mul_abcdef0123456789ABCDEF";
const JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.7Jh7bC7pRr7C2gZm0tEf8pOqHgZjQ1kEfA1q8rR4z9g";

describe("redactCredential", () => {
  it("replaces a bare PAT", () => {
    const text = `Authorization successful for ${PAT}`;
    expect(redactCredential(text)).toBe(
      `Authorization successful for ${REDACTION_PLACEHOLDER}`,
    );
  });

  it("replaces a Bearer header but keeps the scheme", () => {
    expect(redactCredential(`Authorization: Bearer ${JWT}`)).toBe(
      `Authorization: Bearer ${REDACTION_PLACEHOLDER}`,
    );
  });

  it("replaces a bare JWT", () => {
    expect(redactCredential(`token=${JWT}`)).toBe(
      `token=${REDACTION_PLACEHOLDER}`,
    );
  });

  it("scrubs credentials from URL query strings", () => {
    const url = `https://example.test/api?token=${PAT}&other=ok`;
    expect(redactCredential(url)).toBe(
      `https://example.test/api?token=${REDACTION_PLACEHOLDER}&other=ok`,
    );
  });

  it("scrubs multiple distinct credentials in one string", () => {
    const text = `first=${PAT} second=${JWT} third=${PAT}`;
    const { text: out, redactions } = redactCredentialDetailed(text);
    expect(redactions).toBe(3);
    expect(out).toContain(REDACTION_PLACEHOLDER);
    expect(out).not.toContain(PAT);
    expect(out).not.toContain(JWT);
  });

  it("does not touch non-credential content", () => {
    const text = "hello world, status=ok, count=42";
    const { text: out, redactions } = redactCredentialDetailed(text);
    expect(redactions).toBe(0);
    expect(out).toBe(text);
  });

  it("redacts even when the credential appears mid-URL", () => {
    const url = `https://api.example.test/redirect?api_key=${PAT}`;
    expect(redactCredential(url)).toContain(REDACTION_PLACEHOLDER);
    expect(redactCredential(url)).not.toContain(PAT);
  });

  it("redacts a credential embedded in JSON-shaped error text", () => {
    const blob = `{"error":"invalid token ${PAT}","hint":"see docs"}`;
    const out = redactCredential(blob);
    expect(out).not.toContain(PAT);
    expect(out).toContain(REDACTION_PLACEHOLDER);
  });
});

describe("assertNoCredential", () => {
  it("does not throw for clean text", () => {
    expect(() => assertNoCredential("log", "everything fine")).not.toThrow();
  });

  it("throws when a credential is present", () => {
    expect(() => assertNoCredential("log", `token=${PAT}`)).toThrow(
      /Credential redaction guard tripped/i,
    );
  });
});

describe("credentialFingerprint", () => {
  it("returns the same fingerprint for the same input", () => {
    expect(credentialFingerprint(PAT)).toBe(credentialFingerprint(PAT));
  });

  it("returns different fingerprints for different inputs", () => {
    expect(credentialFingerprint(PAT)).not.toBe(credentialFingerprint(JWT));
  });

  it("never contains the original credential", () => {
    const fp = credentialFingerprint(PAT);
    expect(fp).not.toContain(PAT);
    expect(fp.startsWith("tok-")).toBe(true);
  });
});
