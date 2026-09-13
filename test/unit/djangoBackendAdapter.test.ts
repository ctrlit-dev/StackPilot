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

void test("builds makemigrations", () => {
  const command = djangoBackendAdapter.buildMakeMigrationsCommand(python(), backend());
  assert.equal(command.executable, "/workspace/backend/.venv/bin/python");
  assert.deepEqual(command.args, ["/workspace/backend/manage.py", "makemigrations"]);
  assert.equal(command.cwd, "/workspace/backend");
});

void test("builds migrate", () => {
  const command = djangoBackendAdapter.buildMigrateCommand(python(), backend());
  assert.deepEqual(command.args, ["/workspace/backend/manage.py", "migrate"]);
});

void test("builds showmigrations", () => {
  const command = djangoBackendAdapter.buildShowMigrationsCommand(python(), backend());
  assert.deepEqual(command.args, ["/workspace/backend/manage.py", "showmigrations"]);
});

void test("builds test", () => {
  const command = djangoBackendAdapter.buildTestCommand(python(), backend());
  assert.deepEqual(command.args, ["/workspace/backend/manage.py", "test"]);
});

void test("builds an arbitrary management command verbatim (the 'Run Management Command...' / migrate --check escape hatch)", () => {
  const command = djangoBackendAdapter.buildManagementCommand(python(), backend(), ["makemessages", "-l", "de"]);
  assert.deepEqual(command.args, ["/workspace/backend/manage.py", "makemessages", "-l", "de"]);
  assert.equal(command.cwd, "/workspace/backend");
});

void test("builds startapp with the given app name", () => {
  const command = djangoBackendAdapter.buildStartAppCommand(python(), backend(), "billing");
  assert.deepEqual(command.args, ["/workspace/backend/manage.py", "startapp", "billing"]);
});

void test("validateAppName accepts a normal app name", () => {
  assert.deepEqual(djangoBackendAdapter.validateAppName("billing"), { valid: true });
});

void test("validateAppName rejects an invalid identifier with a reason", () => {
  const result = djangoBackendAdapter.validateAppName("billing app");
  assert.equal(result.valid, false);
});

void test("validateAppName rejects reserved Python keywords", () => {
  const result = djangoBackendAdapter.validateAppName("class");
  assert.equal(result.valid, false);
});

void test("builds the shell invocation as a real shell, not a captured command", () => {
  const invocation = djangoBackendAdapter.buildShellInvocation(python(), backend());
  assert.equal(invocation.shellPath, "/workspace/backend/.venv/bin/python");
  assert.deepEqual(invocation.shellArgs, ["/workspace/backend/manage.py", "shell"]);
  assert.equal(invocation.cwd, "/workspace/backend");
});

void test("builds the database shell invocation as a real shell, not a captured command", () => {
  const invocation = djangoBackendAdapter.buildDatabaseShellInvocation(python(), backend());
  assert.deepEqual(invocation.shellArgs, ["/workspace/backend/manage.py", "dbshell"]);
});

void test("builds the createsuperuser invocation as a real shell, not a captured command", () => {
  const invocation = djangoBackendAdapter.buildCreateSuperuserInvocation(python(), backend());
  assert.deepEqual(invocation.shellArgs, ["/workspace/backend/manage.py", "createsuperuser"]);
});
