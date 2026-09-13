import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import type { DetectedProject, DetectedService } from "../../../../src/detection/detectedProject";
import type { PackageManagerDetection } from "../../../../src/detection/packageManagerDetector";
import { COMMAND_INSTALL_FRONTEND_DEPENDENCIES } from "../../../../src/constants";
import { nodeDependenciesCheck } from "../../../../src/diagnostics/checks/nodeDependenciesCheck";
import { InMemoryFileSystemProbe } from "../../fakes/inMemoryFileSystem";

const workspaceRoot = path.resolve("pc-test-fixtures", "node-dependencies-check");
const frontendRoot = path.join(workspaceRoot, "frontend");

const detectedPackageManager: PackageManagerDetection = { kind: "detected", manager: "npm", source: "lockfile", evidence: "package-lock.json" };

function frontendService(packageManager: PackageManagerDetection): DetectedService {
  return {
    id: "frontend",
    rootPath: frontendRoot,
    frameworkId: "vite",
    runtime: { kind: "node", packageManager, packageJsonPath: path.join(frontendRoot, "package.json"), scripts: {} },
    score: 90,
    evidence: ["package.json"]
  };
}

function project(services: readonly DetectedService[]): DetectedProject {
  return { workspaceRootPath: workspaceRoot, services, pythonRuntime: { selected: undefined, candidates: [], diagnostics: [] }, diagnostics: [] };
}

void test("reports nothing when no frontend was detected", async () => {
  const fs = new InMemoryFileSystemProbe();
  const results = await nodeDependenciesCheck.run({ detectedProject: project([]), fileSystem: fs });
  assert.deepEqual(results, []);
});

void test("reports nothing when node_modules exists at the frontend service's own root and the package manager is resolved", async () => {
  const fs = new InMemoryFileSystemProbe().addDirectory(path.join(frontendRoot, "node_modules"));
  const results = await nodeDependenciesCheck.run({ detectedProject: project([frontendService(detectedPackageManager)]), fileSystem: fs });
  assert.deepEqual(results, []);
});

void test("reports node.dependencies.missing with an Install Frontend Dependencies action when the package manager is resolved", async () => {
  const fs = new InMemoryFileSystemProbe();
  const results = await nodeDependenciesCheck.run({ detectedProject: project([frontendService(detectedPackageManager)]), fileSystem: fs });

  assert.equal(results.length, 1);
  assert.equal(results[0].code, "node.dependencies.missing");
  assert.equal(results[0].severity, "warning");
  assert.equal(results[0].serviceId, "frontend");
  assert.deepEqual(results[0].action, { label: "Install Frontend Dependencies", commandId: COMMAND_INSTALL_FRONTEND_DEPENDENCIES });
});

void test("checks node_modules at the frontend service's own root, not at the workspace root", async () => {
  const fs = new InMemoryFileSystemProbe().addDirectory(path.join(workspaceRoot, "node_modules"));
  const results = await nodeDependenciesCheck.run({ detectedProject: project([frontendService(detectedPackageManager)]), fileSystem: fs });

  assert.equal(
    results.some((result) => result.code === "node.dependencies.missing"),
    true,
    "node_modules at the workspace root must not count for a frontend service rooted elsewhere"
  );
});

void test("reports node.dependencies.missing with no action, plus node.packageManager.blocked with the exact existing reason, when the package manager is missing", async () => {
  const missing: PackageManagerDetection = { kind: "missing", reason: "No supported package-manager lockfile was found." };
  const fs = new InMemoryFileSystemProbe();
  const results = await nodeDependenciesCheck.run({ detectedProject: project([frontendService(missing)]), fileSystem: fs });

  const dependenciesResult = results.find((result) => result.code === "node.dependencies.missing");
  assert.notEqual(dependenciesResult, undefined);
  assert.equal(dependenciesResult?.action, undefined);

  const blockedResult = results.find((result) => result.code === "node.packageManager.blocked");
  assert.equal(blockedResult?.message, "No supported package-manager lockfile was found.");
});

void test("reports node.packageManager.blocked naming every ambiguous candidate when multiple lockfiles are found", async () => {
  const ambiguous: PackageManagerDetection = {
    kind: "ambiguous",
    candidates: [
      { manager: "npm", lockfile: "package-lock.json" },
      { manager: "pnpm", lockfile: "pnpm-lock.yaml" }
    ]
  };
  const fs = new InMemoryFileSystemProbe().addDirectory(path.join(frontendRoot, "node_modules"));
  const results = await nodeDependenciesCheck.run({ detectedProject: project([frontendService(ambiguous)]), fileSystem: fs });

  assert.equal(results.length, 1);
  assert.equal(results[0].code, "node.packageManager.blocked");
  assert.match(results[0].message, /npm/);
  assert.match(results[0].message, /pnpm/);
});
