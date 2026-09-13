import assert from "node:assert/strict";
import test from "node:test";

import { runOneShotCommand } from "../../src/execution/oneShotCommand";
import { FakeProcessSpawner } from "./fakes/fakeProcessSpawner";

function options() {
  return { executable: "python", args: ["manage.py", "migrate"], cwd: "/workspace/backend" };
}

/**
 * runOneShotCommand only registers its onOutput/onExit listeners after its
 * internal `await spawner.spawn(...)` resolves. Emitting fake events before
 * that continuation has run would be silently dropped (no listeners yet) and
 * the awaited result would hang forever. One microtask tick is exactly
 * enough here since there is exactly one await before registration.
 */
function flushMicrotask(): Promise<void> {
  return Promise.resolve();
}

void test("resolves with aggregated output and exit code on success", async () => {
  const spawner = new FakeProcessSpawner();
  const handle = spawner.queueSuccess();

  const resultPromise = runOneShotCommand(spawner, options());
  await flushMicrotask();
  handle.emitOutput("Applying migrations...\n", "stdout");
  handle.emitOutput("warning: something\n", "stderr");
  handle.emitExit({ code: 0, signal: null });

  const result = await resultPromise;
  assert.equal(result.outcome, "completed");
  if (result.outcome === "completed") {
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "Applying migrations...\n");
    assert.equal(result.stderr, "warning: something\n");
  }
});

void test("reports a non-zero exit code without treating it as a spawn failure", async () => {
  const spawner = new FakeProcessSpawner();
  const handle = spawner.queueSuccess();

  const resultPromise = runOneShotCommand(spawner, options());
  await flushMicrotask();
  handle.emitExit({ code: 1, signal: null });

  const result = await resultPromise;
  assert.equal(result.outcome, "completed");
  if (result.outcome === "completed") {
    assert.equal(result.exitCode, 1);
  }
});

void test("reports spawn-failed when the spawner rejects", async () => {
  const spawner = new FakeProcessSpawner();
  spawner.queueFailure(new Error("spawn python ENOENT"));

  const result = await runOneShotCommand(spawner, options());
  assert.equal(result.outcome, "spawn-failed");
  if (result.outcome === "spawn-failed") {
    assert.ok(result.reason.includes("ENOENT"));
  }
});

void test("reports spawn-failed when a delayed error arrives after a successful spawn (Windows ENOENT quirk)", async () => {
  const spawner = new FakeProcessSpawner();
  const handle = spawner.queueSuccess();

  const resultPromise = runOneShotCommand(spawner, options());
  await flushMicrotask();
  handle.emitExit({ code: null, signal: null, error: "spawn C:\\bad\\python.exe ENOENT" });

  const result = await resultPromise;
  assert.equal(result.outcome, "spawn-failed");
  if (result.outcome === "spawn-failed") {
    assert.equal(result.reason, "spawn C:\\bad\\python.exe ENOENT");
  }
});

void test("forwards live output via the onOutput callback", async () => {
  const spawner = new FakeProcessSpawner();
  const handle = spawner.queueSuccess();
  const seen: string[] = [];

  const resultPromise = runOneShotCommand(spawner, options(), (chunk) => seen.push(chunk));
  await flushMicrotask();
  handle.emitOutput("line one\n");
  handle.emitOutput("line two\n");
  handle.emitExit({ code: 0, signal: null });

  await resultPromise;
  assert.deepEqual(seen, ["line one\n", "line two\n"]);
});
