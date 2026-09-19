import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import type { DetectedProject, DetectedService } from "../../../../src/detection/detectedProject";
import type { PackageManagerDetection } from "../../../../src/detection/packageManagerDetector";
import { nodeBackendDependenciesCheck } from "../../../../src/diagnostics/checks/nodeBackendDependenciesCheck";
import { InMemoryFileSystemProbe } from "../../fakes/inMemoryFileSystem";

const workspaceRoot = path.resolve("pc-test-fixtures", "node-backend-dependencies-check");
const backendRoot = workspaceRoot;
const frontendRoot = path.join(workspaceRoot, "frontend");

const detectedPackageManager: PackageManagerDetection = { kind: "detected", manager: "npm", source: "lockfile", evidence: "package-lock.json" };

function expressBackendService(packageManager: PackageManagerDetection): DetectedService {
  return {
    id: "backend",
    rootPath: backendRoot,
    frameworkId: "express",
    runtime: { kind: "node", packageManager, packageJsonPath: path.join(backendRoot, "package.json"), scripts: { dev: "node app.js" } },
    score: 80,
    evidence: ["app.js"]
  };
}

function djangoBackendService(): DetectedService {
  return {
    id: "backend",
    rootPath: backendRoot,
    frameworkId: "django",
    runtime: {
      kind: "python",
      detection: { selected: { executablePath: "/workspace/.venv/bin/python", source: "venv", validation: "exists" }, candidates: [], diagnostics: [] }
    },
    frameworkMetadata: { kind: "django", managePyPath: path.join(backendRoot, "manage.py"), apps: [] },
    score: 80,
    evidence: ["manage.py"]
  };
}

function viteFrontendService(packageManager: PackageManagerDetection = detectedPackageManager): DetectedService {
  return {
    id: "frontend",
    rootPath: frontendRoot,
    frameworkId: "vite",
    runtime: { kind: "node", packageManager, packageJsonPath: path.join(frontendRoot, "package.json"), scripts: { dev: "vite" } },
    score: 90,
    evidence: ["package.json", "vite.config.ts"]
  };
}

function project(services: readonly DetectedService[]): DetectedProject {
  return { workspaceRootPath: workspaceRoot, services, pythonRuntime: { selected: undefined, candidates: [], diagnostics: [] }, diagnostics: [] };
}

void test("reports nothing when no backend was detected", async () => {
  const fs = new InMemoryFileSystemProbe();
  const results = await nodeBackendDependenciesCheck.run({ detectedProject: project([]), fileSystem: fs });
  assert.deepEqual(results, []);
});

void test("reports nothing for a Python-runtime backend (Django) - this check is Node-runtime only", async () => {
  const fs = new InMemoryFileSystemProbe();
  const results = await nodeBackendDependenciesCheck.run({ detectedProject: project([djangoBackendService()]), fileSystem: fs });
  assert.deepEqual(results, []);
});

void test("reports nothing when node_modules exists at the Express backend's own root and the package manager is resolved", async () => {
  const fs = new InMemoryFileSystemProbe().addDirectory(path.join(backendRoot, "node_modules"));
  const results = await nodeBackendDependenciesCheck.run({ detectedProject: project([expressBackendService(detectedPackageManager)]), fileSystem: fs });
  assert.deepEqual(results, []);
});

void test("reports node.dependencies.missing for a detected Express backend, with NO action (Install Backend Dependencies is not implemented in EXPRESS-1C)", async () => {
  const fs = new InMemoryFileSystemProbe();
  const results = await nodeBackendDependenciesCheck.run({ detectedProject: project([expressBackendService(detectedPackageManager)]), fileSystem: fs });

  assert.equal(results.length, 1);
  assert.equal(results[0].code, "node.dependencies.missing");
  assert.equal(results[0].severity, "warning");
  assert.equal(results[0].serviceId, "backend");
  assert.equal(results[0].action, undefined);
});

void test("reports node.packageManager.blocked with serviceId backend and the exact existing reason when the package manager is missing", async () => {
  const missing: PackageManagerDetection = { kind: "missing", reason: "No supported package-manager lockfile was found." };
  const fs = new InMemoryFileSystemProbe();
  const results = await nodeBackendDependenciesCheck.run({ detectedProject: project([expressBackendService(missing)]), fileSystem: fs });

  const dependenciesResult = results.find((result) => result.code === "node.dependencies.missing");
  assert.notEqual(dependenciesResult, undefined);
  assert.equal(dependenciesResult?.action, undefined);

  const blockedResult = results.find((result) => result.code === "node.packageManager.blocked");
  assert.equal(blockedResult?.serviceId, "backend");
  assert.equal(blockedResult?.message, "No supported package-manager lockfile was found.");
});

void test("reports node.packageManager.blocked naming every ambiguous candidate, without referencing a nonexistent backend package-manager setting", async () => {
  const ambiguous: PackageManagerDetection = {
    kind: "ambiguous",
    candidates: [
      { manager: "npm", lockfile: "package-lock.json" },
      { manager: "pnpm", lockfile: "pnpm-lock.yaml" }
    ]
  };
  const fs = new InMemoryFileSystemProbe().addDirectory(path.join(backendRoot, "node_modules"));
  const results = await nodeBackendDependenciesCheck.run({ detectedProject: project([expressBackendService(ambiguous)]), fileSystem: fs });

  assert.equal(results.length, 1);
  assert.equal(results[0].code, "node.packageManager.blocked");
  assert.match(results[0].message, /npm/);
  assert.match(results[0].message, /pnpm/);
  assert.ok(!results[0].message.includes("stackPilot.backend.packageManager"), "no such setting exists in EXPRESS-1C");
});

// --- Express + Vite isolation (root/serviceId never conflated) ---

void test("isolation: checks node_modules at the Express backend's own root, never the frontend's or the workspace root", async () => {
  // node_modules exists ONLY under frontend/ - the backend's own root (the
  // workspace root here) has none.
  const fs = new InMemoryFileSystemProbe().addDirectory(path.join(frontendRoot, "node_modules"));
  const results = await nodeBackendDependenciesCheck.run({
    detectedProject: project([expressBackendService(detectedPackageManager), viteFrontendService()]),
    fileSystem: fs
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].code, "node.dependencies.missing");
  assert.equal(results[0].serviceId, "backend");
});

void test("isolation: reports nothing for the backend once its OWN node_modules exists, even while the frontend's is still missing", async () => {
  const fs = new InMemoryFileSystemProbe().addDirectory(path.join(backendRoot, "node_modules"));
  const results = await nodeBackendDependenciesCheck.run({
    detectedProject: project([expressBackendService(detectedPackageManager), viteFrontendService()]),
    fileSystem: fs
  });

  assert.deepEqual(results, []);
});
