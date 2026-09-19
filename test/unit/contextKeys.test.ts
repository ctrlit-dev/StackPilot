import assert from "node:assert/strict";
import test from "node:test";

import { getExecuteCommandCalls, resetVscodeStubCalls } from "./support/vscodeTestStub";

import { CONTEXT_HAS_BACKEND, CONTEXT_HAS_DJANGO_BACKEND } from "../../src/constants";
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
    frameworkMetadata: { kind: "fastapi", appImport: "main:app" },
    score: 80,
    evidence: ["main.py"]
  };
}

function viteService(): DetectedService {
  return {
    id: "frontend",
    rootPath: "/workspace/frontend",
    frameworkId: "vite",
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
