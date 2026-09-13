import assert from "node:assert/strict";
import test from "node:test";

import { viteFrontendAdapter } from "../../src/adapters/viteFrontendAdapter";
import type { FrontendFrameworkAdapter } from "../../src/adapters/frontendFrameworkAdapter";
import { FrontendUrlTracker } from "../../src/execution/frontendUrlTracker";

// Captured verbatim from a real `npm run dev` run (with ANSI escapes intact) -
// the port digits are wrapped in their own bold escape sequence, which is
// exactly the case that breaks a naive regex without stripping ANSI first.
const REAL_VITE_OUTPUT =
  "\n> app@0.0.0 dev\n> vite\n\n\n  \x1b[32m\x1b[1mVITE\x1b[22m v8.3.0\x1b[39m  \x1b[2mready in \x1b[0m\x1b[1m237\x1b[22m\x1b[2m\x1b[0m ms\x1b[22m\n\n  \x1b[32m➜\x1b[39m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m\n\x1b[2m  \x1b[32m➜\x1b[39m  \x1b[1mNetwork\x1b[22m\x1b[2m: use \x1b[22m\x1b[1m--host\x1b[22m\x1b[2m to expose\x1b[22m\n";

void test("FrontendUrlTracker finds the URL once enough output has accumulated", () => {
  const tracker = new FrontendUrlTracker(viteFrontendAdapter);
  tracker.feed("some other output\n");
  assert.equal(tracker.getUrl(), undefined);
  tracker.feed(REAL_VITE_OUTPUT);
  assert.equal(tracker.getUrl(), "http://localhost:5173/");
});

void test("FrontendUrlTracker finds the URL when it is split across two chunks", () => {
  const tracker = new FrontendUrlTracker(viteFrontendAdapter);
  const midpoint = Math.floor(REAL_VITE_OUTPUT.length / 2);
  tracker.feed(REAL_VITE_OUTPUT.slice(0, midpoint));
  tracker.feed(REAL_VITE_OUTPUT.slice(midpoint));
  assert.equal(tracker.getUrl(), "http://localhost:5173/");
});

void test("FrontendUrlTracker.reset() clears a previously found URL", () => {
  const tracker = new FrontendUrlTracker(viteFrontendAdapter);
  tracker.feed(REAL_VITE_OUTPUT);
  assert.equal(tracker.getUrl(), "http://localhost:5173/");
  tracker.reset();
  assert.equal(tracker.getUrl(), undefined);
});

void test("FrontendUrlTracker delegates parsing entirely to the injected adapter - it does not search for 'Local:' itself", () => {
  // Proves FrontendUrlTracker is adapter-driven, not Vite-specific itself: a
  // fake adapter that recognizes none of Vite's output shape but always
  // reports a fixed URL must have that URL reflected verbatim, and real Vite
  // output the fake adapter doesn't specifically handle must still work
  // exactly the way the fake defines it.
  const fakeAdapter: FrontendFrameworkAdapter = {
    id: "fake-framework",
    parseDevServerUrl: () => "http://example.test:1234/"
  };
  const tracker = new FrontendUrlTracker(fakeAdapter);

  tracker.feed("this is not Vite output at all\n");

  assert.equal(tracker.getUrl(), "http://example.test:1234/");
});
