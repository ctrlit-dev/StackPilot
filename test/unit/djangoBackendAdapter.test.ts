import assert from "node:assert/strict";
import test from "node:test";

import { djangoBackendAdapter } from "../../src/adapters/djangoBackendAdapter";
import type { BackendProject } from "../../src/detection/backendDetector";
import type { PythonEnvironment } from "../../src/detection/pythonDetector";

function python(): PythonEnvironment {
  return { executablePath: "/workspace/backend/.venv/bin/python", source: "venv", validation: "exists" };
}

function backend(): BackendProject {
  return { rootPath: "/workspace/backend", managePyPath: "/workspace/backend/manage.py", score: 80, evidence: ["manage.py"] };
}

void test("djangoBackendAdapter identifies itself as the 'django' framework, distinct from any ServiceId", () => {
  assert.equal(djangoBackendAdapter.id, "django");
});

void test("builds the Django runserver command with the detected python, manage.py, host and port", () => {
  const command = djangoBackendAdapter.buildStartCommand(python(), backend(), "127.0.0.1", 8000);

  assert.equal(command.executable, "/workspace/backend/.venv/bin/python");
  assert.deepEqual(command.args, ["/workspace/backend/manage.py", "runserver", "127.0.0.1:8000"]);
  assert.equal(command.cwd, "/workspace/backend");
  assert.equal(command.expectedPort, 8000);
});

void test("never substitutes a different host than the one configured", () => {
  const command = djangoBackendAdapter.buildStartCommand(python(), backend(), "0.0.0.0", 8080);

  assert.deepEqual(command.args, ["/workspace/backend/manage.py", "runserver", "0.0.0.0:8080"]);
});
