import assert from "node:assert/strict";
import test from "node:test";
import { getWorkspaceTrustSnapshot } from "../../src/security/workspaceTrustModel";

void test("trusted workspaces may execute workspace code", () => {
  assert.deepEqual(getWorkspaceTrustSnapshot(true), {
    isTrusted: true,
    canInspectWorkspace: true,
    canExecuteWorkspaceCode: true
  });
});

void test("untrusted workspaces may be inspected but execution is gated", () => {
  assert.deepEqual(getWorkspaceTrustSnapshot(false), {
    isTrusted: false,
    canInspectWorkspace: true,
    canExecuteWorkspaceCode: false
  });
});
