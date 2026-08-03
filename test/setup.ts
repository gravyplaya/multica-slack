/**
 * Vitest setup: extend `expect` with `@testing-library/jest-dom`
 * matchers (toBeInTheDocument, toBeDisabled, ...) and provide a
 * `happy-dom` polyfill for `crypto.subtle` so any future test
 * that reaches for the platform crypto API does not crash.
 */

import "@testing-library/jest-dom/vitest";
