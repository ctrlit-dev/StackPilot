import assert from "node:assert/strict";
import test from "node:test";

import type { BackendProject } from "../../src/detection/backendDetector";
import type { PythonEnvironment } from "../../src/detection/pythonDetector";
import {
  buildCreateAppCommand,
  buildCreateSuperuserInvocation,
  buildDjangoShellInvocation,
  buildDjangoTestCommand,
  buildMakeMigrationsCommand,
  buildMigrateCommand,
  buildShowMigrationsCommand
} from "../../src/execution/djangoManageCommand";

function python(): PythonEnvironment {
  return { executablePath: "/workspace/backend/.venv/bin/python", source: "venv", validation: "exists" };
}

function backend(): BackendProject {
  return { rootPath: "/workspace/backend", managePyPath: "/workspace/backend/manage.py", score: 80, evidence: ["manage.py"] };
}

void test("builds makemigrations", () => {
  const command = buildMakeMigrationsCommand(python(), backend());
  assert.equal(command.executable, "/workspace/backend/.venv/bin/python");
  assert.deepEqual(command.args, ["/workspace/backend/manage.py", "makemigrations"]);
  assert.equal(command.cwd, "/workspace/backend");
});

void test("builds migrate", () => {
  const command = buildMigrateCommand(python(), backend());
  assert.deepEqual(command.args, ["/workspace/backend/manage.py", "migrate"]);
});

void test("builds showmigrations", () => {
  const command = buildShowMigrationsCommand(python(), backend());
  assert.deepEqual(command.args, ["/workspace/backend/manage.py", "showmigrations"]);
});

void test("builds test", () => {
  const command = buildDjangoTestCommand(python(), backend());
  assert.deepEqual(command.args, ["/workspace/backend/manage.py", "test"]);
});

void test("builds startapp with the given app name", () => {
  const command = buildCreateAppCommand(python(), backend(), "billing");
  assert.deepEqual(command.args, ["/workspace/backend/manage.py", "startapp", "billing"]);
});

void test("builds the shell invocation as a real shell, not a captured command", () => {
  const invocation = buildDjangoShellInvocation(python(), backend());
  assert.equal(invocation.shellPath, "/workspace/backend/.venv/bin/python");
  assert.deepEqual(invocation.shellArgs, ["/workspace/backend/manage.py", "shell"]);
  assert.equal(invocation.cwd, "/workspace/backend");
});

void test("builds the createsuperuser invocation as a real shell, not a captured command", () => {
  const invocation = buildCreateSuperuserInvocation(python(), backend());
  assert.deepEqual(invocation.shellArgs, ["/workspace/backend/manage.py", "createsuperuser"]);
});
