import assert from "node:assert/strict";
import test from "node:test";

import { nextFrontendAdapter } from "../../src/adapters/nextFrontendAdapter";

// Captured verbatim (NEXTJS-1B.0) from a real `npm run dev` run of a
// create-next-app@latest scaffold (Next.js 16.3.5, Turbopack), normal
// start - port 3000 free.
const REAL_NEXT_OUTPUT_NORMAL =
  "\n> probe-app@0.1.0 dev\n> next dev\n\n\u25b2 Next.js 16.3.5 (Turbopack)\n- Local:         http://localhost:3000\n- Network:       http://192.168.178.28:3000\n\u2713 Ready in 4.8s\n\u2713 Running next.config.ts took 68ms\n";

// Captured verbatim (NEXTJS-1B.0) from the SAME scaffold's second instance,
// started while the first still held port 3000 - this instance's own
// stdout (its real bound URL, port 3001).
const REAL_NEXT_OUTPUT_PORT_COLLISION_STDOUT =
  "\n> probe-app@0.1.0 dev\n> next dev\n\n\u25b2 Next.js 16.3.5 (Turbopack)\n- Local:         http://localhost:3001\n- Network:       http://192.168.178.28:3001\n\u2713 Ready in 609ms\n\u2713 Running next.config.ts took 46ms\n\x1b[?25h";

// Captured verbatim (NEXTJS-1B.0) from that SAME second instance's stderr -
// describes the OTHER (first) process's URL, not this one's own. Must
// never be mistaken for this adapter's own answer (that discipline is
// FrontendUrlTracker's job, not this pure parser's - see
// frontendUrlTracker.test.ts's stream-safety tests - but the parser itself
// must still not be fooled if ever handed this text directly).
const REAL_NEXT_OUTPUT_PORT_COLLISION_STDERR =
  "\u26a0 Port 3000 is in use by an unknown process, using available port 3001 instead.\n\u2a2f Another next dev server is already running.\n\n- Local:        http://localhost:3000\n- PID:          30240\n- Dir:          C:\\probe-app\n- Log:          .next\\dev\\logs\\next-development.log\n\nYou can access the existing server at http://localhost:3000,\nor run taskkill /PID 30240 /F to stop it and start a new one.\n";

void test("nextFrontendAdapter identifies itself as the 'next' framework, distinct from any ServiceId", () => {
  assert.equal(nextFrontendAdapter.id, "next");
});

void test("parseDevServerUrl extracts the URL from a real normal-start Next.js output capture", () => {
  assert.equal(nextFrontendAdapter.parseDevServerUrl(REAL_NEXT_OUTPUT_NORMAL), "http://localhost:3000");
});

void test("parseDevServerUrl extracts the alternate port when Next.js selected one after a collision (stdout)", () => {
  assert.equal(nextFrontendAdapter.parseDevServerUrl(REAL_NEXT_OUTPUT_PORT_COLLISION_STDOUT), "http://localhost:3001");
});

void test("parseDevServerUrl still finds the Local: line even though the same output also contains an unrelated ANSI cursor-visibility escape", () => {
  // REAL_NEXT_OUTPUT_PORT_COLLISION_STDOUT ends with \x1b[?25h - proves the
  // match is not accidentally broken by a stray ANSI sequence elsewhere in
  // the buffer.
  assert.ok(REAL_NEXT_OUTPUT_PORT_COLLISION_STDOUT.includes("\x1b[?25h"));
  assert.equal(nextFrontendAdapter.parseDevServerUrl(REAL_NEXT_OUTPUT_PORT_COLLISION_STDOUT), "http://localhost:3001");
});

void test("parseDevServerUrl does not match the sibling Network: line as if it were Local:", () => {
  assert.equal(nextFrontendAdapter.parseDevServerUrl("- Network:       http://192.168.178.28:3000\n"), undefined);
});

void test("parseDevServerUrl returns undefined for output with no Local: line", () => {
  assert.equal(nextFrontendAdapter.parseDevServerUrl("some unrelated output\n"), undefined);
});

void test("parseDevServerUrl does not match an arbitrary unrelated URL that never appears after 'Local:'", () => {
  assert.equal(nextFrontendAdapter.parseDevServerUrl("Visit http://example.test/docs for more information\n"), undefined);
});

void test("parseDevServerUrl accepts https", () => {
  assert.equal(nextFrontendAdapter.parseDevServerUrl("- Local:         https://localhost:3000\n"), "https://localhost:3000");
});

void test("parseDevServerUrl tolerates a single-space variant of the observed whitespace", () => {
  assert.equal(nextFrontendAdapter.parseDevServerUrl("- Local: http://localhost:3000\n"), "http://localhost:3000");
});

void test("parseDevServerUrl is unaffected by unrelated text before and after the Local: line", () => {
  const text = `some preceding banner text\n${REAL_NEXT_OUTPUT_NORMAL}\nsome trailing compiler output\n`;
  assert.equal(nextFrontendAdapter.parseDevServerUrl(text), "http://localhost:3000");
});

void test("would extract the OTHER server's URL if handed stderr collision text directly - this parser has no stream awareness itself, that discipline belongs to FrontendUrlTracker", () => {
  // Documents, rather than hides, why FrontendUrlTracker.feed() must ignore
  // stderr entirely (NEXTJS-1B §14): this pure text parser cannot tell the
  // two shapes apart on lexical content alone.
  assert.equal(nextFrontendAdapter.parseDevServerUrl(REAL_NEXT_OUTPUT_PORT_COLLISION_STDERR), "http://localhost:3000");
});
