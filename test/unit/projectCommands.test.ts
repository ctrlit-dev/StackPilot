import assert from "node:assert/strict";
import test from "node:test";

import { fakeOutputChannel, getOpenExternalCalls, resetVscodeStubCalls } from "./support/vscodeTestStub";

import { DEFAULT_CONFIGURATION } from "../../src/config/configurationModel";
import type { CommandContext } from "../../src/commands/commandContext";
import { openAdmin } from "../../src/commands/projectCommands";
import type { DetectedProject, DetectedService } from "../../src/detection/detectedProject";
import type { FrontendUrlTracker } from "../../src/execution/frontendUrlTracker";
import type { ManagedProcessDescriptor, ProcessManager } from "../../src/execution/processManager";
import { ProjectStateStore } from "../../src/state/projectState";

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

function project(services: readonly DetectedService[]): DetectedProject {
  return {
    workspaceRootPath: "/workspace",
    services,
    pythonRuntime: { selected: undefined, candidates: [], diagnostics: [] },
    diagnostics: []
  };
}

function buildContext(detectedProject: DetectedProject | undefined, backendState: ManagedProcessDescriptor["state"], expectedPort = 8000) {
  const projectState = new ProjectStateStore();
  projectState.setState({
    selection: { kind: "selected", folder: { uri: "file:///workspace", name: "workspace", index: 0 }, source: "single-folder" },
    trusted: true,
    detectedProject,
    configuration: DEFAULT_CONFIGURATION
  });

  const backendDescriptor: ManagedProcessDescriptor = { kind: "backend", state: backendState, expectedPort };
  const outputChannel = fakeOutputChannel();

  const context = {
    outputChannel,
    projectState,
    processManager: { getState: () => backendDescriptor } as unknown as ProcessManager,
    frontendUrlTracker: { getUrl: () => undefined } as unknown as FrontendUrlTracker
  } as unknown as CommandContext;

  return { context, outputChannel };
}

void test("Django backend running: Open Admin opens the /admin/ URL exactly once", async () => {
  resetVscodeStubCalls();
  const { context } = buildContext(project([djangoService()]), "running");

  await openAdmin(context);

  const calls = getOpenExternalCalls();
  assert.equal(calls.length, 1);
  const uri = calls[0].args[0] as { toString(): string };
  assert.equal(uri.toString(), "http://127.0.0.1:8000/admin/");
});

void test("FastAPI backend running: Open Admin does not open anything", async () => {
  resetVscodeStubCalls();
  const { context, outputChannel } = buildContext(project([fastApiService()]), "running");

  await openAdmin(context);

  assert.equal(getOpenExternalCalls().length, 0);
  assert.ok(outputChannel.lines.some((line) => line.includes("no Django project was detected")));
});

void test("No backend detected: Open Admin does not open anything", async () => {
  resetVscodeStubCalls();
  const { context } = buildContext(undefined, "stopped");

  await openAdmin(context);

  assert.equal(getOpenExternalCalls().length, 0);
});

void test("Django backend not running: Open Admin does not open anything", async () => {
  resetVscodeStubCalls();
  const { context, outputChannel } = buildContext(project([djangoService()]), "stopped");

  await openAdmin(context);

  assert.equal(getOpenExternalCalls().length, 0);
  assert.ok(outputChannel.lines.some((line) => line.includes("backend is not currently running")));
});
