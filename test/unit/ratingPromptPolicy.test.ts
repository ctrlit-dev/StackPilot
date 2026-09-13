import assert from "node:assert/strict";
import test from "node:test";

import { DAY_IN_MILLISECONDS, shouldPromptForRating, type RatingPromptDecisionInput } from "../../src/engagement/ratingPromptPolicy";

const NOW = Date.now();

function input(overrides: Partial<RatingPromptDecisionInput> = {}): RatingPromptDecisionInput {
  return {
    status: "pending",
    isPublished: true,
    usageCount: 10,
    snoozeUntilCount: 0,
    firstActivatedAt: NOW - 4 * DAY_IN_MILLISECONDS,
    now: NOW,
    ...overrides
  };
}

void test("prompts once usage, time, and publish gates are all satisfied", () => {
  assert.equal(shouldPromptForRating(input()), true);
});

void test("never prompts while unpublished, regardless of usage or time", () => {
  assert.equal(shouldPromptForRating(input({ isPublished: false, usageCount: 1000, firstActivatedAt: 0 })), false);
});

void test("does not prompt below the usage threshold", () => {
  assert.equal(shouldPromptForRating(input({ usageCount: 9 })), false);
});

void test("does not prompt before the minimum elapsed time, even with plenty of usage", () => {
  assert.equal(shouldPromptForRating(input({ usageCount: 500, firstActivatedAt: NOW - 1 * DAY_IN_MILLISECONDS })), false);
});

void test("never prompts again once dismissed", () => {
  assert.equal(shouldPromptForRating(input({ status: "dismissed" })), false);
});

void test("never prompts again once already rated", () => {
  assert.equal(shouldPromptForRating(input({ status: "rated" })), false);
});

void test("respects a snooze that pushes the required usage count higher than the base threshold", () => {
  assert.equal(shouldPromptForRating(input({ usageCount: 15, snoozeUntilCount: 20 })), false);
  assert.equal(shouldPromptForRating(input({ usageCount: 20, snoozeUntilCount: 20 })), true);
});
