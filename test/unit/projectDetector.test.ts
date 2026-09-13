import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import type { BackendFrameworkDetection } from "../../src/adapters/backendFrameworkDetection";
import { djangoBackendDetection } from "../../src/adapters/djangoBackendDetection";
import { fastApiBackendDetection } from "../../src/adapters/fastApiBackendDetection";
import { viteFrontendDetection } from "../../src/adapters/viteFrontendDetection";
import { DEFAULT_CONFIGURATION, type StackPilotConfiguration } from "../../src/config/configurationModel";
import { getBackendService, getDjangoMetadata, getFastApiMetadata, getFrontendService } from "../../src/detection/detectedProject";
import { detectProject as detectProjectWithFrameworkDetection } from "../../src/detection/projectDetector";
import type { FileSystemProbe } from "../../src/detection/fileSystem";
import { InMemoryFileSystemProbe } from "./fakes/inMemoryFileSystem";

/** Wires the real Django/Vite detection, unchanged - projectDetector.ts itself is generic composition, framework-neutral. */
function detectProject(
  fs: FileSystemProbe,
  workspaceRootPath: string,
  configuration: StackPilotConfiguration,
  backendFrameworkDetections: readonly BackendFrameworkDetection[] = [djangoBackendDetection]
) {
  return detectProjectWithFrameworkDetection(fs, workspaceRootPath, configuration, backendFrameworkDetections, viteFrontendDetection);
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

void test("wires FastAPI detection into the generalized backend service using the SAME ServiceId 'backend'", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "main.py"), "from fastapi import FastAPI\napp = FastAPI()\n")
    .addFile(path.join(workspaceRoot, "requirements.txt"), "fastapi\nuvicorn\n");

  const result = await detectProject(fs, workspaceRoot, DEFAULT_CONFIGURATION, [djangoBackendDetection, fastApiBackendDetection]);

  const backendService = getBackendService(result);
  assert.equal(backendService?.id, "backend");
  assert.equal(backendService?.frameworkId, "fastapi");
  assert.equal(backendService?.runtime?.kind, "python");
  assert.equal(getFastApiMetadata(backendService)?.appImport, "main:app");
  assert.equal(getDjangoMetadata(backendService), undefined);
});

void test("first-match-wins: a workspace with both manage.py and FastAPI evidence resolves to Django, not FastAPI", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "backend", "manage.py"))
    .addFile(path.join(workspaceRoot, "main.py"), "from fastapi import FastAPI\napp = FastAPI()\n")
    .addFile(path.join(workspaceRoot, "requirements.txt"), "fastapi\n");

  const result = await detectProject(fs, workspaceRoot, DEFAULT_CONFIGURATION, [djangoBackendDetection, fastApiBackendDetection]);

  assert.equal(getBackendService(result)?.frameworkId, "django");
});

void test("FastAPI is not detected when only the entry file's filename matches, without dependency or application evidence", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(workspaceRoot, "main.py"), "print('not fastapi')\n");

  const result = await detectProject(fs, workspaceRoot, DEFAULT_CONFIGURATION, [djangoBackendDetection, fastApiBackendDetection]);

  assert.equal(getBackendService(result), undefined);
});
