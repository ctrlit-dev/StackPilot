import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import type { BackendFrameworkDetection } from "../../src/adapters/backendFrameworkDetection";
import { djangoBackendDetection } from "../../src/adapters/djangoBackendDetection";
import { DEFAULT_CONFIGURATION, type StackPilotConfiguration } from "../../src/config/configurationModel";
import { detectBackendProject as detectBackendProjectWithFrameworkDetection } from "../../src/detection/backendDetector";
import type { FileSystemProbe } from "../../src/detection/fileSystem";
import { InMemoryFileSystemProbe } from "./fakes/inMemoryFileSystem";

const workspaceRoot = path.resolve("pc-test-fixtures", "backend-detector");

function configuration(overrides: Partial<StackPilotConfiguration> = {}): StackPilotConfiguration {
  return { ...DEFAULT_CONFIGURATION, ...overrides };
}

/** Every existing test below exercises real Django detection, unchanged - see the delegation test at the bottom for proof that this is injected, not hard-coded. */
function detectBackendProject(fs: FileSystemProbe, workspaceRootPath: string, config: StackPilotConfiguration) {
  return detectBackendProjectWithFrameworkDetection(fs, workspaceRootPath, config, djangoBackendDetection);
}

void test("detects a Django project at the workspace root", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(workspaceRoot, "manage.py"));

  const result = await detectBackendProject(fs, workspaceRoot, configuration());

  assert.equal(result.selected?.rootPath, workspaceRoot);
  assert.equal(result.selected?.frameworkEntryPath, path.join(workspaceRoot, "manage.py"));
});

void test("detects a Django project in a ./backend subdirectory", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(workspaceRoot, "backend", "manage.py"));

  const result = await detectBackendProject(fs, workspaceRoot, configuration());

  assert.equal(result.selected?.rootPath, path.join(workspaceRoot, "backend"));
});

void test("reports no backend when manage.py is missing", async () => {
  const fs = new InMemoryFileSystemProbe();

  const result = await detectBackendProject(fs, workspaceRoot, configuration());

  assert.equal(result.selected, undefined);
  assert.deepEqual(result.candidates, []);
});

void test("prefers the candidate with stronger evidence when multiple manage.py files exist", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "manage.py"))
    .addFile(path.join(workspaceRoot, "backend", "manage.py"))
    .addFile(path.join(workspaceRoot, "backend", "requirements.txt"))
    .addFile(path.join(workspaceRoot, "backend", "pyproject.toml"));

  const result = await detectBackendProject(fs, workspaceRoot, configuration());

  assert.equal(result.selected?.rootPath, path.join(workspaceRoot, "backend"));
  assert.equal(result.candidates.length, 2);
});

void test("uses a configured manage.py override", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(workspaceRoot, "server", "manage.py"));

  const result = await detectBackendProject(fs, workspaceRoot, configuration({ backendManagePy: "server/manage.py" }));

  assert.equal(result.selected?.rootPath, path.join(workspaceRoot, "server"));
});

void test("ignores a configured manage.py override that escapes the workspace", async () => {
  const outsidePath = path.resolve(workspaceRoot, "..", "outside", "manage.py");
  const fs = new InMemoryFileSystemProbe().addFile(outsidePath);

  const result = await detectBackendProject(fs, workspaceRoot, configuration({ backendManagePy: "../outside/manage.py" }));

  assert.equal(result.selected, undefined);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.includes("outside the workspace")));
});

void test("ignores a manage.py candidate that is a symlink escaping the workspace", async () => {
  const outsideTarget = path.resolve(workspaceRoot, "..", "outside", "manage.py");
  const fs = new InMemoryFileSystemProbe()
    .addFile(outsideTarget)
    .addSymlink(path.join(workspaceRoot, "manage.py"), outsideTarget);

  const result = await detectBackendProject(fs, workspaceRoot, configuration());

  assert.equal(result.selected, undefined);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.includes("escapes the workspace through a symlink")));
});

void test("detects a Django project at a workspace root containing spaces and Unicode characters", async () => {
  const unicodeWorkspaceRoot = path.resolve("pc-test-fixtures", "Projekt Ördner 日本語");
  const fs = new InMemoryFileSystemProbe().addFile(path.join(unicodeWorkspaceRoot, "backend", "manage.py"));

  const result = await detectBackendProject(fs, unicodeWorkspaceRoot, configuration());

  assert.equal(result.selected?.rootPath, path.join(unicodeWorkspaceRoot, "backend"));
});

void test("detectBackendProject has no knowledge of 'manage.py' itself - it only scores and selects whatever the injected framework detection finds", async () => {
  // Proves detectBackendProject is framework-detection-driven, not Django-
  // specific itself: a fake framework detection that recognizes none of
  // Django's markers, but reports its own entry point at a completely
  // different path, must still be reflected verbatim in the resulting
  // BackendProject.
  const fakeDetection: BackendFrameworkDetection = {
    frameworkId: "fake-framework",
    detect: (_fs, workspaceRootPath) => Promise.resolve({
      candidates: [
        {
          rootPath: path.join(workspaceRootPath, "api"),
          frameworkEntryPath: path.join(workspaceRootPath, "api", "app.py"),
          evidence: "app.py"
        }
      ],
      diagnostics: []
    })
  };
  const fs = new InMemoryFileSystemProbe();

  const result = await detectBackendProjectWithFrameworkDetection(fs, workspaceRoot, configuration(), fakeDetection);

  assert.equal(result.selected?.rootPath, path.join(workspaceRoot, "api"));
  assert.equal(result.selected?.frameworkEntryPath, path.join(workspaceRoot, "api", "app.py"));
  assert.deepEqual(result.selected?.evidence, ["app.py"]);
});
