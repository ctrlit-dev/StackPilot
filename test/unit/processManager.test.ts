import assert from "node:assert/strict";
import test from "node:test";

import { ProcessManager, type StartProcessOptions } from "../../src/execution/processManager";
import { DEFAULT_SERVICE_REGISTRY, ServiceRegistry } from "../../src/execution/serviceRegistry";
import { FakeProcessSpawner } from "./fakes/fakeProcessSpawner";

function backendOptions(overrides: Partial<StartProcessOptions> = {}): StartProcessOptions {
  return {
    executable: "python",
    args: ["manage.py", "runserver", "127.0.0.1:8000"],
    cwd: "/workspace/backend",
    expectedPort: 8000,
    ...overrides
  };
}

function frontendOptions(overrides: Partial<StartProcessOptions> = {}): StartProcessOptions {
  return {
    executable: "npm",
    args: ["run", "dev"],
    cwd: "/workspace/frontend",
    expectedPort: 5173,
    ...overrides
  };
}

void test("starts a stopped process and reports its running descriptor", async () => {
  const spawner = new FakeProcessSpawner();
  spawner.queueSuccess();
  const manager = new ProcessManager(spawner);

  const result = await manager.start("backend", backendOptions());

  assert.equal(result.outcome, "started");
  assert.equal(manager.getState("backend").state, "running");
  assert.deepEqual(spawner.spawnCalls, [{ executable: "python", args: ["manage.py", "runserver", "127.0.0.1:8000"], cwd: "/workspace/backend", env: undefined }]);
});

void test("blocks a duplicate start while a process is already starting or running", async () => {
  const spawner = new FakeProcessSpawner();
  spawner.queueSuccess();
  const manager = new ProcessManager(spawner);

  const [first, second] = await Promise.all([manager.start("backend", backendOptions()), manager.start("backend", backendOptions())]);

  assert.equal(spawner.spawnCalls.length, 1);
  assert.equal(first.outcome, "started");
  assert.equal(second.outcome, "busy");
});

void test("stopping an already-stopped process is a no-op", async () => {
  const spawner = new FakeProcessSpawner();
  const manager = new ProcessManager(spawner);

  const result = await manager.stop("backend");

  assert.equal(result.outcome, "already-stopped");
  assert.equal(spawner.spawnCalls.length, 0);
});

void test("stopping a failed process is also a no-op", async () => {
  const spawner = new FakeProcessSpawner();
  spawner.queueFailure(new Error("spawn python ENOENT"));
  const manager = new ProcessManager(spawner);
  await manager.start("backend", backendOptions());

  const result = await manager.stop("backend");

  assert.equal(result.outcome, "already-stopped");
});

void test("transitions to failed when a running process exits unexpectedly", async () => {
  const spawner = new FakeProcessSpawner();
  const handle = spawner.queueSuccess();
  const manager = new ProcessManager(spawner);
  await manager.start("backend", backendOptions());

  handle.emitExit({ code: 1, signal: null });

  const state = manager.getState("backend");
  assert.equal(state.state, "failed");
  assert.equal(state.pid, undefined);
  assert.ok(state.lastError?.includes("unexpectedly"));
});

void test("surfaces a delayed spawn error reported through onExit rather than a rejection", async () => {
  // Regression test for a real Windows behavior (see nodeProcessSpawner.ts):
  // cross-spawn can report "spawn" successfully for an unresolvable executable
  // (it wraps it in cmd.exe) and only discover the ENOENT afterwards, which it
  // then delivers as a delayed exit/error rather than a spawn() rejection. The
  // process manager must still end up "failed" with a useful message instead
  // of believing the process is running forever.
  const spawner = new FakeProcessSpawner();
  const handle = spawner.queueSuccess();
  const manager = new ProcessManager(spawner);
  await manager.start("backend", backendOptions());
  assert.equal(manager.getState("backend").state, "running");

  handle.emitExit({ code: null, signal: null, error: "spawn C:\\bad\\python.exe ENOENT" });

  const state = manager.getState("backend");
  assert.equal(state.state, "failed");
  assert.equal(state.lastError, "Process exited unexpectedly: spawn C:\\bad\\python.exe ENOENT");
});

