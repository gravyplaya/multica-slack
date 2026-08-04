"use client";

/**
 * Subtle realtime connection indicator.
 *
 * The Stage 4 gate calls for a "subtle connection indicator and a
 * recoverable stale-data state that does not block already loaded
 * content." This component is the indicator.
 *
 * Visual contract:
 *
 * - A small dot (8px) at the top-right of the channel header.
 * - Green for `connected`.
 * - Amber, gently pulsing, for `connecting` / `reconnecting`.
 * - Red, static, for `failed`.
 * - Hidden (visibility: hidden, still in the layout to avoid
 *   reflow) for `idle` / `closed` — these are intentional
 *   terminal states the user already knows about (signed out,
 *   initial mount).
 *
 * We never erase loaded content: the indicator is purely
 * informative. A "reconnecting" badge does not clear the message
 * list.
 */

import { useRealtimeStatus } from "../../hooks/useRealtime";
import type { ConnectionStatus } from "../../lib/realtime/events-types";

type VisibleConnectionStatus = Exclude<ConnectionStatus, "idle" | "closed">;

const STATUS_LABEL: Record<VisibleConnectionStatus, string> = {
  connecting: "Connecting…",
  connected: "Live",
  reconnecting: "Reconnecting…",
  failed: "Realtime offline",
};

export function ConnectionIndicator() {
  const status = useRealtimeStatus();
  if (status === "idle" || status === "closed") {
    return (
      <span
        className="connection-indicator"
        data-status={status}
        aria-hidden="true"
      />
    );
  }
  const label = STATUS_LABEL[status];
  return (
    <span
      className="connection-indicator"
      data-status={status}
      role="status"
      aria-live="polite"
      title={label}
    >
      <span className="connection-dot" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
