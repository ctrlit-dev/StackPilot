import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import type { DetectedProject, DetectedService } from "../../../../src/detection/detectedProject";
import type { PythonEnvironment } from "../../../../src/detection/pythonDetector";
import { COMMAND_INSTALL_PYTHON_DEPENDENCIES } from "../../../../src/constants";
import { frameworkDependencyCheck } from "../../../../src/diagnostics/checks/frameworkDependencyCheck";
import { InMemoryFileSystemProbe } from "../../fakes/inMemoryFileSystem";

const venvPath = path.resolve("pc-test-fixtures", "framework-dependency-check", "backend", ".venv");

function venvPython(): PythonEnvironment {
  return { executablePath: path.join(venvPath, "bin", "python"), source: "venv", validation: "exists", environmentPath: venvPath };
}

function pathPython(): PythonEnvironment {
  return { executablePath: "/usr/bin/python3", source: "path", validation: "exists" };
}

function djangoService(python: PythonEnvironment, evidence: readonly string[] = ["manage.py", "requirements.txt"]): DetectedService {
  return {
    id: "backend",
    rootPath: "/workspace/backend",
    frameworkId: "django",
    runtime: { kind: "python", detection: { selected: python, candidates: [python], diagnostics: [] } },
    frameworkMetadata: { kind: "django", managePyPath: "/workspace/backend/manage.py", apps: [] },
    score: 80,
    evidence
  };
}

function fastApiService(python: PythonEnvironment, evidence: readonly string[] = ["main.py", "requirements.txt"]): DetectedService {
  return {
    id: "backend",
    rootPath: "/workspace",
    frameworkId: "fastapi",
    runtime: { kind: "python", detection: { selected: python, candidates: [python], diagnostics: [] } },
    frameworkMetadata: { kind: "fastapi", appImport: "main:app" },
    score: 80,
    evidence
  };
}

function project(services: readonly DetectedService[]): DetectedProject {
  return { workspaceRootPath: "/workspace", services, pythonRuntime: { selected: undefined, candidates: [], diagnostics: [] }, diagnostics: [] };
}

void test("Django: reports nothing when django is installed in the detected venv", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(venvPath, "Lib", "site-packages", "django", "__init__.py"));
  const results = await frameworkDependencyCheck.run({ detectedProject: project([djangoService(venvPython())]), fileSystem: fs });
  assert.deepEqual(results, []);
});

void test("Django: reports django.dependency.missing with an Install Python Dependencies action when requirements.txt is present", async () => {
  const fs = new InMemoryFileSystemProbe();
  const results = await frameworkDependencyCheck.run({ detectedProject: project([djangoService(venvPython())]), fileSystem: fs });

  assert.equal(results.length, 1);
  assert.equal(results[0].code, "django.dependency.missing");
  assert.equal(results[0].severity, "warning");
  assert.equal(results[0].serviceId, "backend");
  assert.deepEqual(results[0].action, { label: "Install Python Dependencies", commandId: COMMAND_INSTALL_PYTHON_DEPENDENCIES });
});

void test("Django: omits the action when there is no requirements.txt to install from", async () => {
  const fs = new InMemoryFileSystemProbe();
  const results = await frameworkDependencyCheck.run({ detectedProject: project([djangoService(venvPython(), ["manage.py"])]), fileSystem: fs });

  assert.equal(results.length, 1);
  assert.equal(results[0].code, "django.dependency.missing");
  assert.equal(results[0].action, undefined);
});

void test("FastAPI: reports nothing when fastapi is installed in the detected venv", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(venvPath, "Lib", "site-packages", "fastapi", "__init__.py"));
  const results = await frameworkDependencyCheck.run({ detectedProject: project([fastApiService(venvPython())]), fileSystem: fs });
  assert.deepEqual(results, []);
});

void test("FastAPI: reports fastapi.dependency.missing with no action, even with requirements.txt present (Install Python Dependencies does not support FastAPI)", async () => {
  const fs = new InMemoryFileSystemProbe();
  const results = await frameworkDependencyCheck.run({ detectedProject: project([fastApiService(venvPython())]), fileSystem: fs });

  assert.equal(results.length, 1);
  assert.equal(results[0].code, "fastapi.dependency.missing");
  assert.equal(results[0].severity, "warning");
  assert.equal(results[0].action, undefined);
});

void test("framework isolation: a FastAPI service never emits django.dependency.missing", async () => {
  const fs = new InMemoryFileSystemProbe();
  const results = await frameworkDependencyCheck.run({ detectedProject: project([fastApiService(venvPython())]), fileSystem: fs });
  assert.equal(results.some((result) => result.code === "django.dependency.missing"), false);
});

void test("framework isolation: a Django service never emits fastapi.dependency.missing", async () => {
  const fs = new InMemoryFileSystemProbe();
  const results = await frameworkDependencyCheck.run({ detectedProject: project([djangoService(venvPython())]), fileSystem: fs });
  assert.equal(results.some((result) => result.code === "fastapi.dependency.missing"), false);
});

void test("skips the check when the Python environment is not a venv (e.g. resolved from PATH)", async () => {
  const fs = new InMemoryFileSystemProbe();
  const results = await frameworkDependencyCheck.run({ detectedProject: project([djangoService(pathPython())]), fileSystem: fs });
  assert.deepEqual(results, []);
});

void test("reports nothing when no backend was detected at all", async () => {
  const fs = new InMemoryFileSystemProbe();
  const results = await frameworkDependencyCheck.run({ detectedProject: project([]), fileSystem: fs });
  assert.deepEqual(results, []);
});
