import assert from "node:assert/strict";
import test from "node:test";

import type { FrontendFrameworkAdapter } from "../../src/adapters/frontendFrameworkAdapter";
import { nextFrontendAdapter } from "../../src/adapters/nextFrontendAdapter";
import { viteFrontendAdapter } from "../../src/adapters/viteFrontendAdapter";
import { FrontendUrlTracker } from "../../src/execution/frontendUrlTracker";

// Captured verbatim from a real `npm run dev` run (with ANSI escapes intact) -
// the port digits are wrapped in their own bold escape sequence, which is
// exactly the case that breaks a naive regex without stripping ANSI first.
const REAL_VITE_OUTPUT =
  "\n> app@0.0.0 dev\n> vite\n\n\n  \x1b[32m\x1b[1mVITE\x1b[22m v8.3.0\x1b[39m  \x1b[2mready in \x1b[0m\x1b[1m237\x1b[22m\x1b[2m\x1b[0m ms\x1b[22m\n\n  \x1b[32m➜\x1b[39m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m\n\x1b[2m  \x1b[32m➜\x1b[39m  \x1b[1mNetwork\x1b[22m\x1b[2m: use \x1b[22m\x1b[1m--host\x1b[22m\x1b[2m to expose\x1b[22m\n";

// Captured verbatim (NEXTJS-1B.0) from a real create-next-app@latest
// scaffold's `npm run dev` (Next.js 16.3.5) - normal start, this process's
// own real bound URL, on stdout.
const REAL_NEXT_OUTPUT_STDOUT =
  "\n> probe-app@0.1.0 dev\n> next dev\n\n▲ Next.js 16.3.5 (Turbopack)\n- Local:         http://localhost:3000\n- Network:       http://192.168.178.28:3000\n✓ Ready in 4.8s\n";

// Captured verbatim (NEXTJS-1B.0) from the SECOND instance's stdout, after
// port 3000 was already occupied - this instance's own real bound URL.
const REAL_NEXT_OUTPUT_STDOUT_ALT_PORT =
  "\n> probe-app@0.1.0 dev\n> next dev\n\n▲ Next.js 16.3.5 (Turbopack)\n- Local:         http://localhost:3001\n- Network:       http://192.168.178.28:3001\n✓ Ready in 609ms\n";

// Captured verbatim (NEXTJS-1B.0) from that SAME second instance's stderr -
// diagnostics describing the OTHER (first) process, including a "- Local:"
// line for someone else's server. This is the exact shape that makes
// stream-aware feeding correctness-critical, not merely a hardening nicety.
const REAL_NEXT_OUTPUT_STDERR_WRONG_SERVER =
  "⚠ Port 3000 is in use by an unknown process, using available port 3001 instead.\n⨯ Another next dev server is already running.\n\n- Local:        http://localhost:3000\n- PID:          30240\n";

void test("FrontendUrlTracker finds the URL once enough stdout has accumulated", () => {
  const tracker = new FrontendUrlTracker([viteFrontendAdapter]);
  tracker.setActiveFramework("vite");
  tracker.feed("some other output\n", "stdout");
  assert.equal(tracker.getUrl(), undefined);
  tracker.feed(REAL_VITE_OUTPUT, "stdout");
  assert.equal(tracker.getUrl(), "http://localhost:5173/");
});

void test("FrontendUrlTracker finds the URL when it is split across two stdout chunks", () => {
  const tracker = new FrontendUrlTracker([viteFrontendAdapter]);
  tracker.setActiveFramework("vite");
  const midpoint = Math.floor(REAL_VITE_OUTPUT.length / 2);
  tracker.feed(REAL_VITE_OUTPUT.slice(0, midpoint), "stdout");
  tracker.feed(REAL_VITE_OUTPUT.slice(midpoint), "stdout");
  assert.equal(tracker.getUrl(), "http://localhost:5173/");
});

void test("FrontendUrlTracker.reset() clears a previously found URL", () => {
  const tracker = new FrontendUrlTracker([viteFrontendAdapter]);
  tracker.setActiveFramework("vite");
  tracker.feed(REAL_VITE_OUTPUT, "stdout");
  assert.equal(tracker.getUrl(), "http://localhost:5173/");
  tracker.reset();
  assert.equal(tracker.getUrl(), undefined);
});

