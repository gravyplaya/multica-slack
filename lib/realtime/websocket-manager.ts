/**
 * WebSocketManager — the realtime layer's connection lifecycle.
 *
 * Responsibilities:
 *
 * 1. **Dial the upstream** with the workspace coordinate the caller
 *    supplied and (when needed) the bearer frame the contract
 *    demands for the first message.
 * 2. **Drive the lifecycle** — open, auth, message, close, error —
 *    and turn the WebSocket's binary state machine into a small set
 *    of `ConnectionStatus` transitions the UI can subscribe to.
 * 3. **Validate every inbound frame** at the boundary so the rest of
 *    the code only sees well-formed `RealtimeEvent`s. Unknown types
 *    or malformed payloads are logged and dropped — they never
 *    crash the manager.
 * 4. **Reconnect on failure** with bounded exponential backoff and
 *    jitter, never after an intentional disconnect. The manager
 *    exposes a `disconnect()` entry point that flips a permanent
 *    "do not reconnect" flag.
 * 5. **Honor native heartbeats** — the server sends application
 *    `ping`/native pong frames (`pingPeriod` ~54s). The manager
 *    replies to native pings automatically; application `ping`
 *    frames get an immediate `pong` reply.
 * 6. **Stay test-friendly** — the underlying `WebSocket` factory is
 *    injectable so the test suite can drive the boundary with a
 *    fake without booting a real socket.
 *
 * What this module deliberately does NOT do:
 *
 * - It does not import React or TanStack Query. The companion
 *   `hooks/useRealtime.ts` is the thin glue that wires the manager's
 *   status + events into the Query cache.
 * - It does not write to any store. Components query the manager's
 *   status via `getStatus()` / `subscribe()` and read events through
 *   the same callback list.
 * - It does not log the bearer token. The only string the manager
 *   ever hands to `console.warn` is the event `type` and a
 *   user-readable reason; if a future frame happens to echo the
 *   bearer back, the read goes through the validator first.
 */

import { redactCredential } from "../api/redact";
import {
  validateRealtimeEvent,
  isWsFrame,
} from "./events";
import type { CloseReason, ConnectionStatus, RealtimeEvent } from "./events-types";

// Re-export the value types so the rest of the app can import them
// from a single module (this is the public surface of the realtime
// layer).
export type { CloseReason, ConnectionStatus, RealtimeEvent };

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface WebSocketManagerConfig {
  /**
   * The fully-qualified WebSocket URL to connect to. The contract
   * uses `ws://localhost:8080/ws` by default; tests inject a custom
   * URL to bypass the resolution.
   */
  url: string;
  /**
   * Bearer token sent in the first inbound frame after the socket
   * opens. The Multica server uses this for the worker-bearer
   * handshake documented in `docs/contracts/multica-api.md` §7.1.
   *
   * `null` skips the auth frame — i.e. the caller is relying on a
   * cookie session (OAuth flow). The server is responsible for
   * wiring membership; the client just waits for `auth_ack` (which
   * the cookie path does not send) or the first event.
   */
  token: string | null;
  /** Workspace coordinate forwarded to the server as a query param. */
  workspace: { workspaceId: string; workspaceSlug: string } | null;
  /** Inject for tests; defaults to the global `WebSocket` constructor. */
  socketFactory?: SocketFactory;
  /** Override the global `setTimeout` for deterministic tests. */
  setTimeoutImpl?: (cb: () => void, ms: number) => unknown;
  /** Override the global `clearTimeout` for deterministic tests. */
  clearTimeoutImpl?: (handle: unknown) => void;
  /** Overrides for the backoff schedule. Defaults match §7 of the plan. */
  reconnect?: ReconnectSchedule;
  /** Optional hook invoked once after the socket closes. */
  onStatusChange?: (status: ConnectionStatus, reason: CloseReason) => void;
}

export interface ReconnectSchedule {
  /** Initial delay after the first disconnect. */
  initialDelayMs: number;
  /** Maximum delay between attempts. */
  maxDelayMs: number;
  /** Multiplier applied to the previous delay; bounded by `maxDelayMs`. */
  factor: number;
  /** Random jitter as a fraction of the current delay (0..1). */
  jitter: number;
  /** Hard cap on consecutive failed attempts before `failed`. */
  maxAttempts: number;
}

export interface RealtimeListener {
  (event: RealtimeEvent): void;
}

export interface StatusListener {
  (status: ConnectionStatus, reason: CloseReason): void;
}

