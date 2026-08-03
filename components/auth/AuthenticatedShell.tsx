"use client";

/**
 * Authenticated shell placeholder.
 *
 * Stage 2 owns the data + session foundation; Stage 3 owns the
 * real workspace/sidebar/channel layout. This component proves
 * the gate by:
 *
 * - reading the session through `useSession()` (which subscribes
 *   to the SessionStore mounted by `<Providers>`);
 * - fetching the workspace list via the live MulticaClient to
 *   confirm the credential round-trip;
 * - showing a workspace picker that feeds `setWorkspace` on the
 *   client so the second round of calls (members/issues) include
 *   the right `X-Workspace-Slug` header;
 * - showing the currently authenticated user and a sign-out
 *   button that clears the SessionStore (and the localStorage
 *   entry on the API-key path) plus resets the view store.
 *
 * All credential handling stays in the session layer. The shell
 * itself reads only the fingerprint, not the raw token.
 */

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { signOutAndClearApiKey } from "../../lib/auth/api-key";
import { useSession, useSessionStore } from "../../lib/auth/use-session";
import { useMulticaClient } from "../../hooks/use-multica-client";
import { useViewStore } from "../../lib/stores/use-view-store";
import type { WorkspaceSelection } from "../../lib/types";

export function AuthenticatedShell() {
  const session = useSession();
  const store = useSessionStore();
  const client = useMulticaClient();
  const resetForSignOut = useViewStore((s) => s.resetForSignOut);
  const [workspace, setWorkspace] = useState<WorkspaceSelection | null>(null);

  const workspacesQuery = useQuery({
    queryKey: ["workspaces", session?.backendOrigin ?? ""],
    // `useMulticaClient` always returns a `MulticaClient` now; the
    // gate is on the session alone.
    queryFn: () => client.listWorkspaces(),
    enabled: Boolean(session),
  });

  function handleSignOut() {
    signOutAndClearApiKey(store);
    resetForSignOut();
  }

  if (!session) return null;

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        background: "var(--color-canvas)",
      }}
    >
      <aside
        style={{
          width: 280,
          borderRight: "1px solid var(--color-border)",
          padding: 20,
          background: "var(--color-sidebar)",
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        <div>
          <p
            style={{
              margin: 0,
              color: "var(--color-fg-subtle)",
              fontSize: 11,
              letterSpacing: 1.2,
              textTransform: "uppercase",
            }}
          >
            Signed in as
          </p>
          <p
            style={{
              margin: "4px 0 0",
              color: "var(--color-fg)",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            {session.user?.name ?? session.user?.email ?? "Unknown user"}
          </p>
          <p
            style={{
              margin: "2px 0 0",
              color: "var(--color-fg-muted)",
              fontSize: 12,
            }}
          >
            via {session.source === "api-key" ? "API key" : "Email code"}
          </p>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          style={{
            alignSelf: "flex-start",
            padding: "8px 12px",
            background: "transparent",
            color: "var(--color-fg-muted)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          Sign out
        </button>
      </aside>

      <section
        style={{
          flex: 1,
          padding: 32,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          maxWidth: 720,
        }}
      >
        <header>
          <h1
            style={{
              margin: 0,
              color: "var(--color-fg)",
              fontSize: 22,
            }}
          >
            Choose a workspace
          </h1>
          <p
            style={{
              margin: "4px 0 0",
              color: "var(--color-fg-muted)",
              fontSize: 13,
            }}
          >
            Stage 2 data + session foundation is in place. Stage 3 will
            replace this view with the full sidebar / channel UI.
          </p>
        </header>

        {workspacesQuery.isPending ? (
          <p style={{ color: "var(--color-fg-muted)" }}>Loading workspaces…</p>
        ) : workspacesQuery.isError ? (
          <p style={{ color: "var(--color-danger)" }}>
            {(workspacesQuery.error as Error).message}
          </p>
        ) : workspacesQuery.data && workspacesQuery.data.length === 0 ? (
          <p style={{ color: "var(--color-fg-muted)" }}>
            You don&rsquo;t belong to any workspace on this backend.
          </p>
        ) : (
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {workspacesQuery.data?.map((ws) => {
              const selected =
                workspace?.workspaceId === ws.id ||
                workspace?.workspaceSlug === ws.slug;
              return (
                <li key={ws.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (client) client.setWorkspace({
                        workspaceId: ws.id,
                        workspaceSlug: ws.slug,
                      });
                      setWorkspace({
                        workspaceId: ws.id,
                        workspaceSlug: ws.slug,
                      });
                    }}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "12px 14px",
                      background: selected
                        ? "var(--color-elevated)"
                        : "transparent",
                      color: "var(--color-fg)",
                      border: `1px solid ${selected ? "var(--color-accent)" : "var(--color-border)"}`,
                      borderRadius: "var(--radius-md)",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                    }}
                  >
                    <span style={{ fontSize: 14, fontWeight: 600 }}>
                      {ws.name}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        color: "var(--color-fg-muted)",
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      {ws.slug} · {ws.issue_prefix}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}

// (No additional exports — Stage 3 will replace this shell.)
export {};
