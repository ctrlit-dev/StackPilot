import assert from "node:assert/strict";
import test from "node:test";

import { getShowOpenDialogCalls, resetVscodeStubCalls, setShowOpenDialogResult } from "./support/vscodeTestStub";

import type { CommandContext } from "../../src/commands/commandContext";
import { runNewProjectWizard } from "../../src/commands/newProjectWizard";

function buildContext(trusted: boolean): { context: CommandContext; ensureTrustedCalls: string[] } {
  const ensureTrustedCalls: string[] = [];
  const context = {
    workspaceTrust: {
      ensureTrustedForExecution: (operationLabel: string) => {
        ensureTrustedCalls.push(operationLabel);
        return Promise.resolve(trusted);
      }
    }
  } as unknown as CommandContext;
  return { context, ensureTrustedCalls };
}

void test("runNewProjectWizard: denied Workspace Trust stops before the parent-directory picker (and everything after it)", async () => {
  resetVscodeStubCalls();
  const { context, ensureTrustedCalls } = buildContext(false);

  await runNewProjectWizard(context);

  assert.deepEqual(ensureTrustedCalls, ["New Project"]);
  assert.equal(
    getShowOpenDialogCalls().length,
    0,
    "no scaffold/create step can be reached - the parent-directory picker, the first step of the wizard, must never run when Workspace Trust is denied"
  );
});

void test("runNewProjectWizard: granted Workspace Trust proceeds to the first wizard prompt exactly once", async () => {
  resetVscodeStubCalls();
  setShowOpenDialogResult(undefined);
  const { context, ensureTrustedCalls } = buildContext(true);

  await runNewProjectWizard(context);

  assert.deepEqual(ensureTrustedCalls, ["New Project"]);
  assert.equal(getShowOpenDialogCalls().length, 1, "the existing wizard flow must continue unchanged once Workspace Trust is granted");
});
