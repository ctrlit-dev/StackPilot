import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import { deriveFastApiAppImport, fastApiBackendDetection } from "../../src/adapters/fastApiBackendDetection";
import { InMemoryFileSystemProbe } from "./fakes/inMemoryFileSystem";

const workspaceRoot = path.resolve("pc-test-fixtures", "fastapi-backend-detection");

void test("fastApiBackendDetection identifies itself as the 'fastapi' framework, distinct from any ServiceId", () => {
  assert.equal(fastApiBackendDetection.frameworkId, "fastapi");
});

void test("finds main.py as a candidate when both dependency evidence and application evidence are present", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "main.py"), "from fastapi import FastAPI\napp = FastAPI()\n")
    .addFile(path.join(workspaceRoot, "requirements.txt"), "fastapi\nuvicorn\n");

  const result = await fastApiBackendDetection.detect(fs, workspaceRoot, "backend/manage.py");

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.rootPath, workspaceRoot);
  assert.equal(result.candidates[0]?.frameworkEntryPath, path.join(workspaceRoot, "main.py"));
  assert.equal(result.candidates[0]?.evidence, "main.py");
});

void test("finds app/main.py as a candidate, rooted at the workspace root (not app/)", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "app", "main.py"), "import fastapi\napp = fastapi.FastAPI()\n")
    .addFile(path.join(workspaceRoot, "pyproject.toml"), '[tool.poetry.dependencies]\nfastapi = "^0.110"\n');

  const result = await fastApiBackendDetection.detect(fs, workspaceRoot, "backend/manage.py");

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.rootPath, workspaceRoot);
  assert.equal(result.candidates[0]?.frameworkEntryPath, path.join(workspaceRoot, "app", "main.py"));
  assert.equal(result.candidates[0]?.evidence, "app/main.py");
});

void test("does not report a candidate when only the filename matches, with no dependency or application evidence", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(workspaceRoot, "main.py"), "print('hello')\n");

  const result = await fastApiBackendDetection.detect(fs, workspaceRoot, "backend/manage.py");

  assert.deepEqual(result.candidates, []);
});

void test("does not report a candidate when the entry file instantiates FastAPI but no dependency file confirms it", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(workspaceRoot, "main.py"), "from fastapi import FastAPI\napp = FastAPI()\n");

  const result = await fastApiBackendDetection.detect(fs, workspaceRoot, "backend/manage.py");

  assert.deepEqual(result.candidates, []);
});

void test("does not report a candidate when a dependency file mentions fastapi but the entry file never instantiates it", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "main.py"), "from fastapi import FastAPI\n# app is never created\n")
    .addFile(path.join(workspaceRoot, "requirements.txt"), "fastapi\n");

  const result = await fastApiBackendDetection.detect(fs, workspaceRoot, "backend/manage.py");

  assert.deepEqual(result.candidates, []);
});

void test("reports no candidates and no diagnostics when neither entry point exists", async () => {
  const fs = new InMemoryFileSystemProbe();

  const result = await fastApiBackendDetection.detect(fs, workspaceRoot, "backend/manage.py");

  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.diagnostics, []);
});

void test("rejects an entry point candidate that escapes the workspace through a symlink", async () => {
  const outsideEntry = path.resolve(workspaceRoot, "..", "outside", "main.py");
  const fs = new InMemoryFileSystemProbe()
    .addFile(outsideEntry, "from fastapi import FastAPI\napp = FastAPI()\n")
    .addSymlink(path.join(workspaceRoot, "main.py"), outsideEntry)
    .addFile(path.join(workspaceRoot, "requirements.txt"), "fastapi\n");

  const result = await fastApiBackendDetection.detect(fs, workspaceRoot, "backend/manage.py");

  assert.deepEqual(result.candidates, []);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.includes("escapes the workspace through a symlink")));
});

void test("dependency evidence is case-insensitive", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "main.py"), "from fastapi import FastAPI\napp = FastAPI()\n")
    .addFile(path.join(workspaceRoot, "requirements.txt"), "FastAPI==0.110.0\n");

  const result = await fastApiBackendDetection.detect(fs, workspaceRoot, "backend/manage.py");

  assert.equal(result.candidates.length, 1);
});

void test("deriveFastApiAppImport resolves a flat main.py to 'main:app'", () => {
  const appImport = deriveFastApiAppImport(workspaceRoot, path.join(workspaceRoot, "main.py"));
  assert.equal(appImport, "main:app");
});

void test("deriveFastApiAppImport resolves app/main.py to 'app.main:app'", () => {
  const appImport = deriveFastApiAppImport(workspaceRoot, path.join(workspaceRoot, "app", "main.py"));
  assert.equal(appImport, "app.main:app");
});
