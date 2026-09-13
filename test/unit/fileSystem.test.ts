import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import { isRealPathInsideWorkspace } from "../../src/detection/fileSystem";
import { InMemoryFileSystemProbe } from "./fakes/inMemoryFileSystem";

const workspaceRoot = path.resolve("pc-test-fixtures", "file-system");

void test("accepts a plain file inside the workspace", async () => {
  const filePath = path.join(workspaceRoot, "manage.py");
  const fs = new InMemoryFileSystemProbe().addFile(filePath);

  assert.equal(await isRealPathInsideWorkspace(fs, workspaceRoot, filePath), true);
});

void test("rejects a symlink that resolves outside the workspace", async () => {
  const outsideTarget = path.resolve(workspaceRoot, "..", "outside", "manage.py");
  const linkPath = path.join(workspaceRoot, "manage.py");
  const fs = new InMemoryFileSystemProbe().addFile(outsideTarget).addSymlink(linkPath, outsideTarget);

  assert.equal(await isRealPathInsideWorkspace(fs, workspaceRoot, linkPath), false);
});

void test("accepts a symlink that resolves to a target still inside the workspace", async () => {
  const realFile = path.join(workspaceRoot, "actual", "manage.py");
  const linkPath = path.join(workspaceRoot, "manage.py");
  const fs = new InMemoryFileSystemProbe().addFile(realFile).addSymlink(linkPath, realFile);

  assert.equal(await isRealPathInsideWorkspace(fs, workspaceRoot, linkPath), true);
});

void test("treats a symlink loop as not resolvable rather than recursing forever", async () => {
  const linkA = path.join(workspaceRoot, "a");
  const linkB = path.join(workspaceRoot, "b");
  const fs = new InMemoryFileSystemProbe().addSymlink(linkA, linkB).addSymlink(linkB, linkA);

  assert.equal(await isRealPathInsideWorkspace(fs, workspaceRoot, linkA), false);
});

void test("rejects a candidate when the workspace root itself cannot be resolved", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(workspaceRoot, "manage.py"));

  const unrelatedRoot = path.resolve("pc-test-fixtures", "never-registered");
  assert.equal(await isRealPathInsideWorkspace(fs, unrelatedRoot, path.join(workspaceRoot, "manage.py")), false);
});
