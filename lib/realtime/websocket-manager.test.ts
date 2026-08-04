/**
 * Tests for the WebSocketManager.
 *
 * The manager is the Stage 4 lifecycle owner. These tests drive
 * the boundary with a fake `SocketLike` so we can assert on
 * connection-state transitions, message routing, malformed-frame
 * handling, reconnect schedule, and intentional disconnect.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WebSocketManager,
  type ConnectionStatus,
  type SocketFactory,
  type SocketLike,
} from "./websocket-manager";
import type { RealtimeEvent } from "./events-types";

class FakeSocket implements SocketLike {
  readyState = 0; // CONNECTING
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  sent: string[] = [];
  closeArgs: { code?: number; reason?: string } | null = null;
  emitOpen() {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
  emitMessage(data: string) {
    this.onmessage?.(new MessageEvent("message", { data }));
  }
  emitClose(code = 1006, reason = "abnormal") {
    this.readyState = 3;
    // The manager reads only `code` + `reason` off the close event,
    // so a plain object is enough — no need to depend on the
    // browser-only `CloseEvent` constructor.
    this.onclose?.({ code, reason } as unknown as CloseEvent);
  }
  emitError() {
    this.onerror?.(new Event("error"));
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(code?: number, reason?: string): void {
    this.closeArgs = { code, reason };
    if (this.readyState < 2) {
      this.readyState = 2;
      // The browser does not fire a synthetic close; tests call
      // `emitClose` separately so they can drive the close code.
    }
  }
}

interface Harness {
  sockets: FakeSocket[];
  factory: SocketFactory;
  timers: Map<number, { at: number; cb: () => void }>;
  nextId: { value: number };
  now: { value: number };
  advance(ms: number): void;
}

function makeHarness(): Harness {
  const sockets: FakeSocket[] = [];
  const factory: SocketFactory = () => {
    const s = new FakeSocket();
    sockets.push(s);
    return s;
  };
  const timers = new Map<number, { at: number; cb: () => void }>();
  const now = { value: 0 };
  const nextId = { value: 1 };
  return {
    sockets,
    factory,
    timers,
    nextId,
    now,
    advance(ms: number) {
      now.value += ms;
      const due = [...timers.values()].filter((t) => t.at <= now.value);
      for (const t of due) {
        for (const [id, entry] of timers) {
          if (entry === t) timers.delete(id);
        }
        t.cb();
      }
    },
  };
}

const TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature";

function makeManager(harness: Harness, overrides: Record<string, unknown> = {}) {
  const setTimeoutImpl = (cb: () => void, ms: number) => {
    const id = harness.nextId.value++;
    const handle = { at: harness.now.value + ms, cb };
    harness.timers.set(id, handle);
    return id;
  };
  const clearTimeoutImpl = ((handle: unknown) => {
    for (const [id, entry] of harness.timers) {
      if (entry === handle) harness.timers.delete(id);
    }
  }) as unknown as (handle: unknown) => void;
  return new WebSocketManager({
    url: "ws://example.test/ws",
    token: TOKEN,
    workspace: { workspaceId: "ws-1", workspaceSlug: "acme" },
    socketFactory: harness.factory,
    setTimeoutImpl,
    clearTimeoutImpl,
    reconnect: {
      initialDelayMs: 10,
      maxDelayMs: 100,
      factor: 2,
      jitter: 0,
      maxAttempts: 3,
    },
    ...overrides,
  });
}

describe("WebSocketManager", () => {
  let harness: Harness;
  beforeEach(() => {
    harness = makeHarness();
  });
  afterEach(() => {
    harness.sockets.forEach((s) => {
      // Drain any pending handlers.
      s.onopen = null;
      s.onmessage = null;
      s.onclose = null;
      s.onerror = null;
    });
  });

  it("dials the configured URL and sends an auth frame on open", () => {
    const mgr = makeManager(harness);
    mgr.connect();
    expect(harness.sockets).toHaveLength(1);
    const sock = harness.sockets[0]!;
    sock.emitOpen();
    expect(sock.sent).toEqual([
      JSON.stringify({ type: "auth", payload: { token: TOKEN } }),
    ]);
  });

  it("skips the auth frame for a cookie session (token: null) and connects on open", () => {
    const mgr = makeManager(harness, { token: null });
    mgr.connect();
    const sock = harness.sockets[0]!;
    sock.emitOpen();
    expect(sock.sent).toEqual([]);
    expect(mgr.getStatus()).toBe("connected");
  });

  it("transitions to connected on auth_ack and surfaces status changes", () => {
    const mgr = makeManager(harness);
    const transitions: Array<[ConnectionStatus, string]> = [];
    mgr.subscribeStatus((s, r) => transitions.push([s, r.reason]));
    mgr.connect();
    const sock = harness.sockets[0]!;
    sock.emitOpen();
    sock.emitMessage(JSON.stringify({ type: "auth_ack", payload: {} }));
    expect(mgr.getStatus()).toBe("connected");
    expect(transitions[transitions.length - 1]?.[0]).toBe("connected");
  });

  it("drops malformed JSON frames without throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const mgr = makeManager(harness);
    const events: RealtimeEvent[] = [];
    mgr.subscribe((e) => events.push(e));
    mgr.connect();
    const sock = harness.sockets[0]!;
    sock.emitOpen();
    sock.emitMessage("not json");
    expect(events).toEqual([]);
    expect(mgr.getStatus()).toBe("connecting");
    warn.mockRestore();
  });

  it("drops frames whose payload is not an object", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const mgr = makeManager(harness);
    const events: RealtimeEvent[] = [];
    mgr.subscribe((e) => events.push(e));
    mgr.connect();
    const sock = harness.sockets[0]!;
    sock.emitOpen();
    sock.emitMessage(JSON.stringify({ type: "issue:created", payload: "oops" }));
    expect(events).toEqual([]);
    warn.mockRestore();
  });

  it("drops frames with an unknown type and logs the type for diagnostics", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const mgr = makeManager(harness);
    const events: RealtimeEvent[] = [];
    mgr.subscribe((e) => events.push(e));
    mgr.connect();
    const sock = harness.sockets[0]!;
    sock.emitOpen();
    sock.emitMessage(
      JSON.stringify({ type: "future:event", payload: { something: true } }),
    );
    expect(events).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("future:event"));
    warn.mockRestore();
  });

  it("delivers validated events and isolates listener errors", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const mgr = makeManager(harness);
    const good: RealtimeEvent[] = [];
    mgr.subscribe((e) => good.push(e));
    mgr.subscribe(() => {
      throw new Error("listener boom");
    });
    mgr.connect();
    const sock = harness.sockets[0]!;
    sock.emitOpen();
    sock.emitMessage(
      JSON.stringify({
        type: "issue:created",
        payload: {
          issue: {
            id: "33333333-3333-4333-8333-333333333333",
            workspace_id: "22222222-2222-4222-8222-222222222222",
            number: 1,
            identifier: "ACME-1",
            title: "test",
            status: "todo",
            priority: "none",
            creator_type: "member",
            creator_id: "11111111-1111-4111-8111-111111111111",
            assignee_type: null,
            assignee_id: null,
            parent_issue_id: null,
            project_id: null,
            position: 0,
            stage: null,
            start_date: null,
            due_date: null,
            created_at: "2026-08-04T12:00:00Z",
            updated_at: "2026-08-04T12:00:00Z",
            metadata: {},
          },
        },
      }),
    );
    expect(good).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("unsubscribe stops the listener from receiving further events", () => {
    const mgr = makeManager(harness);
    const events: RealtimeEvent[] = [];
    const off = mgr.subscribe((e) => events.push(e));
    off();
    mgr.connect();
    const sock = harness.sockets[0]!;
    sock.emitOpen();
    sock.emitMessage(JSON.stringify({ type: "auth_ack", payload: {} }));
    sock.emitMessage(
      JSON.stringify({
        type: "issue:deleted",
        payload: { issue_id: "44444444-4444-4444-8444-444444444444" },
      }),
    );
    expect(events).toEqual([]);
  });

  it("reconnects on unclean close with bounded exponential backoff and stops after maxAttempts", () => {
    const mgr = makeManager(harness);
    mgr.connect();
    const initial = harness.sockets[0]!;
    initial.emitOpen();
    initial.emitMessage(JSON.stringify({ type: "auth_ack", payload: {} }));
    initial.emitClose();
    // Reconnect #1 fires after `initialDelayMs` (10ms here).
    expect(mgr.getStatus()).toBe("reconnecting");
    harness.advance(10);
    expect(harness.sockets).toHaveLength(2);
    // Fail reconnect #1; backoff doubles to 20ms.
    harness.sockets[1]!.emitClose();
    harness.advance(20);
    expect(harness.sockets).toHaveLength(3);
    // Fail reconnect #2; backoff doubles to 40ms.
    harness.sockets[2]!.emitClose();
    harness.advance(40);
    // Reconnect #3 fires — the third reconnect is the last
    // permitted attempt.
    expect(harness.sockets).toHaveLength(4);
    // Fail the final reconnect; the budget is exhausted.
    harness.sockets[3]!.emitClose();
    harness.advance(80);
    // No 5th attempt — maxAttempts = 3 has been exhausted.
    expect(harness.sockets).toHaveLength(4);
    expect(mgr.getStatus()).toBe("failed");
  });

  it("does not reconnect after an intentional disconnect", () => {
    const mgr = makeManager(harness);
    mgr.connect();
    const sock = harness.sockets[0]!;
    sock.emitOpen();
    sock.emitMessage(JSON.stringify({ type: "auth_ack", payload: {} }));
    mgr.disconnect();
    expect(mgr.getStatus()).toBe("closed");
    harness.advance(10_000);
    expect(harness.sockets).toHaveLength(1);
  });

  it("treats an unauthenticated close (no auth_ack yet) as a transient error", () => {
    const mgr = makeManager(harness);
    mgr.connect();
    const sock = harness.sockets[0]!;
    sock.emitOpen();
    // The server closes before sending auth_ack.
    sock.emitClose();
    expect(mgr.getStatus()).toBe("reconnecting");
    harness.advance(10);
    expect(harness.sockets).toHaveLength(2);
  });

  it("surfaces failed status on auth_error and never reconnects", () => {
    const mgr = makeManager(harness);
    const events: Array<[ConnectionStatus, string]> = [];
    mgr.subscribeStatus((s, r) => events.push([s, r.reason]));
    mgr.connect();
    const sock = harness.sockets[0]!;
    sock.emitOpen();
    sock.emitMessage(
      JSON.stringify({ type: "auth_error", payload: { error: "token expired" } }),
    );
    expect(mgr.getStatus()).toBe("failed");
    expect(events[events.length - 1]?.[1]).toBe("token expired");
    // The manager gives up — no reconnect after auth_error.
    harness.advance(10_000);
    expect(harness.sockets).toHaveLength(1);
  });

  it("scrubs credentials out of the auth_error reason before publishing", () => {
    const mgr = makeManager(harness);
    mgr.connect();
    const sock = harness.sockets[0]!;
    sock.emitOpen();
    sock.emitMessage(
      JSON.stringify({
        type: "auth_error",
        // The server (in a hypothetical regression) might echo the
        // token; the manager MUST scrub it.
        payload: { error: `bad token: ${TOKEN}` },
      }),
    );
    expect(mgr.getStatus()).toBe("failed");
    const internal = mgr as unknown as { lastReason: { reason: string } };
    expect(internal.lastReason.reason).not.toContain(TOKEN);
  });

  it("emits a transient reconnecting status on socket error before close", () => {
    const mgr = makeManager(harness);
    mgr.connect();
    const sock = harness.sockets[0]!;
    sock.emitOpen();
    sock.emitMessage(JSON.stringify({ type: "auth_ack", payload: {} }));
    expect(mgr.getStatus()).toBe("connected");
    sock.emitError();
    expect(mgr.getStatus()).toBe("reconnecting");
  });

  it("treats a factory throw as unrecoverable", () => {
    const factory: SocketFactory = () => {
      throw new Error("factory boom");
    };
    const mgr = new WebSocketManager({
      url: "ws://example.test/ws",
      token: TOKEN,
      workspace: null,
      socketFactory: factory,
      reconnect: { initialDelayMs: 1, maxDelayMs: 1, factor: 1, jitter: 0, maxAttempts: 5 },
    });
    mgr.connect();
    expect(mgr.getStatus()).toBe("failed");
  });

  it("destroy() closes the socket and suppresses reconnect", () => {
    const mgr = makeManager(harness);
    mgr.connect();
    const sock = harness.sockets[0]!;
    sock.emitOpen();
    sock.emitMessage(JSON.stringify({ type: "auth_ack", payload: {} }));
    mgr.destroy();
    expect(mgr.getStatus()).toBe("closed");
    harness.advance(10_000);
    expect(harness.sockets).toHaveLength(1);
  });

  it("forwards the workspace_id and workspace_slug query params on the URL", () => {
    const factoryCalls: string[] = [];
    const factory: SocketFactory = (url) => {
      factoryCalls.push(url);
      return new FakeSocket();
    };
    const mgr = new WebSocketManager({
      url: "ws://example.test/ws",
      token: TOKEN,
      workspace: { workspaceId: "ws-uuid", workspaceSlug: "acme-slug" },
      socketFactory: factory,
      reconnect: { initialDelayMs: 1, maxDelayMs: 1, factor: 1, jitter: 0, maxAttempts: 1 },
    });
    mgr.connect();
    expect(factoryCalls[0]).toContain("workspace_id=ws-uuid");
    expect(factoryCalls[0]).toContain("workspace_slug=acme-slug");
  });

  it("a second connect() while already connected is a no-op", () => {
    const mgr = makeManager(harness);
    mgr.connect();
    mgr.connect();
    expect(harness.sockets).toHaveLength(1);
  });
});
