/**
 * Runtime configuration for the Multica client.
 *
 * Values are read from `process.env.NEXT_PUBLIC_*` at module load so
 * that Next.js inlines them into the client bundle. A fallback is
 * provided for non-Next runtimes (tests, scripts, future server
 * routes). The defaults match `.env.example` and the local self-host
 * assumptions in `README.md`.
 */

const DEFAULT_API_BASE = "http://localhost:8080";
const DEFAULT_WS_BASE = "ws://localhost:8080/ws";

function readEnv(name: string, fallback: string): string {
  // Guard against `process` being undefined (extremely rare in modern
  // Node but defensive in case the file is imported from a tool that
  // strips the global).
  const env = typeof process !== "undefined" ? process.env : undefined;
  const raw = env?.[name];
  if (typeof raw !== "string" || raw.length === 0) return fallback;
  return raw.trim().replace(/\/+$/, "");
}

export const API_BASE_URL = readEnv("NEXT_PUBLIC_MULTICA_API", DEFAULT_API_BASE);
export const WS_URL = readEnv("NEXT_PUBLIC_MULTICA_WS", DEFAULT_WS_BASE);

export const APP_NAME = readEnv("NEXT_PUBLIC_APP_NAME", "Multica Slack");

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
  clientOs: typeof navigator !== "undefined" ? (navigator.platform ?? "unknown") : "unknown",
};
