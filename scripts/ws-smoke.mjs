#!/usr/bin/env node
/**
 * Live WebSocket smoke test — verifies the backend accepts a browser-style
 * connection after a CORS_ALLOWED_ORIGINS / FRONTEND_ORIGIN change.
 *
 * This is the Phase 0 verification gate from the research conclusion: once the
 * backend origin allowlist is fixed, this script dials `/ws`, sends the auth
 * frame, and asserts `auth_ack` comes back. It does NOT keep the connection
 * open — the handshake is the thing the origin check was blocking.
 *
 * Usage:
 *   node scripts/ws-smoke.mjs --token <jwt|PAT> --workspace <id|slug> \
 *     [--ws-url wss://api.multica.ai/ws] [--origin http://localhost:3000]
 *
 * Environment (all optional; flags win):
 *   MULTICA_WS_URL, MULTICA_TOKEN, MULTICA_WORKSPACE, MULTICA_ORIGIN
 *
 * Exit codes:
 *   0 — handshake succeeded (received auth_ack)
 *   1 — handshake failed (auth_error, timeout, or upgrade rejected)
 *   2 — usage error (missing required args)
 */

const args = parseArgs(process.argv.slice(2));
const wsUrl =
  args["ws-url"] ||
  process.env.MULTICA_WS_URL ||
  "wss://api.multica.ai/ws";
const token = args.token || process.env.MULTICA_TOKEN;
const workspace = args.workspace || process.env.MULTICA_WORKSPACE;
const origin =
  args.origin || process.env.MULTICA_ORIGIN || "http://localhost:3000";

if (!token || !workspace) {
  console.error(
    "Usage: node scripts/ws-smoke.mjs --token <jwt|PAT> --workspace <id|slug>",
  );
  console.error(
    "       [--ws-url wss://...] [--origin http://localhost:3000]",
  );
  process.exit(2);
}

// Build the handshake URL with the same query params the browser sends.
const isUuid = /^[0-9a-fA-F-]{36}$/.test(workspace);
const params = new URLSearchParams({
  [isUuid ? "workspace_id" : "workspace_slug"]: workspace,
  client_platform: "multica-slack-web",
  client_version: "0.1.0",
  client_os: "smoke",
});
const fullUrl = `${wsUrl}?${params}`;

console.log(`[smoke] dialing ${fullUrl}`);
console.log(`[smoke] origin: ${origin}`);
console.log(`[smoke] token: ${token.slice(0, 12)}…${token.length > 16 ? "" : " (short)"}`);

const TIMEOUT_MS = Number(args.timeout || 15000);

let ws;
let settled = false;
let firstFrame = true;

try {
  // Node ≥21 exposes the global WHATWG WebSocket. We set the Origin via the
  // `headers` option so the backend's Origin check sees a browser-style value.
  ws = new WebSocket(fullUrl, {
    headers: { Origin: origin },
  });
} catch (err) {
  console.error(`[smoke] could not construct WebSocket: ${err.message}`);
  process.exit(1);
}

const timer = setTimeout(() => {
  if (settled) return;
  settled = true;
  console.error(`[smoke] TIMEOUT after ${TIMEOUT_MS}ms — no auth_ack received.`);
  try { ws.close(); } catch {}
  process.exit(1);
}, TIMEOUT_MS);

ws.addEventListener("open", () => {
  console.log("[smoke] socket open — sending auth frame");
  ws.send(JSON.stringify({ type: "auth", payload: { token } }));
});

ws.addEventListener("message", (ev) => {
  let frame;
  try {
    frame = JSON.parse(ev.data);
  } catch {
    console.warn(`[smoke] non-JSON frame ignored: ${String(ev.data).slice(0, 80)}`);
    return;
  }

  if (firstFrame) {
    firstFrame = false;
    if (frame.type === "auth_ack") {
      settled = true;
      clearTimeout(timer);
      console.log("[smoke] ✓ auth_ack received — handshake OK");
      console.log("[smoke] Phase 0 origin allowlist is working.");
      try { ws.close(1000, "smoke ok"); } catch {}
      process.exit(0);
    }
    if (frame.type === "auth_error") {
      settled = true;
      clearTimeout(timer);
      console.error(`[smoke] ✗ auth_error: ${frame.payload?.error ?? "unknown"}`);
      try { ws.close(); } catch {}
      process.exit(1);
    }
    // Unexpected first frame — server didn't follow the protocol.
    console.warn(`[smoke] unexpected first frame type: ${frame.type}`);
  } else {
    console.log(`[smoke] post-auth frame: ${frame.type}`);
  }
});

ws.addEventListener("close", (ev) => {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  // A 403 on the upgrade typically surfaces as close code 1006 or a message
  // before the close — print whatever we have.
  console.error(
    `[smoke] ✗ socket closed before auth_ack (code ${ev.code ?? "n/a"}, reason: ${ev.reason ?? "none"})`,
  );
  console.error(
    "[smoke] If code is 1006 / 1008 and you just changed CORS_ALLOWED_ORIGINS,",
  );
  console.error(
    "[smoke] the origin allowlist likely still excludes the browser origin.",
  );
  process.exit(1);
});

ws.addEventListener("error", (ev) => {
  if (settled) return;
  // The 'error' event in Node carries no detail; the close event follows it
  // with the code/reason. Let the close handler produce the verdict, but log
  // a breadcrumb so the output isn't empty if close never fires.
  console.error("[smoke] WebSocket error event — upgrade may have been rejected.");
});

/**
 * Tiny argv parser: --flag value pairs and --flag=value.
 * @returns {Record<string, string>}
 */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > -1) {
        out[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith("--")) {
          out[a.slice(2)] = next;
          i++;
        } else {
          out[a.slice(2)] = "true";
        }
      }
    }
  }
  return out;
}
