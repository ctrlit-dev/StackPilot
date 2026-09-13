import assert from "node:assert/strict";
import test from "node:test";

import type { DiagnosticResult } from "../../../src/diagnostics/diagnostic";
import type { DiagnosticCheck } from "../../../src/diagnostics/diagnosticCheck";
import { DiagnosticsController } from "../../../src/diagnostics/diagnosticsController";
import type { MigrationStatusReader } from "../../../src/diagnostics/checks/djangoMigrationsCheck";
import { ProjectStateStore } from "../../../src/state/projectState";
import { InMemoryFileSystemProbe } from "../fakes/inMemoryFileSystem";

function stubProjectState(): ProjectStateStore {
  const store = new ProjectStateStore();
  store.setState({ selection: { kind: "none" }, trusted: true });
  return store;
}

function stubMigrationStatusReader(): MigrationStatusReader {
  return {
    getStatus: () => "unknown",
    onDidChangeStatus: () => ({ dispose: () => {} })
  };
}

function checkReturning(results: readonly DiagnosticResult[]): DiagnosticCheck {
  return { run: () => Promise.resolve(results) };
}

function throwingCheck(reason: string): DiagnosticCheck {
  return {
    run(): Promise<readonly DiagnosticResult[]> {
      throw new Error(reason);
    }
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Returns a different promise on each call, in order - lets a test drive two overlapping refresh() calls to different outcomes. */
function sequencedCheck(promises: readonly Promise<readonly DiagnosticResult[]>[]): DiagnosticCheck {
  let index = 0;
  return {
    run: () => {
      const promise = promises[index] ?? Promise.resolve([]);
      index += 1;
      return promise;
    }
  };
}

const resultA: DiagnosticResult = { code: "a.one", severity: "warning", message: "A" };
const resultA2: DiagnosticResult = { code: "a.two", severity: "info", message: "A2" };
const resultB: DiagnosticResult = { code: "b.one", severity: "error", message: "B" };

void test("getResults() is empty before the first refresh completes", () => {
  const controller = new DiagnosticsController(
    [checkReturning([resultA])],
    stubProjectState(),
    new InMemoryFileSystemProbe(),
    stubMigrationStatusReader(),
    () => {}
  );

  assert.deepEqual(controller.getResults(), []);
  controller.dispose();
});

void test("aggregates results from multiple checks, preserving registration order and each check's own result order", async () => {
  const controller = new DiagnosticsController(
    [checkReturning([resultA, resultA2]), checkReturning([resultB])],
    stubProjectState(),
    new InMemoryFileSystemProbe(),
    stubMigrationStatusReader(),
    () => {}
  );

  await controller.refresh();

  assert.deepEqual(controller.getResults(), [resultA, resultA2, resultB]);
  controller.dispose();
});

void test("a throwing check does not suppress other checks' results, and its failure is logged (not turned into a DiagnosticResult)", async () => {
  const logs: string[] = [];
  const controller = new DiagnosticsController(
    [checkReturning([resultA]), throwingCheck("boom"), checkReturning([resultB])],
    stubProjectState(),
    new InMemoryFileSystemProbe(),
    stubMigrationStatusReader(),
    (message) => logs.push(message)
  );

  await controller.refresh(); // settle the constructor's own initial refresh deterministically first
  logs.length = 0; // discard the log produced by that initial refresh; assert only on the explicit refresh below

  await controller.refresh();

  assert.deepEqual(controller.getResults(), [resultA, resultB]);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /boom/);
  controller.dispose();
});

void test("onDidChangeDiagnostics fires once per committed refresh, even when the result set is unchanged", async () => {
  const controller = new DiagnosticsController(
    [checkReturning([resultA])],
    stubProjectState(),
    new InMemoryFileSystemProbe(),
    stubMigrationStatusReader(),
    () => {}
  );
  await controller.refresh(); // settle the constructor's own initial refresh first, deterministically

  let fireCount = 0;
  controller.onDidChangeDiagnostics(() => {
    fireCount += 1;
  });

  await controller.refresh();
  await controller.refresh();

  assert.equal(fireCount, 2, "a change event fires on every committed refresh, not only when content actually differs");
  controller.dispose();
});

void test("disposing unsubscribes from its refresh-triggering events (a later projectState change no longer refreshes it)", async () => {
  const projectState = stubProjectState();
  let runCount = 0;
  const countingCheck: DiagnosticCheck = {
    run: () => {
      runCount += 1;
      return Promise.resolve([]);
    }
  };
  const controller = new DiagnosticsController(
    [countingCheck],
    projectState,
    new InMemoryFileSystemProbe(),
    stubMigrationStatusReader(),
    () => {}
  );
  await controller.refresh();
  const countAfterInitialRefresh = runCount;

  controller.dispose();
  projectState.setState({ selection: { kind: "none" }, trusted: false });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(runCount, countAfterInitialRefresh, "a disposed controller must not react to further projectState changes");
});

void test("a stale (slower) refresh cannot overwrite a newer refresh that already committed", async () => {
  const firstGate = deferred<readonly DiagnosticResult[]>();
  const check = sequencedCheck([firstGate.promise, Promise.resolve([resultB])]);
  const controller = new DiagnosticsController(
    [check],
    stubProjectState(),
    new InMemoryFileSystemProbe(),
    stubMigrationStatusReader(),
    () => {}
  );
  // The constructor's own initial refresh (generation 1) is now in flight,
  // blocked on firstGate - it has already consumed sequencedCheck's first promise.

  await controller.refresh(); // generation 2, resolves immediately with resultB
  assert.deepEqual(controller.getResults(), [resultB]);

  // Only now let the slower, earlier-started refresh finish.
  firstGate.resolve([resultA]);
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(controller.getResults(), [resultB], "the stale refresh must not overwrite the newer, already-committed result");
  controller.dispose();
});
