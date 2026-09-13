import assert from "node:assert/strict";
import test from "node:test";

import { nextPortSuggestion } from "../../src/commands/portConflict";

void test("suggests the next higher port", () => {
  assert.equal(nextPortSuggestion(8000), 8001);
});
