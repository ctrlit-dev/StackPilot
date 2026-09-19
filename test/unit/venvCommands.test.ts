import assert from "node:assert/strict";
import test from "node:test";

import { fakeOutputChannel, resetVscodeStubCalls } from "./support/vscodeTestStub";

import { DEFAULT_CONFIGURATION } from "../../src/config/configurationModel";
import type { CommandContext } from "../../src/commands/commandContext";
import { runCreateVirtualEnvironment } from "../../src/commands/venvCommands";
import type { DetectedProject, DetectedService } from "../../src/detection/detectedProject";
import type { FileSystemProbe } from "../../src/detection/fileSystem";
import { ProjectStateStore } from "../../src/state/projectState";

/**
 * Narrowly scoped to the EXPRESS-1C guard only (docs/EXPRESS_1C_CODE_TRUTH_AND_IMPLEMENTATION_PLAN.md §15)
 * - `venvCommands.ts` has no prior unit test coverage (its full happy path
 * needs real process-spawn/filesystem plumbing this file does not attempt
 * to fake), so this file proves exactly one thing: a Node-runtime backend
 * is refused before any Python lookup or filesystem mutation, without
 * regressing the Python-family path's ability to proceed past this guard.
 */

function expressBackendService(): DetectedService {
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

function djangoBackendService(): DetectedService {
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

function project(services: readonly DetectedService[]): DetectedProject {
  return {
    workspaceRootPath: "/workspace",
    services,
    pythonRuntime: { selected: undefined, candidates: [], diagnostics: [] },
    diagnostics: []
  };
}

/** Records every call instead of touching a real filesystem - proves (or disproves) that venv health/creation logic was ever reached past the new guard. */
function countingFileSystem(): { probe: FileSystemProbe; callCount: () => number } {
  let calls = 0;
  const probe: FileSystemProbe = {
    fileExists: () => {
      calls += 1;
      return Promise.resolve(false);
    },
    directoryExists: () => {
      calls += 1;
      return Promise.resolve(false);
    },
    readTextFile: () => {
      calls += 1;
      return Promise.reject(new Error("not used in this test"));
    },
    realPath: () => {
      calls += 1;
      return Promise.resolve(undefined);
    },
    listDirectoryNames: () => {
      calls += 1;
      return Promise.resolve([]);
    }
  };
  return { probe, callCount: () => calls };
}

function buildContext(detectedProject: DetectedProject, fileSystem: FileSystemProbe) {
  const projectState = new ProjectStateStore();
  projectState.setState({
    selection: { kind: "selected", folder: { uri: "file:///workspace", name: "workspace", index: 0 }, source: "single-folder" },
    trusted: true,
    detectedProject,
    configuration: DEFAULT_CONFIGURATION
  });

  const outputChannel = fakeOutputChannel();
  const context = { outputChannel, projectState, fileSystem } as unknown as CommandContext;
  return { context, outputChannel };
}

void test("EXPRESS-1C: runCreateVirtualEnvironment refuses a Node-runtime backend (Express) - no Python lookup, no filesystem mutation", async () => {
  resetVscodeStubCalls();
  const { probe, callCount } = countingFileSystem();
  const { context, outputChannel } = buildContext(project([expressBackendService()]), probe);

  const result = await runCreateVirtualEnvironment(context);

  assert.equal(result, false);
  assert.ok(outputChannel.lines.some((line) => line.includes("not a Python project")));
  assert.equal(callCount(), 0, "no venv health check, no Python lookup, no filesystem access should ever be reached for a Node-runtime backend");
});

void test("EXPRESS-1C regression: a Django (Python-runtime) backend is not blocked by the new guard - it proceeds past it", async () => {
  resetVscodeStubCalls();
  const { probe, callCount } = countingFileSystem();
  const { context, outputChannel } = buildContext(project([djangoBackendService()]), probe);

  const result = await runCreateVirtualEnvironment(context);

  // No usable Python on PATH/candidates in this fake, so it still ends in
  // failure overall - but via the PRE-EXISTING "no interpreter found" path,
  // never the new Node-runtime guard's message, and only after actually
  // touching the filesystem (proving it was not short-circuited).
  assert.equal(result, false);
  assert.ok(!outputChannel.lines.some((line) => line.includes("not a Python project")));
  assert.ok(callCount() > 0, "the Python-family path must still reach venv health checking");
});
