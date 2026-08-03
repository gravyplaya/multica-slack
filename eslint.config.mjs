import nextConfig from "eslint-config-next/core-web-vitals";
import nextTsConfig from "eslint-config-next/typescript";

/** @type {import("eslint").Linter.Config[]} */
const config = [
  ...nextConfig,
  ...nextTsConfig,
  {
    ignores: [
      "node_modules/",
      ".next/",
      "out/",
      "build/",
      "dist/",
      "next-env.d.ts",
      "coverage/",
      "playwright-report/",
      "test-results/",
    ],
  },
];

export default config;
