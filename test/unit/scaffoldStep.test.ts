import assert from "node:assert/strict";
import test from "node:test";

import { executeScaffoldSteps, type ScaffoldStep } from "../../src/project/scaffoldStep";

function succeedingStep(id: string, createdPaths: readonly string[] = []): ScaffoldStep {
  return { id, label: id, execute: () => Promise.resolve({ succeeded: true, createdPaths }) };
}

function failingStep(id: string, errorMessage: string): ScaffoldStep {
  return { id, label: id, execute: () => Promise.resolve({ succeeded: false, createdPaths: [], errorMessage }) };
}

void test("runs every step and reports no failure when all succeed", async () => {
  const result = await executeScaffoldSteps([succeedingStep("a", ["/p/a"]), succeedingStep("b", ["/p/b"])]);
  assert.deepEqual(result.completedStepIds, ["a", "b"]);
  assert.equal(result.failedStep, undefined);
  assert.deepEqual(result.createdPaths, ["/p/a", "/p/b"]);
});

void test("stops at the first failure and does not run later steps", async () => {
  let laterStepRan = false;
  const laterStep: ScaffoldStep = {
    id: "c",
    label: "c",
    execute: () => {
      laterStepRan = true;
      return Promise.resolve({ succeeded: true, createdPaths: [] });
    }
  };

  const result = await executeScaffoldSteps([succeedingStep("a", ["/p/a"]), failingStep("b", "boom"), laterStep]);

  assert.deepEqual(result.completedStepIds, ["a"]);
  assert.deepEqual(result.failedStep, { id: "b", label: "b", errorMessage: "boom" });
  assert.equal(laterStepRan, false);
});

void test("preserves createdPaths from steps completed before the failure", async () => {
  const result = await executeScaffoldSteps([succeedingStep("a", ["/p/a"]), failingStep("b", "boom")]);
  assert.deepEqual(result.createdPaths, ["/p/a"]);
});

void test("reports an empty createdPaths list for steps that created nothing new", async () => {
  const result = await executeScaffoldSteps([succeedingStep("a")]);
  assert.deepEqual(result.createdPaths, []);
});

void test("notifies onStepStart for each step in order, including the one that fails", () => {
  const started: string[] = [];
  return executeScaffoldSteps([succeedingStep("a"), failingStep("b", "boom"), succeedingStep("c")], (step) => started.push(step.id)).then(
    () => {
      assert.deepEqual(started, ["a", "b"]);
    }
  );
});

void test("reports cancelled and stops before running the next step once cancellation is requested", async () => {
  let laterStepRan = false;
  const laterStep: ScaffoldStep = {
    id: "b",
    label: "b",
    execute: () => {
      laterStepRan = true;
      return Promise.resolve({ succeeded: true, createdPaths: [] });
    }
  };
  const cancellation = { isCancellationRequested: false };

  const result = await executeScaffoldSteps(
    [succeedingStep("a", ["/p/a"]), laterStep],
    () => {
      // Simulates the user cancelling while step "a" is still running -
      // by the time it finishes, cancellation has been requested.
      cancellation.isCancellationRequested = true;
    },
    cancellation
  );

  assert.equal(result.cancelled, true);
  assert.equal(result.failedStep, undefined);
  assert.deepEqual(result.completedStepIds, ["a"]);
  assert.deepEqual(result.createdPaths, ["/p/a"]);
  assert.equal(laterStepRan, false);
});

void test("does not report cancelled when the run completes normally", async () => {
  const result = await executeScaffoldSteps([succeedingStep("a")], undefined, { isCancellationRequested: false });
  assert.equal(result.cancelled, false);
});

void test("cancellation requested before any step starts runs nothing", async () => {
  let ran = false;
  const step: ScaffoldStep = {
    id: "a",
    label: "a",
    execute: () => {
      ran = true;
      return Promise.resolve({ succeeded: true, createdPaths: [] });
    }
  };

  const result = await executeScaffoldSteps([step], undefined, { isCancellationRequested: true });

  assert.equal(result.cancelled, true);
  assert.equal(ran, false);
  assert.deepEqual(result.completedStepIds, []);
});
