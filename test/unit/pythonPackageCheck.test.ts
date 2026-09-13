import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import { isDjangoInstalled } from "../../src/detection/pythonPackageCheck";
import { InMemoryFileSystemProbe } from "./fakes/inMemoryFileSystem";

const venvPath = path.resolve("pc-test-fixtures", "python-package-check", "backend", ".venv");

void test("reports false when nothing is installed", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(venvPath, "pyvenv.cfg"));
  assert.equal(await isDjangoInstalled(fs, venvPath), false);
});

void test("detects Django in a Windows-style venv layout", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(venvPath, "Lib", "site-packages", "django", "__init__.py"));
  assert.equal(await isDjangoInstalled(fs, venvPath), true);
});

void test("detects Django in a POSIX-style venv layout by locating the pythonX.Y directory", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(venvPath, "lib", "python3.13", "site-packages", "django", "__init__.py"));
  assert.equal(await isDjangoInstalled(fs, venvPath), true);
});

void test("does not mistake an unrelated lib/ subdirectory for a Python version folder", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(venvPath, "lib", "some-native-lib", "site-packages", "django", "__init__.py"));
  assert.equal(await isDjangoInstalled(fs, venvPath), false);
});
