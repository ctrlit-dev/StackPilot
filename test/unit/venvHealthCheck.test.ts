import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import { checkVenvHealth } from "../../src/detection/venvHealthCheck";
import { InMemoryFileSystemProbe } from "./fakes/inMemoryFileSystem";

const venvPath = path.resolve("pc-test-fixtures", "venv-health", "backend", ".venv");

void test("reports missing when the venv directory does not exist at all", async () => {
  const fs = new InMemoryFileSystemProbe();
  const health = await checkVenvHealth(fs, venvPath);
  assert.deepEqual(health, { kind: "missing" });
});

void test("reports healthy for a Windows-style venv with its interpreter present", async () => {
  const interpreterPath = path.join(venvPath, "Scripts", "python.exe");
  const fs = new InMemoryFileSystemProbe().addFile(interpreterPath);
  const health = await checkVenvHealth(fs, venvPath);
  assert.deepEqual(health, { kind: "healthy", interpreterPath });
});

void test("reports healthy for a POSIX-style venv with its interpreter present", async () => {
  const interpreterPath = path.join(venvPath, "bin", "python");
  const fs = new InMemoryFileSystemProbe().addFile(interpreterPath);
  const health = await checkVenvHealth(fs, venvPath);
  assert.deepEqual(health, { kind: "healthy", interpreterPath });
});

void test("reports broken when the venv directory exists but its interpreter is missing", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(venvPath, "pyvenv.cfg"));
  const health = await checkVenvHealth(fs, venvPath);
  assert.deepEqual(health, { kind: "broken" });
});
