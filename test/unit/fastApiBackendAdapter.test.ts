import assert from "node:assert/strict";
import test from "node:test";

import { fastApiBackendAdapter } from "../../src/adapters/fastApiBackendAdapter";
import type { DetectedService } from "../../src/detection/detectedProject";
import type { PythonEnvironment } from "../../src/detection/pythonDetector";

function python(): PythonEnvironment {
  return { executablePath: "/workspace/.venv/bin/python", source: "venv", validation: "exists" };
}

function backendService(appImport: string): DetectedService {
  return {
    id: "backend",
    rootPath: "/workspace",
    frameworkId: "fastapi",
    runtime: { kind: "python", detection: { candidates: [], selected: python(), diagnostics: [] } },
    frameworkMetadata: { kind: "fastapi", appImport },
    score: 80,
    evidence: ["main.py"]
  };
}

void test("fastApiBackendAdapter identifies itself as the 'fastapi' framework, distinct from any ServiceId", () => {
  assert.equal(fastApiBackendAdapter.id, "fastapi");
});

void test("builds the uvicorn start command from the detected python, appImport, host and port", () => {
  const command = fastApiBackendAdapter.buildStartCommand(backendService("main:app"), "127.0.0.1", 8000);

  assert.equal(command.executable, "/workspace/.venv/bin/python");
  assert.deepEqual(command.args, ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000"]);
  assert.equal(command.cwd, "/workspace");
  assert.equal(command.expectedPort, 8000);
});

void test("uses the app-package appImport form verbatim (app.main:app)", () => {
  const command = fastApiBackendAdapter.buildStartCommand(backendService("app.main:app"), "127.0.0.1", 8000);

  assert.deepEqual(command.args, ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"]);
});

void test("never substitutes a different host than the one configured", () => {
  const command = fastApiBackendAdapter.buildStartCommand(backendService("main:app"), "0.0.0.0", 8080);

  assert.deepEqual(command.args, ["-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]);
});

void test("uses shell:false, structured argv - never a composed command string", () => {
  const command = fastApiBackendAdapter.buildStartCommand(backendService("main:app"), "127.0.0.1", 8000);

  assert.ok(Array.isArray(command.args));
  assert.ok(command.args.every((arg) => typeof arg === "string"));
  assert.equal((command as { shell?: boolean }).shell, undefined);
});

void test("resolves the python interpreter from the service's own runtime, not an externally-passed parameter (EXPRESS-1B)", () => {
  const command = fastApiBackendAdapter.buildStartCommand(backendService("main:app"), "127.0.0.1", 8000);

  assert.equal(command.executable, "/workspace/.venv/bin/python");
});
