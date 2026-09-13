import assert from "node:assert/strict";
import test from "node:test";

import { viteFrontendAdapter } from "../../src/adapters/viteFrontendAdapter";

// Captured verbatim from a real `npm run dev` run (with ANSI escapes intact) -
// the port digits are wrapped in their own bold escape sequence, which is
// exactly the case that breaks a naive regex without stripping ANSI first.
const REAL_VITE_OUTPUT =
  "\n> app@0.0.0 dev\n> vite\n\n\n  \x1b[32m\x1b[1mVITE\x1b[22m v8.3.0\x1b[39m  \x1b[2mready in \x1b[0m\x1b[1m237\x1b[22m\x1b[2m\x1b[0m ms\x1b[22m\n\n  \x1b[32m➜\x1b[39m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m\n\x1b[2m  \x1b[32m➜\x1b[39m  \x1b[1mNetwork\x1b[22m\x1b[2m: use \x1b[22m\x1b[1m--host\x1b[22m\x1b[2m to expose\x1b[22m\n";

void test("viteFrontendAdapter identifies itself as the 'vite' framework, distinct from any ServiceId", () => {
  assert.equal(viteFrontendAdapter.id, "vite");
});

void test("parseDevServerUrl extracts the URL from real ANSI-colored Vite output", () => {
  assert.equal(viteFrontendAdapter.parseDevServerUrl(REAL_VITE_OUTPUT), "http://localhost:5173/");
});

void test("parseDevServerUrl returns undefined for output with no Local: line", () => {
  assert.equal(viteFrontendAdapter.parseDevServerUrl("some unrelated output\n"), undefined);
});
