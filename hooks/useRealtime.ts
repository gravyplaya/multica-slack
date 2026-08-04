"use client";

/**
 * React glue between the WebSocketManager and the React Query cache.
 *
 * Responsibilities:
 *
 * 1. Mount a single `WebSocketManager` per session + workspace pair
 *    and tear it down on unmount. The instance is held in a ref so
 *    re-renders do not re-create the socket.
 * 2. Subscribe to validated events and feed each one through
 *    `applyRealtimeEvent`. Listener cleanup runs in the effect
 *    teardown.
 * 3. Publish the connection status into a tiny Zustand store so
 *    any component (sidebar, header, message list) can render the
 *    subtle indicator without prop-drilling the manager.
 * 4. Honour the session: when the user signs out, the manager is
 *    closed and the status is reset to `closed`. The next sign-in
 *    builds a fresh manager.
 */

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { WS_URL } from "../lib/api/config";
import { credentialFingerprint } from "../lib/api/redact";
import type { SessionState, WorkspaceSelection } from "../lib/types";
import { applyRealtimeEvent, type CacheContext } from "../lib/realtime/query-updaters";
import {
  WebSocketManager,
} from "../lib/realtime/websocket-manager";
import {
  setRealtimeStatus,
  useRealtimeStatusFromStore,
} from "../lib/realtime/realtime-store";
import type { ConnectionStatus } from "../lib/realtime/websocket-manager";

export interface UseRealtimeParams {
  session: SessionState | null;
  workspace: WorkspaceSelection | null;
  /**
   * Inject for tests; defaults to the global `WebSocket` constructor.
   * The shape mirrors the manager's `socketFactory` config option.
   */
  socketFactory?: import("../lib/realtime/websocket-manager").SocketFactory;
}

export function useRealtime(params: UseRealtimeParams): void {
  const { session, workspace } = params;
  const queryClient = useQueryClient();
  const managerRef = useRef<WebSocketManager | null>(null);

  useEffect(() => {
    // No session = nothing to connect. Tear down any lingering
    // manager and reset the status so the UI does not display a
    // stale "connected" badge.
    if (!session || !workspace) {
      managerRef.current?.disconnect();
      managerRef.current = null;
      setRealtimeStatus("idle");
      return;
    }

    const sessionKey = credentialFingerprint(session.token);
    const ctx: CacheContext = {
      workspaceId: workspace.workspaceId,
      backendOrigin: session.backendOrigin,
      sessionKey,
    };

    const manager = new WebSocketManager({
      url: WS_URL,
      token: session.token,
      workspace: {
        workspaceId: workspace.workspaceId,
        workspaceSlug: workspace.workspaceSlug,
      },
      ...(params.socketFactory ? { socketFactory: params.socketFactory } : {}),
    });
    managerRef.current = manager;

    const unsubscribeEvents = manager.subscribe((event) => {
      applyRealtimeEvent(queryClient, ctx, event);
    });
    const unsubscribeStatus = manager.subscribeStatus((status) => {
      setRealtimeStatus(status);
    });

    manager.connect();

    return () => {
      unsubscribeEvents();
      unsubscribeStatus();
      manager.disconnect();
      if (managerRef.current === manager) {
        managerRef.current = null;
      }
    };
  }, [params.socketFactory, queryClient, session, workspace]);
}

/**
 * Read the current realtime status from the realtime store. Kept
 * as a separate hook so components that do not need the manager
 * itself can still render the indicator.
 */
export function useRealtimeStatus(): ConnectionStatus {
  return useRealtimeStatusFromStore();
}
