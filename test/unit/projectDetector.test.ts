import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import { djangoBackendDetection } from "../../src/adapters/djangoBackendDetection";
import { viteFrontendDetection } from "../../src/adapters/viteFrontendDetection";
import { DEFAULT_CONFIGURATION, type StackPilotConfiguration } from "../../src/config/configurationModel";
import { getBackendService, getDjangoMetadata, getFrontendService } from "../../src/detection/detectedProject";
import { detectProject as detectProjectWithFrameworkDetection } from "../../src/detection/projectDetector";
import type { FileSystemProbe } from "../../src/detection/fileSystem";
import { InMemoryFileSystemProbe } from "./fakes/inMemoryFileSystem";

/** Wires the real Django/Vite detection, unchanged - projectDetector.ts itself is generic composition, framework-neutral. */
function detectProject(fs: FileSystemProbe, workspaceRootPath: string, configuration: StackPilotConfiguration) {
  return detectProjectWithFrameworkDetection(fs, workspaceRootPath, configuration, djangoBackendDetection, viteFrontendDetection);
}

const workspaceRoot = path.resolve("pc-test-fixtures", "project-detector");

void test("wires backend detection into the Python venv search path", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "backend", "manage.py"))
    .addFile(path.join(workspaceRoot, "backend", ".venv", "Scripts", "python.exe"))
    .addFile(path.join(workspaceRoot, "frontend", "package.json"), JSON.stringify({ scripts: { dev: "vite" } }));

  const result = await detectProject(fs, workspaceRoot, DEFAULT_CONFIGURATION);

  assert.equal(getBackendService(result)?.rootPath, path.join(workspaceRoot, "backend"));
  assert.equal(getFrontendService(result)?.rootPath, path.join(workspaceRoot, "frontend"));
  assert.equal(result.pythonRuntime.selected?.executablePath, path.join(workspaceRoot, "backend", ".venv", "Scripts", "python.exe"));
});

void test("aggregates diagnostics from every sub-detector", async () => {
  const outsidePath = path.resolve(workspaceRoot, "..", "outside", "manage.py");
  const fs = new InMemoryFileSystemProbe()
    .addFile(outsidePath)
    .addFile(path.join(workspaceRoot, "frontend", "package.json"), "not json");

  const result = await detectProject(fs, workspaceRoot, {
    ...DEFAULT_CONFIGURATION,
    backendManagePy: "../outside/manage.py"
  });

  assert.equal(getBackendService(result), undefined);
  assert.equal(getFrontendService(result), undefined);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.includes("outside the workspace")));
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.includes("Invalid package.json")));
});

void test("wires backend detection into Django app detection", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "backend", "manage.py"))
    .addFile(path.join(workspaceRoot, "backend", "billing", "apps.py"));

  const result = await detectProject(fs, workspaceRoot, DEFAULT_CONFIGURATION);

  assert.deepEqual(
    getDjangoMetadata(getBackendService(result))?.apps.map((app) => app.name),
    ["billing"]
  );
});

void test("reports no Django apps when no backend was detected", async () => {
  const fs = new InMemoryFileSystemProbe();
  const result = await detectProject(fs, workspaceRoot, DEFAULT_CONFIGURATION);
  assert.equal(getBackendService(result), undefined);
  assert.equal(getDjangoMetadata(getBackendService(result)), undefined);
});

void test("reports nothing detected for a completely empty workspace", async () => {
  const fs = new InMemoryFileSystemProbe();

  const result = await detectProject(fs, workspaceRoot, DEFAULT_CONFIGURATION);

  assert.equal(getBackendService(result), undefined);
  assert.equal(getFrontendService(result), undefined);
  assert.equal(result.pythonRuntime.selected, undefined);
});
