// @vitest-environment happy-dom

declare global {
  // React uses this flag to decide whether updates must be wrapped in act().
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";

import { Providers } from "../../app/providers";
import { SignInPage } from "./SignInPage";

const BACKEND_ORIGIN = "http://multica.example.test";

function signInTree() {
  return (
    <Providers>
      <SignInPage onSession={() => undefined} backendOrigin={BACKEND_ORIGIN} />
    </Providers>
  );
}

describe("SignInPage hydration", () => {
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;

  afterEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    cleanup();
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
    document.body.innerHTML = "";
  });

  it("hydrates without a mismatch before showing the API-key reminder", async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    window.sessionStorage.clear();

    const browserWindow = window;
    vi.stubGlobal("window", undefined);
    const serverHtml = renderToString(signInTree());
    vi.stubGlobal("window", browserWindow);

    document.body.innerHTML = `<div id="root">${serverHtml}</div>`;
    const container = document.getElementById("root");
    expect(container).not.toBeNull();

    const recoverableErrors: unknown[] = [];
    let root: Root | undefined;

    await act(async () => {
      root = hydrateRoot(container!, signInTree(), {
        onRecoverableError: (error) => recoverableErrors.push(error),
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("note")).toHaveTextContent("Heads up.");
    });
    expect(recoverableErrors).toEqual([]);

    await act(async () => {
      root?.unmount();
    });
  });
});
