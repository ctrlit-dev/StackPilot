import assert from "node:assert/strict";
import test from "node:test";

import type { DetectedProject, DetectedService } from "../../../../src/detection/detectedProject";
import type { PythonEnvironment } from "../../../../src/detection/pythonDetector";
import { pythonEnvironmentCheck } from "../../../../src/diagnostics/checks/pythonEnvironmentCheck";
import { InMemoryFileSystemProbe } from "../../fakes/inMemoryFileSystem";

function venvPython(): PythonEnvironment {
  return { executablePath: "/workspace/backend/.venv/bin/python", source: "venv", validation: "exists", environmentPath: "/workspace/backend/.venv" };
}

function djangoBackendService(python: PythonEnvironment | undefined): DetectedService {
  return {
    id: "backend",
    rootPath: "/workspace/backend",
    frameworkId: "django",
    runtime: { kind: "python", detection: { selected: python, candidates: python === undefined ? [] : [python], diagnostics: [] } },
    frameworkMetadata: { kind: "django", managePyPath: "/workspace/backend/manage.py", apps: [] },
    score: 80,
    evidence: ["manage.py"]
  };
}

function viteFrontendService(): DetectedService {
  return {
    id: "frontend",
    rootPath: "/workspace/frontend",
    frameworkId: "vite",
    runtime: {
      kind: "node",
      packageManager: { kind: "detected", manager: "npm", source: "lockfile", evidence: "package-lock.json" },
      packageJsonPath: "/workspace/frontend/package.json",
      scripts: {}
    },
    score: 90,
    evidence: ["package.json"]
  };
}

function project(services: readonly DetectedService[]): DetectedProject {
  return { workspaceRootPath: "/workspace", services, pythonRuntime: { selected: undefined, candidates: [], diagnostics: [] }, diagnostics: [] };
}

const fileSystem = new InMemoryFileSystemProbe();

void test("reports python.interpreter.missing when the detected backend has no usable Python runtime", async () => {
  const results = await pythonEnvironmentCheck.run({ detectedProject: project([djangoBackendService(undefined)]), fileSystem });

  assert.equal(results.length, 1);
  assert.equal(results[0].code, "python.interpreter.missing");
  assert.equal(results[0].severity, "error");
  assert.equal(results[0].serviceId, "backend");
});

void test("reports nothing when the detected backend has a usable Python interpreter", async () => {
  const results = await pythonEnvironmentCheck.run({ detectedProject: project([djangoBackendService(venvPython())]), fileSystem });
  assert.deepEqual(results, []);
});

void test("does not warn about a missing Python interpreter for a pure Node/Vite project with no backend at all", async () => {
  const results = await pythonEnvironmentCheck.run({ detectedProject: project([viteFrontendService()]), fileSystem });
  assert.deepEqual(results, []);
});

void test("reports nothing when no workspace/project is selected at all", async () => {
  const results = await pythonEnvironmentCheck.run({ detectedProject: undefined, fileSystem });
  assert.deepEqual(results, []);
});