void test("reports a failed startup when the spawner rejects", async () => {
  const spawner = new FakeProcessSpawner();
  spawner.queueFailure(new Error("spawn python ENOENT"));
  const manager = new ProcessManager(spawner);

  const result = await manager.start("backend", backendOptions());

  assert.equal(result.outcome, "spawn-failed");
  if (result.outcome === "spawn-failed") {
    assert.ok(result.reason.includes("ENOENT"));
  }
  assert.equal(manager.getState("backend").state, "failed");
});

void test("allows retrying a start after a previous failed startup", async () => {
  const spawner = new FakeProcessSpawner();
  spawner.queueFailure(new Error("spawn python ENOENT"));
  spawner.queueSuccess();
  const manager = new ProcessManager(spawner);
  await manager.start("backend", backendOptions());

  const retry = await manager.start("backend", backendOptions());

  assert.equal(retry.outcome, "started");
  assert.equal(manager.getState("backend").state, "running");
});

void test("moves through the full stopped -> starting -> running -> stopping -> stopped lifecycle", async () => {
  const spawner = new FakeProcessSpawner();
  const handle = spawner.queueSuccess();
  const manager = new ProcessManager(spawner);
  const observedStates: string[] = [];
  manager.onDidChangeState((descriptor) => observedStates.push(descriptor.state));

  assert.equal(manager.getState("backend").state, "stopped");

  await manager.start("backend", backendOptions());
  assert.equal(manager.getState("backend").state, "running");

  await manager.stop("backend");
  assert.equal(manager.getState("backend").state, "stopping");

  handle.emitExit({ code: 0, signal: null });
  assert.equal(manager.getState("backend").state, "stopped");

  assert.deepEqual(observedStates, ["starting", "running", "stopping", "stopped"]);
});

void test("honors a stop requested while startup is still in flight", async () => {
  const spawner = new FakeProcessSpawner();
  const deferred = spawner.queueDeferred();
  const manager = new ProcessManager(spawner);

  const startPromise = manager.start("backend", backendOptions());
  assert.equal(manager.getState("backend").state, "starting");

  const stopResult = await manager.stop("backend");
  assert.equal(stopResult.outcome, "stopped");
  assert.equal(manager.getState("backend").state, "stopping");

  deferred.resolveSpawn();
  const startResult = await startPromise;

  assert.equal(startResult.outcome, "started");
  assert.equal(deferred.handle.killCallCount, 1);

  deferred.handle.emitExit({ code: 0, signal: null });
  assert.equal(manager.getState("backend").state, "stopped");
});

void test("blocks starting again while a stop is still in progress", async () => {
  const spawner = new FakeProcessSpawner();
  spawner.queueSuccess();
  const manager = new ProcessManager(spawner);
  await manager.start("backend", backendOptions());

  await manager.stop("backend");
  assert.equal(manager.getState("backend").state, "stopping");

  const secondStart = await manager.start("backend", backendOptions());

  assert.equal(secondStart.outcome, "busy");
  assert.equal(spawner.spawnCalls.length, 1);
});

void test("startAll reports which component failed without hiding the other's success", async () => {
  const spawner = new FakeProcessSpawner();
  spawner.queueFailure(new Error("spawn python ENOENT"));
  spawner.queueSuccess();
  const manager = new ProcessManager(spawner);

  const results = await manager.startAll({ backend: backendOptions(), frontend: frontendOptions() });

  assert.equal(results.backend.outcome, "spawn-failed");
  assert.equal(results.frontend.outcome, "started");
  assert.equal(manager.getState("backend").state, "failed");
  assert.equal(manager.getState("frontend").state, "running");
});

