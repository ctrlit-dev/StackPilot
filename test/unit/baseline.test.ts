import assert from "node:assert/strict";
import test from "node:test";
import { COMMAND_REFRESH, EXTENSION_ID, OUTPUT_CHANNEL_NAME } from "../../src/constants";

void test("baseline constants use the stackPilot command namespace", () => {
  assert.equal(EXTENSION_ID, "stackpilot");
  assert.equal(OUTPUT_CHANNEL_NAME, "StackPilot");
  assert.equal(COMMAND_REFRESH, "stackPilot.refresh");
});
