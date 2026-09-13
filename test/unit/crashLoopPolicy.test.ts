import assert from "node:assert/strict";
import test from "node:test";

import { nextRestartDelayMs, type CrashLoopPolicy } from "../../src/execution/crashLoopPolicy";

const policy: CrashLoopPolicy = { maxConsecutiveRestarts: 3, backoffMillisecondsByAttempt: [1000, 2000, 4000] };

void test("returns the backoff for the first attempt", () => {
  assert.equal(nextRestartDelayMs(policy, 1), 1000);
});

void test("returns increasing backoff for later attempts", () => {
  assert.equal(nextRestartDelayMs(policy, 2), 2000);
  assert.equal(nextRestartDelayMs(policy, 3), 4000);
});

void test("gives up once the attempt budget is exhausted", () => {
  assert.equal(nextRestartDelayMs(policy, 4), undefined);
});

void test("clamps to the last backoff entry when there are more attempts than entries", () => {
  const shortPolicy: CrashLoopPolicy = { maxConsecutiveRestarts: 5, backoffMillisecondsByAttempt: [1000] };
  assert.equal(nextRestartDelayMs(shortPolicy, 5), 1000);
});

void test("rejects a count below 1", () => {
  assert.equal(nextRestartDelayMs(policy, 0), undefined);
});
