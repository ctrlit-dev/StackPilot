import assert from "node:assert/strict";
import test from "node:test";

import { ActivityLog } from "../../src/state/activityLog";

void test("returns entries newest-first", () => {
  const log = new ActivityLog();
  log.record("first");
  log.record("second");
  assert.deepEqual(
    log.getRecent(5).map((entry) => entry.message),
    ["second", "first"]
  );
});

void test("defaults to info kind when none is given", () => {
  const log = new ActivityLog();
  log.record("something happened");
  assert.equal(log.getRecent(1)[0]?.kind, "info");
});

void test("respects the requested limit", () => {
  const log = new ActivityLog();
  log.record("a");
  log.record("b");
  log.record("c");
  assert.equal(log.getRecent(2).length, 2);
});

void test("caps stored history so it cannot grow unbounded", () => {
  const log = new ActivityLog();
  for (let i = 0; i < 30; i++) {
    log.record(`entry ${i}`);
  }
  assert.equal(log.getRecent(100).length, 20);
  assert.equal(log.getRecent(1)[0]?.message, "entry 29");
});

void test("notifies listeners on every record and stops after dispose", () => {
  const log = new ActivityLog();
  let notifications = 0;
  const subscription = log.onDidChange(() => {
    notifications++;
  });

  log.record("one");
  assert.equal(notifications, 1);

  subscription.dispose();
  log.record("two");
  assert.equal(notifications, 1);
});
