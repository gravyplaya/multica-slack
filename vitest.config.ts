import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Stage 2 test configuration.
 *
 * - Pure modules (types, mappers, errors, api client, auth, view-store) run in
 *   the Node environment for speed and to keep the client surface honest.
 * - Anything that touches `window`, `document`, `localStorage`, etc. opts in
 *   via a per-file `// @vitest-environment happy-dom` directive so the Node
 *   default stays clean.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "lib/**/*.test.ts",
      "lib/**/*.test.tsx",
      "components/**/*.test.ts",
      "components/**/*.test.tsx",
    ],
    exclude: ["node_modules", ".next", "dist"],
    globals: false,
    setupFiles: ["./test/setup.ts"],
    reporters: ["default"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
