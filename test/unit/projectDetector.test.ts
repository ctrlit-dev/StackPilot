import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import { DEFAULT_CONFIGURATION } from "../../src/config/configurationModel";
import { detectProject } from "../../src/detection/projectDetector";
import { InMemoryFileSystemProbe } from "./fakes/inMemoryFileSystem";

const workspaceRoot = path.resolve("pc-test-fixtures", "project-detector");

void test("wires backend detection into the Python venv search path", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "backend", "manage.py"))
    .addFile(path.join(workspaceRoot, "backend", ".venv", "Scripts", "python.exe"))
    .addFile(path.join(workspaceRoot, "frontend", "package.json"), JSON.stringify({ scripts: { dev: "vite" } }));

  const result = await detectProject(fs, workspaceRoot, DEFAULT_CONFIGURATION);

  assert.equal(result.backend.selected?.rootPath, path.join(workspaceRoot, "backend"));
  assert.equal(result.frontend.selected?.rootPath, path.join(workspaceRoot, "frontend"));
  assert.equal(result.python.selected?.executablePath, path.join(workspaceRoot, "backend", ".venv", "Scripts", "python.exe"));
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

  assert.equal(result.backend.selected, undefined);
  assert.equal(result.frontend.selected, undefined);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.includes("outside the workspace")));
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.includes("Invalid package.json")));
});

void test("wires backend detection into Django app detection", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "backend", "manage.py"))
    .addFile(path.join(workspaceRoot, "backend", "billing", "apps.py"));

  const result = await detectProject(fs, workspaceRoot, DEFAULT_CONFIGURATION);

  assert.deepEqual(result.djangoApps?.map((app) => app.name), ["billing"]);
});

void test("reports no Django apps when no backend was detected", async () => {
  const fs = new InMemoryFileSystemProbe();
  const result = await detectProject(fs, workspaceRoot, DEFAULT_CONFIGURATION);
  assert.deepEqual(result.djangoApps, []);
});

void test("reports nothing detected for a completely empty workspace", async () => {
  const fs = new InMemoryFileSystemProbe();

  const result = await detectProject(fs, workspaceRoot, DEFAULT_CONFIGURATION);

  assert.equal(result.backend.selected, undefined);
  assert.equal(result.frontend.selected, undefined);
  assert.equal(result.python.selected, undefined);
});
