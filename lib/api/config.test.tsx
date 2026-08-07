/**
 * Config-module regression test.
 *
 * `lib/api/config.ts` exposes `NEXT_PUBLIC_*` values to both the
 * server and the client bundle. Next.js's bundler only inlines
 * STATIC `process.env.NEXT_PUBLIC_<NAME>` property access — any
 * indirect helper (e.g. `process.env[name]` or `env.<NAME>`)
 * defeats the inliner and the client bundle keeps the reference
 * unresolved at compile time. The server and the browser bundle
 * can then disagree on the resolved value, which surfaces as a
 * React hydration mismatch the first time the page paints.
 *
 * The load-bearing contract this test pins: the configured origin
 * rendered during SSR matches the text after hydration. If a
 * refactor of `config.ts` ever breaks the static-read contract,
 * React raises a recoverable hydration error and this test fails.
 */

// @vitest-environment happy-dom

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";

import { API_BASE_URL, APP_NAME } from "./config";
import { Providers } from "../../app/providers";
import { SignInPage } from "../../components/auth/SignInPage";

describe("lib/api/config", () => {
  const originalAct = globalThis.IS_REACT_ACT_ENVIRONMENT;

  afterEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = originalAct;
    cleanup();
    document.body.innerHTML = "";
  });

  it("hydrates the sign-in page without an origin mismatch", async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    expect(typeof API_BASE_URL).toBe("string");
    expect(API_BASE_URL.length).toBeGreaterThan(0);
    expect(typeof APP_NAME).toBe("string");
    expect(APP_NAME.length).toBeGreaterThan(0);

    const tree = (
      <Providers>
        <SignInPage onSession={() => undefined} backendOrigin={API_BASE_URL} />
      </Providers>
    );

    const ssrHtml = renderToString(tree);
    expect(ssrHtml).toContain(API_BASE_URL);
    expect(ssrHtml).toContain(APP_NAME);

    const container = document.createElement("div");
    container.id = "root";
    container.innerHTML = ssrHtml;
    document.body.appendChild(container);

    const errors: unknown[] = [];
    let root: { unmount(): void } | undefined;

    await act(async () => {
      root = hydrateRoot(container, tree, {
        onRecoverableError: (e) => errors.push(e),
      });
    });

    expect(errors).toEqual([]);
    expect(container.textContent).toContain(API_BASE_URL);
    expect(container.textContent).toContain(APP_NAME);

    await act(async () => {
      root?.unmount();
    });
  });
});
