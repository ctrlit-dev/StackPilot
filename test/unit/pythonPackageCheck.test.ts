import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import { isPythonPackageInstalled } from "../../src/detection/pythonPackageCheck";
import { InMemoryFileSystemProbe } from "./fakes/inMemoryFileSystem";

const venvPath = path.resolve("pc-test-fixtures", "python-package-check", "backend", ".venv");

void test("reports false when nothing is installed", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(venvPath, "pyvenv.cfg"));
  assert.equal(await isPythonPackageInstalled(fs, venvPath, "django"), false);
});

void test("detects a package in a Windows-style venv layout", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(venvPath, "Lib", "site-packages", "django", "__init__.py"));
  assert.equal(await isPythonPackageInstalled(fs, venvPath, "django"), true);
});

void test("detects a package in a POSIX-style venv layout by locating the pythonX.Y directory", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(venvPath, "lib", "python3.13", "site-packages", "django", "__init__.py"));
  assert.equal(await isPythonPackageInstalled(fs, venvPath, "django"), true);
});

void test("does not mistake an unrelated lib/ subdirectory for a Python version folder", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(venvPath, "lib", "some-native-lib", "site-packages", "django", "__init__.py"));
  assert.equal(await isPythonPackageInstalled(fs, venvPath, "django"), false);
});

void test("detects the fastapi package the same way as django, given its own name", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(venvPath, "Lib", "site-packages", "fastapi", "__init__.py"));
  assert.equal(await isPythonPackageInstalled(fs, venvPath, "fastapi"), true);
});

void test("does not report django as installed just because a different package (fastapi) is present", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(venvPath, "Lib", "site-packages", "fastapi", "__init__.py"));
  assert.equal(await isPythonPackageInstalled(fs, venvPath, "django"), false);
});

void test("reports missing when the named package is simply not there", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(venvPath, "Lib", "site-packages", "django", "__init__.py"));
  assert.equal(await isPythonPackageInstalled(fs, venvPath, "fastapi"), false);
});

void test("rejects an unsafe package identifier instead of joining it into a filesystem path", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(venvPath, "..", "outside", "__init__.py"));
  assert.equal(await isPythonPackageInstalled(fs, venvPath, "../outside"), false);
  assert.equal(await isPythonPackageInstalled(fs, venvPath, "Django"), false);
  assert.equal(await isPythonPackageInstalled(fs, venvPath, ""), false);
});
