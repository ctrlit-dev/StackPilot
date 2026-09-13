import assert from "node:assert/strict";
import test from "node:test";

import { splitCommandArguments } from "../../src/utils/commandLine";

void test("splits plain whitespace-separated arguments", () => {
  assert.deepEqual(splitCommandArguments("makemessages -l de"), ["makemessages", "-l", "de"]);
});

void test("keeps a double-quoted segment together", () => {
  assert.deepEqual(splitCommandArguments('dumpdata --exclude "auth.permission"'), ["dumpdata", "--exclude", "auth.permission"]);
});

void test("keeps a single-quoted segment together", () => {
  assert.deepEqual(splitCommandArguments("dumpdata --exclude 'auth.permission'"), ["dumpdata", "--exclude", "auth.permission"]);
});

void test("collapses repeated whitespace and trims", () => {
  assert.deepEqual(splitCommandArguments("  migrate   myapp  "), ["migrate", "myapp"]);
});

void test("returns an empty array for blank input", () => {
  assert.deepEqual(splitCommandArguments("   "), []);
});
