import assert from "node:assert/strict";
import test from "node:test";

import { djangoBackendAdapter } from "../../src/adapters/djangoBackendAdapter";
import type { BackendProject } from "../../src/detection/backendDetector";
import type { DetectedProject } from "../../src/detection/projectDetector";
import type { PythonEnvironment } from "../../src/detection/pythonDetector";
import {
  planCreateApp,
  planCreateSuperuser,
  planDbShell,
  planDjangoShell,
  planDjangoTest,
  planInstallPythonDependencies,
  planMakeMigrations,
  planManagementCommand,
  planMigrate,
  planShowMigrations
} from "../../src/commands/backendOperationPlans";

function detectedProject(overrides: { backend?: BackendProject; python?: PythonEnvironment } = {}): DetectedProject {
  return {
    workspaceRootPath: "/workspace",
    backend: { selected: overrides.backend, candidates: [], diagnostics: [] },
    frontend: { candidates: [], diagnostics: [] },
    python: { selected: overrides.python, candidates: [], diagnostics: [] },
    diagnostics: []
  };
}

function backend(evidence: readonly string[] = ["manage.py"]): BackendProject {
  return { rootPath: "/workspace/backend", managePyPath: "/workspace/backend/manage.py", score: 80, evidence };
}

function python(): PythonEnvironment {
  return { executablePath: "/workspace/backend/.venv/bin/python", source: "venv", validation: "exists" };
}

for (const [name, planFn, expectedArgSuffix] of [
  ["planMakeMigrations", planMakeMigrations, ["makemigrations"]],
  ["planMigrate", planMigrate, ["migrate"]],
  ["planShowMigrations", planShowMigrations, ["showmigrations"]],
  ["planDjangoTest", planDjangoTest, ["test"]]
] as const) {
  void test(`${name} reports no-backend when nothing is detected`, () => {
    assert.equal(planFn(detectedProject(), djangoBackendAdapter).kind, "no-backend");
  });

  void test(`${name} reports no-python when backend is detected but no interpreter is`, () => {
    assert.equal(planFn(detectedProject({ backend: backend() }), djangoBackendAdapter).kind, "no-python");
  });

  void test(`${name} builds the expected manage.py command when ready`, () => {
    const plan = planFn(detectedProject({ backend: backend(), python: python() }), djangoBackendAdapter);
    assert.equal(plan.kind, "ready");
    if (plan.kind === "ready") {
      assert.deepEqual(plan.command.args, ["/workspace/backend/manage.py", ...expectedArgSuffix]);
    }
  });
}

void test("planCreateApp rejects an invalid app name before checking detection", () => {
  const plan = planCreateApp(detectedProject(), "billing app", djangoBackendAdapter);
  assert.equal(plan.kind, "invalid-name");
});

void test("planCreateApp reports no-backend for a valid name when nothing is detected", () => {
  const plan = planCreateApp(detectedProject(), "billing", djangoBackendAdapter);
  assert.equal(plan.kind, "no-backend");
});

void test("planCreateApp builds startapp for a valid name when ready", () => {
  const plan = planCreateApp(detectedProject({ backend: backend(), python: python() }), "billing", djangoBackendAdapter);
  assert.equal(plan.kind, "ready");
  if (plan.kind === "ready") {
    assert.deepEqual(plan.command.args, ["/workspace/backend/manage.py", "startapp", "billing"]);
  }
});

void test("planDjangoShell and planCreateSuperuser build interactive invocations, not captured commands", () => {
  const project = detectedProject({ backend: backend(), python: python() });

  const shellPlan = planDjangoShell(project, djangoBackendAdapter);
  assert.equal(shellPlan.kind, "ready");
  if (shellPlan.kind === "ready") {
    assert.deepEqual(shellPlan.invocation.shellArgs, ["/workspace/backend/manage.py", "shell"]);
  }

  const superuserPlan = planCreateSuperuser(project, djangoBackendAdapter);
  assert.equal(superuserPlan.kind, "ready");
  if (superuserPlan.kind === "ready") {
    assert.deepEqual(superuserPlan.invocation.shellArgs, ["/workspace/backend/manage.py", "createsuperuser"]);
  }

  const dbShellPlan = planDbShell(project, djangoBackendAdapter);
  assert.equal(dbShellPlan.kind, "ready");
  if (dbShellPlan.kind === "ready") {
    assert.deepEqual(dbShellPlan.invocation.shellArgs, ["/workspace/backend/manage.py", "dbshell"]);
  }
});

void test("planInstallPythonDependencies uses requirements.txt when present", () => {
  const plan = planInstallPythonDependencies(detectedProject({ backend: backend(["manage.py", "requirements.txt"]), python: python() }));
  assert.equal(plan.kind, "ready");
  if (plan.kind === "ready") {
    assert.deepEqual(plan.command.args, ["-m", "pip", "install", "-r", "requirements.txt"]);
  }
});

void test("planInstallPythonDependencies falls back to requirements/dev.txt", () => {
  const plan = planInstallPythonDependencies(detectedProject({ backend: backend(["manage.py", "requirements/dev.txt"]), python: python() }));
  assert.equal(plan.kind, "ready");
  if (plan.kind === "ready") {
    assert.deepEqual(plan.command.args, ["-m", "pip", "install", "-r", "requirements/dev.txt"]);
  }
});

void test("planInstallPythonDependencies refuses to guess a command for Poetry projects", () => {
  const plan = planInstallPythonDependencies(detectedProject({ backend: backend(["manage.py", "poetry.lock"]), python: python() }));
  assert.equal(plan.kind, "unsupported-dependency-manager");
  if (plan.kind === "unsupported-dependency-manager") {
    assert.equal(plan.detected, "poetry.lock");
  }
});

void test("planInstallPythonDependencies reports no-requirements-file when there is no dependency evidence at all", () => {
  const plan = planInstallPythonDependencies(detectedProject({ backend: backend(["manage.py"]), python: python() }));
  assert.equal(plan.kind, "no-requirements-file");
});

void test("planManagementCommand reports no-backend when nothing is detected", () => {
  assert.equal(planManagementCommand(detectedProject(), ["migrate"], djangoBackendAdapter).kind, "no-backend");
});

void test("planManagementCommand reports no-python when a backend is detected but no interpreter is", () => {
  assert.equal(planManagementCommand(detectedProject({ backend: backend() }), ["migrate"], djangoBackendAdapter).kind, "no-python");
});

void test("planManagementCommand runs whatever arguments were given, verbatim", () => {
  const plan = planManagementCommand(detectedProject({ backend: backend(), python: python() }), ["makemessages", "-l", "de"], djangoBackendAdapter);
  assert.equal(plan.kind, "ready");
  if (plan.kind === "ready") {
    assert.deepEqual(plan.command.args, ["/workspace/backend/manage.py", "makemessages", "-l", "de"]);
  }
});
