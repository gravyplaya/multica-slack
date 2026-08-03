"use client";

/**
 * Stage 2 root page.
 *
 * Acts as the auth gate:
 * - no session -> render <SignInPage> with both panels
 * - session present -> render <AuthenticatedShell>
 *
 * The page is a client component because the SessionStore is
 * browser-side. Server rendering of the page itself is still safe
 * because both SignInPage and AuthenticatedShell handle the
 * pre-hydration state (they read `useSession()` and the `useEffect`
 * inside `use-session` resolves to `null` on the server).
 *
 * Stage 3 will replace this gate with the real workspace shell.
 */

import { AuthenticatedShell } from "../components/auth/AuthenticatedShell";
import { SignInPage } from "../components/auth/SignInPage";
import { useSession, useSessionStore } from "../lib/auth/use-session";
import type { SessionState } from "../lib/types";

export default function HomePage() {
  const session = useSession();
  const store = useSessionStore();

  function handleSession(next: SessionState) {
    store.set(next);
  }

  if (!session) {
    return <SignInPage onSession={handleSession} />;
  }
  return <AuthenticatedShell />;
}