void test("startAll skips a component the caller did not provide options for", async () => {
  const spawner = new FakeProcessSpawner();
  spawner.queueSuccess();
  const manager = new ProcessManager(spawner);

  const results = await manager.startAll({ backend: backendOptions() });

  assert.equal(results.backend.outcome, "started");
  assert.equal(results.frontend.outcome, "skipped");
  assert.equal(spawner.spawnCalls.length, 1);
});

void test("stopAll is idempotent when nothing is running", async () => {
  const spawner = new FakeProcessSpawner();
  const manager = new ProcessManager(spawner);

  const first = await manager.stopAll();
  const second = await manager.stopAll();

  assert.equal(first.backend.outcome, "already-stopped");
  assert.equal(first.frontend.outcome, "already-stopped");
  assert.deepEqual(second, first);
});

void test("stopAll stops running processes and is idempotent on a second call", async () => {
  const spawner = new FakeProcessSpawner();
  const backendHandle = spawner.queueSuccess();
  const frontendHandle = spawner.queueSuccess();
  const manager = new ProcessManager(spawner);
  await manager.startAll({ backend: backendOptions(), frontend: frontendOptions() });

  const first = await manager.stopAll();
  assert.equal(first.backend.outcome, "stopped");
  assert.equal(first.frontend.outcome, "stopped");
  assert.equal(backendHandle.killCallCount, 1);
  assert.equal(frontendHandle.killCallCount, 1);

  backendHandle.emitExit({ code: 0, signal: null });
  frontendHandle.emitExit({ code: 0, signal: null });
  assert.equal(manager.getState("backend").state, "stopped");
  assert.equal(manager.getState("frontend").state, "stopped");

  const second = await manager.stopAll();
  assert.equal(second.backend.outcome, "already-stopped");
  assert.equal(second.frontend.outcome, "already-stopped");
  assert.equal(backendHandle.killCallCount, 1);
  assert.equal(frontendHandle.killCallCount, 1);
});

void test("forwards process output tagged with its kind to onDidReceiveOutput listeners", async () => {
  const spawner = new FakeProcessSpawner();
  const handle = spawner.queueSuccess();
  const manager = new ProcessManager(spawner);
  const received: Array<{ kind: string; chunk: string; stream: string }> = [];
  manager.onDidReceiveOutput((kind, chunk, stream) => received.push({ kind, chunk, stream }));

  await manager.start("backend", backendOptions());
  handle.emitOutput("Starting development server...\n", "stdout");
  handle.emitOutput("Watching for file changes\n", "stderr");

  assert.deepEqual(received, [
    { kind: "backend", chunk: "Starting development server...\n", stream: "stdout" },
    { kind: "backend", chunk: "Watching for file changes\n", stream: "stderr" }
  ]);
});

void test("stops forwarding output after the listener is disposed", async () => {
  const spawner = new FakeProcessSpawner();
  const handle = spawner.queueSuccess();
  const manager = new ProcessManager(spawner);
  const received: string[] = [];
  const subscription = manager.onDidReceiveOutput((_kind, chunk) => received.push(chunk));

  await manager.start("backend", backendOptions());
  handle.emitOutput("before dispose\n");
  subscription.dispose();
  handle.emitOutput("after dispose\n");

  assert.deepEqual(received, ["before dispose\n"]);
});

void test("backend and frontend states are tracked independently", async () => {
  const spawner = new FakeProcessSpawner();
  spawner.queueSuccess();
  spawner.queueFailure(new Error("spawn npm ENOENT"));
  const manager = new ProcessManager(spawner);

  await manager.start("backend", backendOptions());
  await manager.start("frontend", frontendOptions());

  assert.equal(manager.getState("backend").state, "running");
  assert.equal(manager.getState("frontend").state, "failed");
});

// --- Generic development services (Phase 1: ManagedProcessKind is an open ServiceId, not a fixed backend/frontend pair) ---

function workerOptions(overrides: Partial<StartProcessOptions> = {}): StartProcessOptions {
  return {
    executable: "python",
    args: ["-m", "celery", "-A", "app", "worker"],
    cwd: "/workspace/backend",
    ...overrides
  };
}

