import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import type { BackendFrameworkDetection } from "../../src/adapters/backendFrameworkDetection";
import { djangoBackendDetection } from "../../src/adapters/djangoBackendDetection";
import { expressBackendDetection } from "../../src/adapters/expressBackendDetection";
import { fastApiBackendDetection } from "../../src/adapters/fastApiBackendDetection";
import type { FrontendFrameworkDetection } from "../../src/adapters/frontendFrameworkDetection";
import { nextFrontendDetection } from "../../src/adapters/nextFrontendDetection";
import { viteFrontendDetection } from "../../src/adapters/viteFrontendDetection";
import { DEFAULT_CONFIGURATION, type StackPilotConfiguration } from "../../src/config/configurationModel";
import { getBackendService, getDjangoMetadata, getFastApiMetadata, getFrontendService, getNodeRuntime } from "../../src/detection/detectedProject";
import { detectProject as detectProjectWithFrameworkDetection } from "../../src/detection/projectDetector";
import type { FileSystemProbe } from "../../src/detection/fileSystem";
import { InMemoryFileSystemProbe } from "./fakes/inMemoryFileSystem";

/**
 * Wires the real Django/Vite+Next.js detection, unchanged - projectDetector.ts
 * itself is generic composition, framework-neutral. NEXTJS-1B: the frontend
 * parameter mirrors real production wiring (`extension.ts`) - both Vite AND
 * Next.js registered together - not just Vite alone, so every existing
 * fixture below also proves it stays correctly unrecognized-as-Next.js.
 */
function detectProject(
  fs: FileSystemProbe,
  workspaceRootPath: string,
  configuration: StackPilotConfiguration,
  backendFrameworkDetections: readonly BackendFrameworkDetection[] = [djangoBackendDetection],
  frontendFrameworkDetections: readonly FrontendFrameworkDetection[] = [viteFrontendDetection, nextFrontendDetection]
) {
  return detectProjectWithFrameworkDetection(fs, workspaceRootPath, configuration, backendFrameworkDetections, frontendFrameworkDetections);
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

// ---- NEXTJS-1B: Next.js frontend wiring --------------------------------

void test("wires Next.js detection into the generalized frontend service using the SAME ServiceId 'frontend' as Vite", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(
    path.join(workspaceRoot, "frontend", "package.json"),
    JSON.stringify({ dependencies: { next: "16.3.5" }, scripts: { dev: "next dev", build: "next build", start: "next start" } })
  );

  const result = await detectProject(fs, workspaceRoot, DEFAULT_CONFIGURATION);

  const frontendService = getFrontendService(result);
  assert.equal(frontendService?.id, "frontend");
  assert.equal(frontendService?.frameworkId, "next");
  assert.equal(frontendService?.runtime?.kind, "node");
});

void test("a Django backend and a Next.js frontend coexist as two independent services, each with its own framework/runtime", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "backend", "manage.py"))
    .addFile(
      path.join(workspaceRoot, "frontend", "package.json"),
      JSON.stringify({ dependencies: { next: "16.3.5" }, scripts: { dev: "next dev" } })
    );

  const result = await detectProject(fs, workspaceRoot, DEFAULT_CONFIGURATION);

  assert.equal(getBackendService(result)?.frameworkId, "django");
  assert.equal(getFrontendService(result)?.frameworkId, "next");
  assert.equal(result.services.length, 2);
});

// ---- NEXTJS-1B §9/§25: Express / Next.js custom-server collision -------

void test("A. pure Express (no dependencies.next) is still detected as a backend, unaffected by the new exclusion guard", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "app.js"), 'const express = require("express");\nconst app = express();\n')
    .addFile(path.join(workspaceRoot, "package.json"), JSON.stringify({ dependencies: { express: "^4.19.2" }, scripts: { dev: "node app.js" } }));

  const result = await detectProject(fs, workspaceRoot, DEFAULT_CONFIGURATION, [djangoBackendDetection, fastApiBackendDetection, expressBackendDetection]);

  assert.equal(getBackendService(result)?.frameworkId, "express");
  assert.equal(getFrontendService(result), undefined);
});

void test("B. a Next.js custom server (dependencies.express AND dependencies.next, plus a real Express entry file) is registered as exactly one 'frontend' service, never also a 'backend' service", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(
      path.join(workspaceRoot, "server.js"),
      'const express = require("express");\nconst next = require("next");\nconst app = express();\nconst nextApp = next({ dev: true });\napp.all("*", nextApp.getRequestHandler());\n'
    )
    .addFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ dependencies: { express: "^4.19.2", next: "16.3.5" }, scripts: { dev: "node server.js" } })
    );

  const result = await detectProject(fs, workspaceRoot, DEFAULT_CONFIGURATION, [djangoBackendDetection, fastApiBackendDetection, expressBackendDetection]);

  assert.equal(getBackendService(result), undefined);
  const frontendService = getFrontendService(result);
  assert.equal(frontendService?.id, "frontend");
  assert.equal(frontendService?.frameworkId, "next");
  assert.equal(result.services.length, 1);
});

void test("C. an Express backend at the root and an independent Next.js frontend nested under frontend/ are both detected as separate services", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "app.js"), 'const express = require("express");\nconst app = express();\n')
    .addFile(path.join(workspaceRoot, "package.json"), JSON.stringify({ dependencies: { express: "^4.19.2" }, scripts: { dev: "node app.js" } }))
    .addFile(
      path.join(workspaceRoot, "frontend", "package.json"),
      JSON.stringify({ dependencies: { next: "16.3.5" }, scripts: { dev: "next dev" } })
    );

  const result = await detectProject(fs, workspaceRoot, DEFAULT_CONFIGURATION, [djangoBackendDetection, fastApiBackendDetection, expressBackendDetection]);

  assert.equal(getBackendService(result)?.frameworkId, "express");
  assert.equal(getFrontendService(result)?.rootPath, path.join(workspaceRoot, "frontend"));
  assert.equal(getFrontendService(result)?.frameworkId, "next");
  assert.equal(result.services.length, 2);
});