void test("FrontendUrlTracker delegates parsing entirely to the active adapter - it does not search for 'Local:' itself", () => {
  // Proves FrontendUrlTracker is adapter-driven, not Vite-specific itself: a
  // fake adapter that recognizes none of Vite's output shape but always
  // reports a fixed URL must have that URL reflected verbatim, and real Vite
  // output the fake adapter doesn't specifically handle must still work
  // exactly the way the fake defines it.
  const fakeAdapter: FrontendFrameworkAdapter = {
    id: "fake-framework",
    parseDevServerUrl: () => "http://example.test:1234/"
  };
  const tracker = new FrontendUrlTracker([fakeAdapter]);
  tracker.setActiveFramework("fake-framework");

  tracker.feed("this is not Vite output at all\n", "stdout");

  assert.equal(tracker.getUrl(), "http://example.test:1234/");
});

// ---- NEXTJS-1B: frontend framework pluralization -----------------------

void test("setActiveFramework('next') uses the Next.js adapter, ignoring Vite's output shape", () => {
  const tracker = new FrontendUrlTracker([viteFrontendAdapter, nextFrontendAdapter]);
  tracker.setActiveFramework("next");

  tracker.feed(REAL_VITE_OUTPUT, "stdout");
  assert.equal(tracker.getUrl(), undefined, "Vite-shaped output must not resolve a URL while Next.js is the active framework");

  tracker.feed(REAL_NEXT_OUTPUT_STDOUT, "stdout");
  assert.equal(tracker.getUrl(), "http://localhost:3000");
});

void test("setActiveFramework('vite') uses the Vite adapter for real Vite output", () => {
  // NOTE: unlike the reverse direction above, this does not also assert
  // that Next.js-shaped output is ignored while Vite is active - Vite's
  // pre-existing, unmodified adapter (viteFrontendAdapter.ts, untouched by
  // NEXTJS-1B) matches any "Local:" occurrence with no leading-dash
  // requirement, so it also happens to match Next.js's own "- Local:" line.
  // That is a pre-existing property of Vite's own regex, out of this
  // package's scope to change, and harmless in production: the active
  // adapter is always chosen to match the actually-detected (and therefore
  // actually-running) framework, so a real Vite process never emits
  // Next.js-shaped output for Vite's adapter to be confused by.
  const tracker = new FrontendUrlTracker([viteFrontendAdapter, nextFrontendAdapter]);
  tracker.setActiveFramework("vite");

  tracker.feed(REAL_VITE_OUTPUT, "stdout");
  assert.equal(tracker.getUrl(), "http://localhost:5173/");
});

void test("an unrecognized/undetected frontend framework leaves no adapter active - feed() can never resolve a URL", () => {
  const tracker = new FrontendUrlTracker([viteFrontendAdapter, nextFrontendAdapter]);
  tracker.setActiveFramework(undefined);

  tracker.feed(REAL_NEXT_OUTPUT_STDOUT, "stdout");
  tracker.feed(REAL_VITE_OUTPUT, "stdout");

  assert.equal(tracker.getUrl(), undefined);
});

void test("setActiveFramework with an id no registered adapter recognizes behaves the same as no active framework", () => {
  const tracker = new FrontendUrlTracker([viteFrontendAdapter, nextFrontendAdapter]);
  tracker.setActiveFramework("some-future-framework");

  tracker.feed(REAL_NEXT_OUTPUT_STDOUT, "stdout");

  assert.equal(tracker.getUrl(), undefined);
});

void test("Next.js stop then Vite start: switching the active framework and resetting discards the stale Next.js URL", () => {
  const tracker = new FrontendUrlTracker([viteFrontendAdapter, nextFrontendAdapter]);
  tracker.setActiveFramework("next");
  tracker.feed(REAL_NEXT_OUTPUT_STDOUT, "stdout");
  assert.equal(tracker.getUrl(), "http://localhost:3000");

  tracker.setActiveFramework("vite");
  tracker.reset();
  assert.equal(tracker.getUrl(), undefined, "the stale Next.js URL must not survive a framework switch");

  tracker.feed(REAL_VITE_OUTPUT, "stdout");
  assert.equal(tracker.getUrl(), "http://localhost:5173/");
});

// ---- NEXTJS-1B §14/§16/§27: stream safety (hard acceptance criterion) --

