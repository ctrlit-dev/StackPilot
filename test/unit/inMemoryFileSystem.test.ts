import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import { InMemoryFileSystemProbe } from "./fakes/inMemoryFileSystem";

const root = path.resolve("pc-test-fixtures", "in-memory-fs");

void test("listDirectoryNames returns an empty array for a directory that does not exist", async () => {
  const fs = new InMemoryFileSystemProbe();
  assert.deepEqual(await fs.listDirectoryNames(path.join(root, "lib")), []);
});

void test("listDirectoryNames lists both file and subdirectory children", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(root, "lib", "python3.13", "site-packages", "django", "__init__.py"))
    .addFile(path.join(root, "lib", "readme.txt"));

  const names = await fs.listDirectoryNames(path.join(root, "lib"));
  assert.deepEqual(names.sort(), ["python3.13", "readme.txt"]);
});

void test("listDirectoryNames does not include grandchildren", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(root, "lib", "python3.13", "site-packages", "django", "__init__.py"));

  const names = await fs.listDirectoryNames(root);
  assert.deepEqual(names, ["lib"]);
});
