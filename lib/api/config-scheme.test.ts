/**
 * Unit tests for the `ws://` → `wss://` scheme coercion in `config.ts`.
 *
 * The guard exists to stop a common deployment misconfiguration — an
 * `https://` REST origin paired with a plaintext `ws://` WebSocket URL —
 * from reaching the browser, where it would fail as a mixed-content
 * block or a silent downgrade. Local self-host keeps `http://` + `ws://`.
 */

import { describe, expect, it } from "vitest";

import { upgradeWsScheme } from "./config";

describe("upgradeWsScheme", () => {
  it("promotes ws:// to wss:// when the REST base is https://", () => {
    expect(
      upgradeWsScheme("https://api.multica.ai", "ws://api.multica.ai/ws"),
    ).toBe("wss://api.multica.ai/ws");
  });

  it("leaves an already-secure wss:// URL untouched", () => {
    expect(
      upgradeWsScheme("https://api.multica.ai", "wss://api.multica.ai/ws"),
    ).toBe("wss://api.multica.ai/ws");
  });

  it("leaves ws:// untouched when the REST base is http:// (local self-host)", () => {
    expect(
      upgradeWsScheme("http://localhost:8080", "ws://localhost:8080/ws"),
    ).toBe("ws://localhost:8080/ws");
  });

  it("leaves wss:// untouched when the REST base is http:// (defensive)", () => {
    expect(
      upgradeWsScheme("http://localhost:8080", "wss://localhost:8080/ws"),
    ).toBe("wss://localhost:8080/ws");
  });

  it("preserves query strings and paths through the upgrade", () => {
    expect(
      upgradeWsScheme(
        "https://api.multica.ai",
        "ws://api.multica.ai/ws?workspace_id=abc",
      ),
    ).toBe("wss://api.multica.ai/ws?workspace_id=abc");
  });

  it("is a no-op for a non-ws scheme", () => {
    expect(upgradeWsScheme("https://api.multica.ai", "http://api.multica.ai/ws")).toBe(
      "http://api.multica.ai/ws",
    );
  });
});
