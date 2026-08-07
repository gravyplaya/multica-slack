/**
 * Runtime configuration for the Multica client.
 *
 * NEXT_PUBLIC_* values are read with STATIC `process.env.<NAME>`
 * property access so Next.js's bundler can inline the build-time
 * value into the client bundle. Dynamic property access (e.g.
 * `process.env[name]` inside a helper) is NOT inlined — the
 * browser bundle keeps the `process.env.<NAME>` reference and
 * resolves it at runtime from the compile-mode payload, which can
 * disagree with the server's live environment and trigger a React
 * hydration mismatch on the first paint.
 *
 * The defaults match `.env.example` and the local self-host
 * assumptions in `README.md`.
 */

const DEFAULT_API_BASE = "http://localhost:8080";
const DEFAULT_WS_BASE = "ws://localhost:8080/ws";
const DEFAULT_APP_NAME = "Multica Slack";

const trimTrailingSlashes = (s: string) => s.trim().replace(/\/+$/, "");

/**
 * Promote an insecure `ws://` WebSocket URL to `wss://` when the REST
 * API base is served over TLS. A plaintext WebSocket handshake against
 * an HTTPS origin is either blocked by the browser (mixed-content) or
 * silently downgraded, so this guard turns a common env misconfiguration
 * (REST `https://…`, WS `ws://…`) into the correct `wss://…` instead of
 * letting the realtime layer fail at runtime. Local self-host keeps
 * `http://` + `ws://` unchanged.
 *
 * Exported for unit testing.
 */
export function upgradeWsScheme(apiBase: string, wsUrl: string): string {
  if (apiBase.startsWith("https://") && wsUrl.startsWith("ws://")) {
    return `wss://${wsUrl.slice("ws://".length)}`;
  }
  return wsUrl;
}

/*
 * Static `process.env.<NAME>` reads. Next.js's DefinePlugin replaces
 * these exact identifiers with the build-time literal at compile
 * time, so the server and the browser bundle always agree on the
 * value. Do NOT route these through a helper function — indirect
 * access breaks the inliner and re-introduces the mismatch.
 */
const envApiBase =
  typeof process !== "undefined" && typeof process.env !== "undefined"
    ? process.env.NEXT_PUBLIC_MULTICA_API
    : undefined;
const envWs =
  typeof process !== "undefined" && typeof process.env !== "undefined"
    ? process.env.NEXT_PUBLIC_MULTICA_WS
    : undefined;
const envAppName =
  typeof process !== "undefined" && typeof process.env !== "undefined"
    ? process.env.NEXT_PUBLIC_APP_NAME
    : undefined;

export const API_BASE_URL =
  envApiBase && envApiBase.length > 0
    ? trimTrailingSlashes(envApiBase)
    : DEFAULT_API_BASE;

export const WS_URL = upgradeWsScheme(
  API_BASE_URL,
  envWs && envWs.length > 0 ? trimTrailingSlashes(envWs) : DEFAULT_WS_BASE,
);

export const APP_NAME =
  envAppName && envAppName.length > 0 ? envAppName.trim() : DEFAULT_APP_NAME;

export interface ClientConfig {
  apiBaseUrl: string;
  wsUrl: string;
  /** Optional client telemetry headers — never include credentials. */
  clientPlatform: string;
  clientVersion: string;
  clientOs: string;
}

export const DEFAULT_CLIENT_CONFIG: ClientConfig = {
  apiBaseUrl: API_BASE_URL,
  wsUrl: WS_URL,
  clientPlatform: "multica-slack-web",
  clientVersion: "0.1.0",
  clientOs:
    typeof navigator !== "undefined"
      ? (navigator.platform ?? "unknown")
      : "unknown",
};
