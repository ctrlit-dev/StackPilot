import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import type { BackendFrameworkDetection } from "../../src/adapters/backendFrameworkDetection";
import { djangoBackendDetection } from "../../src/adapters/djangoBackendDetection";
import { expressBackendDetection } from "../../src/adapters/expressBackendDetection";
import { fastApiBackendDetection } from "../../src/adapters/fastApiBackendDetection";
import { viteFrontendDetection } from "../../src/adapters/viteFrontendDetection";
import { DEFAULT_CONFIGURATION, type StackPilotConfiguration } from "../../src/config/configurationModel";
import { getBackendService, getDjangoMetadata, getFastApiMetadata, getFrontendService, getNodeRuntime } from "../../src/detection/detectedProject";
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

void test("wires Express detection into the generalized backend service using the SAME ServiceId 'backend', with a Node runtime (EXPRESS-1B: fixes the pre-EXPRESS-1B 'backend => Python runtime' assumption)", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "app.js"), 'const express = require("express");\nconst app = express();\n')
    .addFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ dependencies: { express: "^4.19.2" }, scripts: { dev: "node app.js", start: "node app.js" } })
    )
    .addFile(path.join(workspaceRoot, "package-lock.json"));

  const result = await detectProject(fs, workspaceRoot, DEFAULT_CONFIGURATION, [
    djangoBackendDetection,
    fastApiBackendDetection,
    expressBackendDetection
  ]);

  const backendService = getBackendService(result);
  assert.equal(backendService?.id, "backend");
  assert.equal(backendService?.frameworkId, "express");
  assert.equal(backendService?.runtime?.kind, "node");
  assert.equal(getDjangoMetadata(backendService), undefined);
  assert.equal(getFastApiMetadata(backendService), undefined);
});

void test("a flat Express backend's own package.json does not also re-qualify as a spurious duplicate frontend service at the same root (EXPRESS-1B discovery)", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "app.js"), 'const express = require("express");\nconst app = express();\n')
    .addFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ dependencies: { express: "^4.19.2" }, scripts: { dev: "node app.js" } })
    )
    .addFile(path.join(workspaceRoot, "package-lock.json"));

  const result = await detectProject(fs, workspaceRoot, DEFAULT_CONFIGURATION, [
    djangoBackendDetection,
    fastApiBackendDetection,
    expressBackendDetection
  ]);

  assert.equal(getBackendService(result)?.frameworkId, "express");
  assert.equal(getFrontendService(result), undefined);
  assert.equal(result.services.length, 1);
});

void test("a real nested Vite frontend alongside an Express backend is still detected as its own frontend service (not suppressed)", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "app.js"), 'const express = require("express");\nconst app = express();\n')
    .addFile(path.join(workspaceRoot, "package.json"), JSON.stringify({ dependencies: { express: "^4.19.2" }, scripts: { dev: "node app.js" } }))
    .addFile(path.join(workspaceRoot, "frontend", "package.json"), JSON.stringify({ scripts: { dev: "vite" } }))
    .addFile(path.join(workspaceRoot, "frontend", "vite.config.ts"));

  const result = await detectProject(fs, workspaceRoot, DEFAULT_CONFIGURATION, [
    djangoBackendDetection,
    fastApiBackendDetection,
    expressBackendDetection
  ]);

  assert.equal(getBackendService(result)?.frameworkId, "express");
  assert.equal(getFrontendService(result)?.rootPath, path.join(workspaceRoot, "frontend"));
  assert.equal(getFrontendService(result)?.frameworkId, "vite");
  assert.equal(result.services.length, 2);
});

void test("attaches the detected package manager and package.json scripts to an Express backend's Node runtime", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "app.js"), 'const express = require("express");\nconst app = express();\n')
    .addFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ dependencies: { express: "^4.19.2" }, scripts: { dev: "nodemon app.js", start: "node app.js", test: "jest" } })
    )
    .addFile(path.join(workspaceRoot, "pnpm-lock.yaml"));

  const result = await detectProject(fs, workspaceRoot, DEFAULT_CONFIGURATION, [
    djangoBackendDetection,
    fastApiBackendDetection,
    expressBackendDetection
  ]);

  const runtime = getNodeRuntime(getBackendService(result));
  assert.equal(runtime?.packageManager.kind, "detected");
  assert.equal(runtime?.packageManager.kind === "detected" ? runtime.packageManager.manager : undefined, "pnpm");
  assert.deepEqual(runtime?.scripts, { dev: "nodemon app.js", start: "node app.js", test: "jest" });
});

void test("Django backend still receives a Python runtime after EXPRESS-1B's conditional runtime assembly (regression)", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(workspaceRoot, "backend", "manage.py"));

  const result = await detectProject(fs, workspaceRoot, DEFAULT_CONFIGURATION, [
    djangoBackendDetection,
    fastApiBackendDetection,
    expressBackendDetection
  ]);

  assert.equal(getBackendService(result)?.frameworkId, "django");
  assert.equal(getBackendService(result)?.runtime?.kind, "python");
});

void test("FastAPI backend still receives a Python runtime after EXPRESS-1B's conditional runtime assembly (regression)", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "main.py"), "from fastapi import FastAPI\napp = FastAPI()\n")
    .addFile(path.join(workspaceRoot, "requirements.txt"), "fastapi\nuvicorn\n");

  const result = await detectProject(fs, workspaceRoot, DEFAULT_CONFIGURATION, [
    djangoBackendDetection,
    fastApiBackendDetection,
    expressBackendDetection
  ]);

  assert.equal(getBackendService(result)?.frameworkId, "fastapi");
  assert.equal(getBackendService(result)?.runtime?.kind, "python");
});

void test("first-match-wins: a workspace with both manage.py and Express evidence resolves to Django, not Express", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "backend", "manage.py"))
    .addFile(path.join(workspaceRoot, "app.js"), 'const express = require("express");\nconst app = express();\n')
    .addFile(path.join(workspaceRoot, "package.json"), JSON.stringify({ dependencies: { express: "^4.19.2" } }));

  const result = await detectProject(fs, workspaceRoot, DEFAULT_CONFIGURATION, [
    djangoBackendDetection,
    fastApiBackendDetection,
    expressBackendDetection
  ]);

  assert.equal(getBackendService(result)?.frameworkId, "django");
});