void test("with no registry argument, a manager behaves exactly as the default two-service registry", () => {
  const manager = new ProcessManager(new FakeProcessSpawner());

  assert.deepEqual(manager.getRegisteredServiceIds(), DEFAULT_SERVICE_REGISTRY.getServiceIds());
});

void test("start()/stop() work for a service id that is not part of the registry at all", async () => {
  // The registry only governs startAll/stopAll's universe - individual
  // start/stop must keep working for any id, since the state map is keyed
  // by whatever id the caller uses.
  const spawner = new FakeProcessSpawner();
  const handle = spawner.queueSuccess();
  const manager = new ProcessManager(spawner); // default registry: backend, frontend only

  const result = await manager.start("worker", workerOptions());

  assert.equal(result.outcome, "started");
  assert.equal(manager.getState("worker").state, "running");

  const stopResult = await manager.stop("worker");
  assert.equal(stopResult.outcome, "stopped");
  handle.emitExit({ code: 0, signal: null });
  assert.equal(manager.getState("worker").state, "stopped");
});

void test("a custom registry lets startAll/stopAll manage more than two services", async () => {
  const spawner = new FakeProcessSpawner();
  const backendHandle = spawner.queueSuccess();
  const frontendHandle = spawner.queueSuccess();
  const workerHandle = spawner.queueSuccess();
  const registry = new ServiceRegistry(["backend", "frontend", "worker"]);
  const manager = new ProcessManager(spawner, registry);

  assert.deepEqual(manager.getRegisteredServiceIds(), ["backend", "frontend", "worker"]);

  const results = await manager.startAll({
    backend: backendOptions(),
    frontend: frontendOptions(),
    worker: workerOptions()
  });

  assert.equal(results.backend.outcome, "started");
  assert.equal(results.frontend.outcome, "started");
  assert.equal(results.worker.outcome, "started");
  assert.equal(manager.getState("worker").state, "running");

  const stopResults = await manager.stopAll();
  assert.equal(stopResults.backend.outcome, "stopped");
  assert.equal(stopResults.frontend.outcome, "stopped");
  assert.equal(stopResults.worker.outcome, "stopped");

  backendHandle.emitExit({ code: 0, signal: null });
  frontendHandle.emitExit({ code: 0, signal: null });
  workerHandle.emitExit({ code: 0, signal: null });
  assert.equal(manager.getState("worker").state, "stopped");
});

void test("startAll with a 3-service registry still reports 'skipped' for a registered service the caller omitted", async () => {
  const spawner = new FakeProcessSpawner();
  spawner.queueSuccess();
  const registry = new ServiceRegistry(["backend", "frontend", "worker"]);
  const manager = new ProcessManager(spawner, registry);

  const results = await manager.startAll({ backend: backendOptions() });

  assert.equal(results.backend.outcome, "started");
  assert.equal(results.frontend.outcome, "skipped");
  assert.equal(results.worker.outcome, "skipped");
});

void test("a third registered service can be started and stopped independently of backend/frontend", async () => {
  const spawner = new FakeProcessSpawner();
  spawner.queueSuccess();
  const backendHandle = spawner.queueSuccess();
  const registry = new ServiceRegistry(["backend", "frontend", "worker"]);
  const manager = new ProcessManager(spawner, registry);

  await manager.start("worker", workerOptions());
  await manager.start("backend", backendOptions());
  assert.equal(manager.getState("worker").state, "running");
  assert.equal(manager.getState("backend").state, "running");

  await manager.stop("worker");
  assert.equal(manager.getState("worker").state, "stopping");
  assert.equal(manager.getState("backend").state, "running", "stopping the worker must not affect the backend");

  backendHandle.emitExit({ code: 1, signal: null });
  assert.equal(manager.getState("backend").state, "failed", "the backend's own crash is tracked independently of the worker's stop");
  assert.equal(manager.getState("worker").state, "stopping", "the worker's in-flight stop is unaffected by the backend crashing");
});
