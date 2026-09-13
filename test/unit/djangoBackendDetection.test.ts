import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import { djangoBackendDetection } from "../../src/adapters/djangoBackendDetection";
import { InMemoryFileSystemProbe } from "./fakes/inMemoryFileSystem";

const workspaceRoot = path.resolve("pc-test-fixtures", "django-backend-detection");

void test("djangoBackendDetection identifies itself as the 'django' framework, distinct from any ServiceId", () => {
  assert.equal(djangoBackendDetection.frameworkId, "django");
});

void test("finds manage.py at the workspace root as an entry point candidate", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(workspaceRoot, "manage.py"));

  const result = await djangoBackendDetection.detect(fs, workspaceRoot, "backend/manage.py");

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.rootPath, workspaceRoot);
  assert.equal(result.candidates[0]?.frameworkEntryPath, path.join(workspaceRoot, "manage.py"));
  assert.equal(result.candidates[0]?.evidence, "manage.py");
});

void test("uses the configured entry point override as a candidate", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(workspaceRoot, "server", "manage.py"));

  const result = await djangoBackendDetection.detect(fs, workspaceRoot, "server/manage.py");

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.rootPath, path.join(workspaceRoot, "server"));
});

void test("reports no candidates and no diagnostics when manage.py is nowhere to be found", async () => {
  const fs = new InMemoryFileSystemProbe();

  const result = await djangoBackendDetection.detect(fs, workspaceRoot, "backend/manage.py");

  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.diagnostics, []);
});

void test("reports a diagnostic for a configured override that escapes the workspace", async () => {
  const fs = new InMemoryFileSystemProbe();

  const result = await djangoBackendDetection.detect(fs, workspaceRoot, "../outside/manage.py");

  assert.deepEqual(result.candidates, []);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.includes("outside the workspace")));
});