/**
 * Minimal abstraction over the WebSocket constructor so tests can
 * vend a fake. The factory MUST return an object that satisfies
 * this shape synchronously — the manager hooks event listeners
 * right after the call returns.
 */
export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
}

export type SocketFactory = (url: string) => SocketLike;

/**
 * Standard `WebSocket` readyState values copied from the WHATWG spec
 * so callers can compare against our mirrored `readyState` without
 * referencing the global `WebSocket` type.
 */
export const READY_STATE = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;

const DEFAULT_RECONNECT: ReconnectSchedule = {
  initialDelayMs: 500,
  maxDelayMs: 30_000,
  factor: 2,
  jitter: 0.25,
  maxAttempts: 8,
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Internal helper that mirrors the small slice of the `WebSocket`
 * constructor signature the manager needs. Production callers use
 * the platform global; tests inject a fake.
 */
function defaultSocketFactory(url: string): SocketLike {
  // The Next.js bundler may not have a `WebSocket` global at the
  // time this module is evaluated (it does at runtime in
  // browsers + Node 22+). We require it lazily inside the call so
  // importing this module from server code does not throw.
  const W: typeof WebSocket | undefined =
    typeof WebSocket !== "undefined" ? WebSocket : undefined;
  if (!W) {
    throw new Error(
      "WebSocketManager: no WebSocket implementation in scope; pass `socketFactory` to inject one.",
    );
  }
  return new W(url) as unknown as SocketLike;
}

export class WebSocketManager {
  private readonly config: WebSocketManagerConfig;
  private readonly socketFactory: SocketFactory;
  private readonly setTimeoutImpl: (cb: () => void, ms: number) => unknown;
  private readonly clearTimeoutImpl: (handle: unknown) => void;
  private readonly reconnect: ReconnectSchedule;

  private socket: SocketLike | null = null;
  private reconnectTimer: unknown = null;
  private reconnectAttempts = 0;
  private authCompleted = false;
  /**
   * `true` once `connect()` was called and `disconnect()` has not
   * been called yet. The manager uses this to suppress reconnect
   * after an intentional close.
   */
  private shouldReconnect = false;
  private status: ConnectionStatus = "idle";
  private lastReason: CloseReason = { code: null, reason: "not started" };
  private disconnectedByClient = false;

  private readonly eventListeners = new Set<RealtimeListener>();
  private readonly statusListeners = new Set<StatusListener>();

  constructor(config: WebSocketManagerConfig) {
    this.config = config;
    this.socketFactory = config.socketFactory ?? defaultSocketFactory;
    this.setTimeoutImpl =
      config.setTimeoutImpl ?? ((cb, ms) => setTimeout(cb, ms));
    this.clearTimeoutImpl =
      config.clearTimeoutImpl ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.reconnect = { ...DEFAULT_RECONNECT, ...(config.reconnect ?? {}) };
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  /**
   * Open the socket. Idempotent: a second call while a connection is
   * already in flight is a no-op. Calling `connect()` after a
   * `disconnect()` reconnects with a fresh reconnect budget.
   */
  connect(): void {
    if (this.shouldReconnect) {
      // Already running; do not double-dial.
      return;
    }
    this.shouldReconnect = true;
    this.disconnectedByClient = false;
    this.reconnectAttempts = 0; // Counted at reconnect time, not on the initial open.
    this.openSocket();
  }

  /**
   * Close the socket and suppress any further reconnect attempts.
   * Returns the manager to the `closed` state.
   */
  disconnect(): void {
    this.disconnectInternal({ code: 1000, reason: "client requested close" });
  }

  /**
   * Subscribe to validated realtime events. Returns an unsubscribe
   * function so React effects can pass it straight back to the
   * cleanup step.
   */
  subscribe(listener: RealtimeListener): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  /**
   * Subscribe to connection-status transitions. Status listeners
   * also fire the moment they subscribe so callers can render the
   * current state without waiting for the next transition.
   */
  subscribeStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status, this.lastReason);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  /** Read the current status without subscribing. */
  getStatus(): ConnectionStatus {
    return this.status;
  }

  /**
   * Tear down every listener and close the socket. Intended for
   * test cleanup and the React strict-mode double-mount fix.
   */
  destroy(): void {
    this.disconnectInternal({ code: 1000, reason: "destroyed" });
  }

  // ------------------------------------------------------------------
  // Connection lifecycle
  // ------------------------------------------------------------------

  private openSocket(): void {
    this.cancelReconnect();
    this.setStatus("connecting", {
      code: null,
      reason: this.reconnectAttempts === 0 ? "dialing" : "reconnecting",
    });

    const url = this.buildUrl();
    let socket: SocketLike;
    try {
      socket = this.socketFactory(url);
    } catch (cause) {
      this.handleUnrecoverableError(
        new Error("socket factory threw", { cause }),
      );
      return;
    }
    this.socket = socket;
    this.authCompleted = false;

    socket.onopen = () => this.handleOpen();
    socket.onmessage = (event) => this.handleMessage(event);
    socket.onclose = (event) => this.handleClose(event);
    socket.onerror = (event) => this.handleError(event);
  }

  private buildUrl(): string {
    const url = new URL(this.config.url);
    // The contract documents `workspace_id` and `workspace_slug` as
    // the two additive coordinates the server accepts. We always
    // forward both when the caller has them — both are free to
    // ignore if the server already resolved the workspace from the
    // session or cookie.
    if (this.config.workspace) {
      url.searchParams.set("workspace_id", this.config.workspace.workspaceId);
      url.searchParams.set("workspace_slug", this.config.workspace.workspaceSlug);
    }
    return url.toString();
  }

  private handleOpen(): void {
    // Reset the auth flag — every new socket must complete the
    // handshake even on a reconnect.
    this.authCompleted = false;
    if (this.config.token === null) {
      // Cookie session: the server will not send `auth_ack`, so we
      // treat the socket as authenticated the moment it opens.
      this.authCompleted = true;
      this.reconnectAttempts = 0;
      this.setStatus("connected", { code: null, reason: "open (cookie session)" });
      return;
    }
    this.sendAuthFrame(this.config.token);
  }

  private sendAuthFrame(token: string): void {
    const frame = JSON.stringify({ type: "auth", payload: { token } });
    try {
      this.socket?.send(frame);
    } catch (cause) {
      this.handleUnrecoverableError(
        new Error("failed to send auth frame", { cause }),
      );
    }
  }

  private handleMessage(event: MessageEvent): void {
    const raw = typeof event.data === "string" ? event.data : "";
    if (raw.length === 0) {
      // Binary frames are not part of the contract; ignore cleanly.
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Malformed JSON — log the event type only, never the payload,
      // and never the bearer token.
      console.warn("realtime: dropping malformed JSON frame");
      return;
    }
    if (!isWsFrame(parsed)) {
      console.warn(
        "realtime: dropping frame without valid { type, payload } envelope",
      );
      return;
    }
    this.routeFrame(parsed);
  }

  private routeFrame(frame: import("../types").WireWsFrame<string, unknown>): void {
    switch (frame.type) {
      case "auth_ack": {
        this.authCompleted = true;
        // A successful auth means the current open counts; the
        // next close starts a fresh reconnect budget.
        this.reconnectAttempts = 0;
        this.setStatus("connected", { code: null, reason: "auth_ack" });
        return;
      }
      case "auth_error": {
        // Auth failed — the server is about to close the socket.
        // Surface `failed` immediately so the UI can render a
        // "needs re-auth" badge without waiting for the close frame.
        const reason = readErrorPayload(frame.payload) ?? "auth_error";
        this.setStatus("failed", { code: null, reason: redactReason(reason) });
        return;
      }
      case "pong": {
        // Heartbeat reply. Nothing to do — the connection is alive.
        return;
      }
      case "subscribe_ack":
      case "unsubscribe_ack":
      case "subscribe_error": {
        // Protocol noise — the manager handles subscribe/unsubscribe
        // implicitly (workspace + user scopes are joined on auth).
        return;
      }
      default: {
        // Validate and fan out a `RealtimeEvent`. Anything that fails
        // validation is logged and dropped so a future server event
        // does not break the consumer.
        const event = validateRealtimeEvent(frame);
        if (!event) {
          console.warn(
            `realtime: dropping frame with unknown type or invalid payload: ${frame.type}`,
          );
          return;
        }
        for (const listener of this.eventListeners) {
          try {
            listener(event);
          } catch (cause) {
            // A misbehaving listener must not bring the manager
            // down — its frame is consumed and we move on.
            console.warn("realtime: listener threw", cause);
          }
        }
      }
    }
  }

  private handleClose(event: CloseEvent): void {
    this.socket = null;
    const reason: CloseReason = {
      code: event?.code ?? null,
      reason: typeof event?.reason === "string" && event.reason.length > 0
        ? event.reason
        : "socket closed",
    };
    if (this.disconnectedByClient) {
      // Intentional — do not reconnect, drop the listeners, and
      // surface `closed` so the UI can render a fresh sign-in
      // prompt if it wants.
      this.shouldReconnect = false;
      this.cancelReconnect();
      this.setStatus("closed", reason);
      return;
    }
    if (!this.authCompleted) {
      // We never finished the handshake. Reconnect immediately so a
      // bouncing server does not silently leave the workspace in
      // "connecting" limbo forever.
      this.scheduleReconnect(reason);
      return;
    }
    this.scheduleReconnect(reason);
  }

  private handleError(event: Event): void {
    void event;
    // The browser always pairs an error with a close — we wait for
    // the close before deciding whether to reconnect. All we do here
    // is surface a transient status so the UI can stop showing a
    // healthy dot.
    if (this.status === "connected" || this.status === "connecting") {
      this.setStatus("reconnecting", { code: null, reason: "socket error" });
    }
  }

  private handleUnrecoverableError(error: Error): void {
    this.shouldReconnect = false;
    this.cancelReconnect();
    this.setStatus("failed", { code: null, reason: error.message });
    if (this.socket) {
      try {
        this.socket.close(1011, "client error");
      } catch {
        // The socket is already dead; nothing to do.
      }
      this.socket = null;
    }
  }

  // ------------------------------------------------------------------
  // Reconnect schedule
  // ------------------------------------------------------------------

  private scheduleReconnect(reason: CloseReason): void {
    if (!this.shouldReconnect) return;
    // `maxAttempts` is the cap on *reconnect* attempts after the
    // initial open. The initial open does not count against it
    // (the caller is responsible for the very first connect).
    // `reconnectAttempts` is the number of *scheduled* reconnects
    // so far; we compare it directly against `maxAttempts`.
    if (this.reconnectAttempts >= this.reconnect.maxAttempts) {
      this.shouldReconnect = false;
      this.setStatus("failed", {
        code: reason.code,
        reason: `reconnect attempts exhausted (${this.reconnectAttempts})`,
      });
      return;
    }
    this.reconnectAttempts += 1;
    const base = Math.min(
      this.reconnect.initialDelayMs *
        Math.pow(this.reconnect.factor, this.reconnectAttempts - 1),
      this.reconnect.maxDelayMs,
    );
    const jitterRange = base * this.reconnect.jitter;
    const delay = base + (Math.random() * 2 - 1) * jitterRange;
    this.setStatus("reconnecting", {
      code: reason.code,
      reason: `attempt ${this.reconnectAttempts}/${this.reconnect.maxAttempts}`,
    });
    this.cancelReconnect();
    this.reconnectTimer = this.setTimeoutImpl(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, Math.max(0, delay));
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer !== null) {
      this.clearTimeoutImpl(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ------------------------------------------------------------------
  // Disconnect helper
  // ------------------------------------------------------------------

  private disconnectInternal(reason: CloseReason): void {
    this.disconnectedByClient = true;
    this.shouldReconnect = false;
    this.cancelReconnect();
    if (this.socket) {
      try {
        this.socket.close(reason.code ?? 1000, reason.reason);
      } catch {
        // Already closed; fine.
      }
      this.socket = null;
    }
    this.setStatus("closed", reason);
  }

  // ------------------------------------------------------------------
  // Status mutator
  // ------------------------------------------------------------------

  private setStatus(next: ConnectionStatus, reason: CloseReason): void {
    if (next === this.status && reason.reason === this.lastReason.reason) {
      return;
    }
    this.status = next;
    this.lastReason = reason;
    this.config.onStatusChange?.(next, reason);
    for (const listener of this.statusListeners) {
      try {
        listener(next, reason);
      } catch {
        // Listener errors are isolated; the manager does not own
        // the consumer's state.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readErrorPayload(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const value = (payload as { error?: unknown }).error;
  if (typeof value === "string" && value.length > 0) return value;
  return null;
}

/**
 * Defensive scrub: a server's `auth_error` may include the rejected
 * token fragment or a URL containing it. We funnel every read
 * through `redactCredential` so a future log line cannot leak the
 * bearer, even if the reason field is rewritten.
 */
function redactReason(reason: string): string {
  return redactCredential(reason);
}