void test("the hard acceptance case: stderr describing another server's URL never wins over this process's own stdout URL", () => {
  const tracker = new FrontendUrlTracker([nextFrontendAdapter]);
  tracker.setActiveFramework("next");

  tracker.feed(REAL_NEXT_OUTPUT_STDERR_WRONG_SERVER, "stderr");
  tracker.feed(REAL_NEXT_OUTPUT_STDOUT_ALT_PORT, "stdout");

  assert.equal(tracker.getUrl(), "http://localhost:3001");
  assert.notEqual(tracker.getUrl(), "http://localhost:3000");
});

void test("the same acceptance case in the opposite feed order: stdout arriving first, stderr's wrong URL arriving after, still resolves the correct URL and is never overwritten", () => {
  const tracker = new FrontendUrlTracker([nextFrontendAdapter]);
  tracker.setActiveFramework("next");

  tracker.feed(REAL_NEXT_OUTPUT_STDOUT_ALT_PORT, "stdout");
  assert.equal(tracker.getUrl(), "http://localhost:3001");

  tracker.feed(REAL_NEXT_OUTPUT_STDERR_WRONG_SERVER, "stderr");
  assert.equal(tracker.getUrl(), "http://localhost:3001");
});

void test("stderr only never establishes a URL", () => {
  const tracker = new FrontendUrlTracker([nextFrontendAdapter]);
  tracker.setActiveFramework("next");

  tracker.feed(REAL_NEXT_OUTPUT_STDERR_WRONG_SERVER, "stderr");

  assert.equal(tracker.getUrl(), undefined);
});

void test("stdout only resolves the correct URL", () => {
  const tracker = new FrontendUrlTracker([nextFrontendAdapter]);
  tracker.setActiveFramework("next");

  tracker.feed(REAL_NEXT_OUTPUT_STDOUT, "stdout");

  assert.equal(tracker.getUrl(), "http://localhost:3000");
});

void test("split stdout chunks (Next.js) still resolve the correct URL", () => {
  const tracker = new FrontendUrlTracker([nextFrontendAdapter]);
  tracker.setActiveFramework("next");

  const midpoint = Math.floor(REAL_NEXT_OUTPUT_STDOUT.length / 2);
  tracker.feed(REAL_NEXT_OUTPUT_STDOUT.slice(0, midpoint), "stdout");
  tracker.feed(REAL_NEXT_OUTPUT_STDOUT.slice(midpoint), "stdout");

  assert.equal(tracker.getUrl(), "http://localhost:3000");
});

void test("a partial stdout match cannot be completed by a stderr chunk that would lexically finish it", () => {
  const tracker = new FrontendUrlTracker([nextFrontendAdapter]);
  tracker.setActiveFramework("next");

  // Ends mid-way through the literal "http" itself (just "h") - the
  // adapter's own regex requires the full "http"/"https" literal before
  // "://", so this genuinely has no match yet (unlike a truncation
  // anywhere after "://", where \S+ would already greedily match whatever
  // non-whitespace text is present, port digits or not).
  tracker.feed("- Local:         h", "stdout");
  assert.equal(tracker.getUrl(), undefined);

  // If this were appended to the same buffer, "...h" + "ttp://localhost:3001\n"
  // would complete a valid-looking match - it must not, because it never
  // arrived on stdout.
  tracker.feed("ttp://localhost:3001\n", "stderr");
  assert.equal(tracker.getUrl(), undefined);

  // The buffer itself must be uncorrupted by the ignored stderr chunk -
  // stdout resumption still completes the SAME match correctly afterward.
  tracker.feed("ttp://localhost:3001\n", "stdout");
  assert.equal(tracker.getUrl(), "http://localhost:3001");
});

void test("reset() clears both the URL and the accumulated buffer, including any content fed via stdout", () => {
  const tracker = new FrontendUrlTracker([nextFrontendAdapter]);
  tracker.setActiveFramework("next");

  tracker.feed(REAL_NEXT_OUTPUT_STDOUT, "stdout");
  assert.equal(tracker.getUrl(), "http://localhost:3000");

  tracker.reset();
  assert.equal(tracker.getUrl(), undefined);

  tracker.feed(REAL_NEXT_OUTPUT_STDOUT_ALT_PORT, "stdout");
  assert.equal(tracker.getUrl(), "http://localhost:3001");
});
