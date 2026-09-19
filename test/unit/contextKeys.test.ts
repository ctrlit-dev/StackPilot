import assert from "node:assert/strict";
import test from "node:test";

import { getExecuteCommandCalls, resetVscodeStubCalls } from "./support/vscodeTestStub";

import { CONTEXT_HAS_BACKEND, CONTEXT_HAS_DJANGO_BACKEND, CONTEXT_HAS_PYTHON_BACKEND } from "../../src/constants";
import type { DetectedProject, DetectedService } from "../../src/detection/detectedProject";
import { updateWorkspaceContextKeys } from "../../src/state/contextKeys";
import type { WorkspaceSelectionResult } from "../../src/state/workspaceSelectionModel";

const selection: WorkspaceSelectionResult = {
  kind: "selected",
  folder: { uri: "file:///workspace", name: "workspace", index: 0 },
  source: "single-folder"
};

function djangoService(): DetectedService {
  return {
    id: "backend",
    rootPath: "/workspace/backend",
    frameworkId: "django",
    runtime: { kind: "python", detection: { selected: undefined, candidates: [], diagnostics: [] } },
    frameworkMetadata: { kind: "django", managePyPath: "/workspace/backend/manage.py", apps: [] },
    score: 80,
    evidence: ["manage.py"]
  };
}

function fastApiService(): DetectedService {
  return {
    id: "backend",
    rootPath: "/workspace",
    frameworkId: "fastapi",
    runtime: { kind: "python", detection: { selected: undefined, candidates: [], diagnostics: [] } },
    frameworkMetadata: { kind: "fastapi", appImport: "main:app" },
    score: 80,
    evidence: ["main.py"]
  };
}

function expressService(): DetectedService {
  return {
    id: "backend",
    rootPath: "/workspace",
    frameworkId: "express",
    runtime: {
      kind: "node",
      packageManager: { kind: "detected", manager: "npm", source: "lockfile", evidence: "package-lock.json" },
      packageJsonPath: "/workspace/package.json",
      scripts: { dev: "node app.js" }
    },
    score: 80,
    evidence: ["app.js"]
  };
}

function viteService(): DetectedService {
  return {
    id: "frontend",
    rootPath: "/workspace/frontend",
    frameworkId: "vite",
    runtime: {
      kind: "node",
      packageManager: { kind: "detected", manager: "npm", source: "lockfile", evidence: "package-lock.json" },
      packageJsonPath: "/workspace/frontend/package.json",
      scripts: { dev: "vite" }
    },
    score: 90,
    evidence: ["vite.config.ts"]
  };
}

function project(services: readonly DetectedService[]): DetectedProject {
  return {
    workspaceRootPath: "/workspace",
    services,
    pythonRuntime: { selected: undefined, candidates: [], diagnostics: [] },
    diagnostics: []
  };
}

function setContextValue(key: string): unknown {
  const call = getExecuteCommandCalls().find((c) => c.args[0] === "setContext" && c.args[1] === key);
  return call?.args[2];
}

void test("Django project: hasBackend and hasDjangoBackend are both true", async () => {
  resetVscodeStubCalls();
  await updateWorkspaceContextKeys(selection, true, project([djangoService()]));

  assert.equal(setContextValue(CONTEXT_HAS_BACKEND), true);
  assert.equal(setContextValue(CONTEXT_HAS_DJANGO_BACKEND), true);
});

void test("FastAPI project: hasBackend is true, hasDjangoBackend is false", async () => {
  resetVscodeStubCalls();
  await updateWorkspaceContextKeys(selection, true, project([fastApiService()]));

  assert.equal(setContextValue(CONTEXT_HAS_BACKEND), true);
  assert.equal(setContextValue(CONTEXT_HAS_DJANGO_BACKEND), false);
});

void test("Vite-only project: hasBackend and hasDjangoBackend are both false", async () => {
  resetVscodeStubCalls();
  await updateWorkspaceContextKeys(selection, true, project([viteService()]));

  assert.equal(setContextValue(CONTEXT_HAS_BACKEND), false);
  assert.equal(setContextValue(CONTEXT_HAS_DJANGO_BACKEND), false);
});

void test("No project detected: hasDjangoBackend is false", async () => {
  resetVscodeStubCalls();
  await updateWorkspaceContextKeys(selection, true, undefined);

  assert.equal(setContextValue(CONTEXT_HAS_DJANGO_BACKEND), false);
});

// --- EXPRESS-1C: stackPilot.hasPythonBackend ---

void test("Django project: hasPythonBackend is true", async () => {
  resetVscodeStubCalls();
  await updateWorkspaceContextKeys(selection, true, project([djangoService()]));

  assert.equal(setContextValue(CONTEXT_HAS_PYTHON_BACKEND), true);
});

void test("FastAPI project: hasPythonBackend is true", async () => {
  resetVscodeStubCalls();
  await updateWorkspaceContextKeys(selection, true, project([fastApiService()]));

  assert.equal(setContextValue(CONTEXT_HAS_PYTHON_BACKEND), true);
});

void test("Express project: hasBackend is true, hasPythonBackend is false, hasDjangoBackend is false", async () => {
  resetVscodeStubCalls();
  await updateWorkspaceContextKeys(selection, true, project([expressService()]));

  assert.equal(setContextValue(CONTEXT_HAS_BACKEND), true);
  assert.equal(setContextValue(CONTEXT_HAS_PYTHON_BACKEND), false);
  assert.equal(setContextValue(CONTEXT_HAS_DJANGO_BACKEND), false);
});

void test("Vite-only project: hasPythonBackend is false", async () => {
  resetVscodeStubCalls();
  await updateWorkspaceContextKeys(selection, true, project([viteService()]));

  assert.equal(setContextValue(CONTEXT_HAS_PYTHON_BACKEND), false);
});

void test("No project detected: hasPythonBackend is false", async () => {
  resetVscodeStubCalls();
  await updateWorkspaceContextKeys(selection, true, undefined);

  assert.equal(setContextValue(CONTEXT_HAS_PYTHON_BACKEND), false);
});
