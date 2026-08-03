#!/usr/bin/env node
// Validate docs/contracts/fixtures/*.json as pure redacted wire-shape samples.
//
// Invariants enforced:
//   1. Every file under fixtures/ except manifest.json parses as a JSON object
//      whose top-level keys do NOT start with `_` (no embedded documentation).
//   2. No fixture uses a JSON reference placeholder like `{"$ref": "..."}` —
//      references between fixtures belong in manifest.json, not in the wire
//      frames themselves. We embed redacted copies instead so each frame is
//      self-contained.
//   3. manifest.json exists and lists every fixture present on disk.
//   4. The manifest's metadata has no missing or extra fixture ids.
//
// Exit code 0 on success, 1 on any violation.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "docs", "contracts", "fixtures");

const errors = [];

function fail(msg) {
  errors.push(msg);
}

function loadJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    fail(`${path}: invalid JSON: ${e.message}`);
    return null;
  }
}

// --- Discover fixtures on disk ----------------------------------------------

const entries = readdirSync(fixturesDir).filter((name) => name.endsWith(".json"));
const manifestPath = join(fixturesDir, "manifest.json");

if (!statSync(manifestPath, { throwIfNoEntry: false })) {
  fail(`manifest.json not found at ${manifestPath}`);
}

const manifest = loadJson(manifestPath);
const manifestIds = new Set();

if (manifest && Array.isArray(manifest.fixtures)) {
  for (const entry of manifest.fixtures) {
    if (typeof entry?.id === "string") manifestIds.add(entry.id);
    else fail("manifest.fixtures[] entry missing string id");
    for (const key of ["kind", "resource", "source", "redaction"]) {
      if (typeof entry?.[key] !== "string" || entry[key].length === 0) {
        fail(`manifest entry '${entry?.id ?? "<unknown>"}' missing required string field '${key}'`);
      }
    }
    if (entry?.kind === "ws-frame-inbound" || entry?.kind === "ws-frame-outbound") {
      for (const key of ["direction", "scope"]) {
        if (typeof entry?.[key] !== "string" || entry[key].length === 0) {
          fail(`WS manifest entry '${entry?.id}' missing required string field '${key}'`);
        }
      }
    }
  }
}

const diskIds = new Set();
for (const name of entries) {
  if (name === "manifest.json") continue;
  const id = basename(name, ".json");
  diskIds.add(id);

  const path = join(fixturesDir, name);
  const data = loadJson(path);
  if (data === null) continue;

  if (typeof data !== "object" || Array.isArray(data) || data === null) {
    fail(`${name}: top-level must be a JSON object`);
    continue;
  }

  // Invariant 1: no documentation keys at the top level.
  const docKeys = Object.keys(data).filter((k) => k.startsWith("_"));
  if (docKeys.length > 0) {
    fail(`${name}: top-level keys starting with '_' are reserved for metadata (move to manifest.json): ${docKeys.join(", ")}`);
  }

  // Invariant 2: no $ref placeholders.
  walk(data, (value, keyPath) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (typeof value.$ref === "string") {
        fail(`${name}: contains $ref placeholder at ${keyPath} (inline a redacted copy instead)`);
      }
    }
  });

  // WS frame shape: { type, payload }.
  if (!manifestIds.has(id)) {
    fail(`${name}: not listed in manifest.json (or manifest.json failed to parse)`);
  } else {
    const entry = manifest.fixtures.find((f) => f.id === id);
    if (entry?.kind === "ws-frame-inbound" || entry?.kind === "ws-frame-outbound") {
      if (typeof data.type !== "string" || data.type.length === 0) {
        fail(`${name}: WS frame missing top-level string 'type'`);
      }
      if (typeof data.payload !== "object" || data.payload === null || Array.isArray(data.payload)) {
        fail(`${name}: WS frame missing object 'payload'`);
      }
    }
  }
}

for (const id of manifestIds) {
  if (!diskIds.has(id)) {
    fail(`manifest references fixture '${id}' but no file ${id}.json exists on disk`);
  }
}
for (const id of diskIds) {
  if (!manifestIds.has(id)) {
    fail(`fixture file ${id}.json exists on disk but is not listed in manifest.json`);
  }
}

// --- Report -----------------------------------------------------------------

if (errors.length > 0) {
  console.error("Fixture validation failed:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`Fixture validation OK (${diskIds.size} fixtures checked against manifest).`);

// --- Helpers ----------------------------------------------------------------

function walk(value, visit, keyPath = "") {
  visit(value, keyPath);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      walk(value[i], visit, `${keyPath}[${i}]`);
    }
  } else if (value && typeof value === "object") {
    for (const k of Object.keys(value)) {
      walk(value[k], visit, keyPath ? `${keyPath}.${k}` : k);
    }
  }
}