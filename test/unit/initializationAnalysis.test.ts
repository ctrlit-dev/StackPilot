import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import { DEFAULT_CONFIGURATION } from "../../src/config/configurationModel";
import type { BackendProject } from "../../src/detection/backendDetector";
import type { FrontendProject } from "../../src/detection/frontendDetector";
import type { DetectedProject } from "../../src/detection/projectDetector";
import type { PythonEnvironment } from "../../src/detection/pythonDetector";
import { analyzeInitialization, gatherInitializationFacts, type InitializationFacts } from "../../src/commands/initializationAnalysis";
import { InMemoryFileSystemProbe } from "./fakes/inMemoryFileSystem";

const workspaceRoot = path.resolve("pc-test-fixtures", "initialization");

function backend(evidence: readonly string[]): BackendProject {
  return { rootPath: path.join(workspaceRoot, "backend"), managePyPath: path.join(workspaceRoot, "backend", "manage.py"), score: 80, evidence };
}

function frontend(): FrontendProject {
  return {
    rootPath: path.join(workspaceRoot, "frontend"),
    packageJsonPath: path.join(workspaceRoot, "frontend", "package.json"),
    scripts: { dev: "vite" },
    packageManager: { kind: "detected", manager: "npm", source: "lockfile", evidence: "package-lock.json" },
    score: 90,
    evidence: []
  };
}

function venvPython(): PythonEnvironment {
  return {
    executablePath: path.join(workspaceRoot, "backend", ".venv", "bin", "python"),
    source: "venv",
    validation: "exists",
    environmentPath: path.join(workspaceRoot, "backend", ".venv")
  };
}

function detectedProject(overrides: { backend?: BackendProject; frontend?: FrontendProject; python?: PythonEnvironment } = {}): DetectedProject {
  return {
    workspaceRootPath: workspaceRoot,
    backend: { selected: overrides.backend, candidates: [], diagnostics: [] },
    frontend: { selected: overrides.frontend, candidates: [], diagnostics: [] },
    python: { selected: overrides.python, candidates: [], diagnostics: [] },
    diagnostics: []
  };
}

// --- analyzeInitialization (pure) ---

function facts(overrides: Partial<InitializationFacts> = {}): InitializationFacts {
  return {
    backendDetected: false,
    requirementsFileDetected: false,
    venvDetected: false,
    pythonDependenciesInstalled: undefined,
    frontendDetected: false,
    nodeModulesDetected: undefined,
    ...overrides
  };
}

void test("a fully empty project only shows the two top-level not-detected rows", () => {
  const plan = analyzeInitialization(facts());
  assert.deepEqual(
    plan.checklist.map((item) => item.label),
    ["Django project detected", "Vite frontend detected"]
  );
  assert.equal(plan.canCreateVenv, false);
  assert.equal(plan.canInstallPythonDependencies, false);
  assert.equal(plan.canInstallFrontendDependencies, false);
});

void test("offers to create a venv when a backend is detected but no venv exists", () => {
  const plan = analyzeInitialization(facts({ backendDetected: true }));
  assert.equal(plan.canCreateVenv, true);
});

void test("does not offer to create a venv once one is already detected", () => {
  const plan = analyzeInitialization(facts({ backendDetected: true, venvDetected: true }));
  assert.equal(plan.canCreateVenv, false);
});

void test("offers to install Python dependencies only when requirements.txt exists and they are not already installed", () => {
  const notOffered = analyzeInitialization(facts({ backendDetected: true, requirementsFileDetected: false }));
  assert.equal(notOffered.canInstallPythonDependencies, false);

  const offered = analyzeInitialization(facts({ backendDetected: true, requirementsFileDetected: true, pythonDependenciesInstalled: false }));
  assert.equal(offered.canInstallPythonDependencies, true);

  const alreadyDone = analyzeInitialization(facts({ backendDetected: true, requirementsFileDetected: true, pythonDependenciesInstalled: true }));
  assert.equal(alreadyDone.canInstallPythonDependencies, false);
});

void test("treats an unknown (uncheckable) Python dependency state as still worth offering", () => {
  const plan = analyzeInitialization(facts({ backendDetected: true, requirementsFileDetected: true, pythonDependenciesInstalled: undefined }));
  assert.equal(plan.canInstallPythonDependencies, true);
});

void test("offers to install frontend dependencies only when node_modules is missing", () => {
  const offered = analyzeInitialization(facts({ frontendDetected: true, nodeModulesDetected: false }));
  assert.equal(offered.canInstallFrontendDependencies, true);

  const alreadyDone = analyzeInitialization(facts({ frontendDetected: true, nodeModulesDetected: true }));
  assert.equal(alreadyDone.canInstallFrontendDependencies, false);
});

void test("includes the Python dependencies row only when requirements.txt was found", () => {
  const withoutRequirements = analyzeInitialization(facts({ backendDetected: true }));
  assert.ok(!withoutRequirements.checklist.some((item) => item.label === "Python dependencies installed"));

  const withRequirements = analyzeInitialization(facts({ backendDetected: true, requirementsFileDetected: true }));
  assert.ok(withRequirements.checklist.some((item) => item.label === "Python dependencies installed"));
});

// --- gatherInitializationFacts (impure, uses FileSystemProbe) ---

void test("gatherInitializationFacts reports node_modules presence directly from the filesystem", async () => {
  const fs = new InMemoryFileSystemProbe().addDirectory(path.join(workspaceRoot, "frontend", "node_modules"));
  const result = await gatherInitializationFacts(fs, workspaceRoot, detectedProject({ frontend: frontend() }), DEFAULT_CONFIGURATION);
  assert.equal(result.nodeModulesDetected, true);
});

void test("gatherInitializationFacts reports node_modules missing when absent", async () => {
  const fs = new InMemoryFileSystemProbe();
  const result = await gatherInitializationFacts(fs, workspaceRoot, detectedProject({ frontend: frontend() }), DEFAULT_CONFIGURATION);
  assert.equal(result.nodeModulesDetected, false);
});

void test("gatherInitializationFacts leaves nodeModulesDetected undefined without a frontend", async () => {
  const fs = new InMemoryFileSystemProbe();
  const result = await gatherInitializationFacts(fs, workspaceRoot, detectedProject(), DEFAULT_CONFIGURATION);
  assert.equal(result.nodeModulesDetected, undefined);
});

void test("gatherInitializationFacts checks Django installation only when a venv was detected", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(workspaceRoot, "backend", ".venv", "bin", "python"));
  const withoutVenv = await gatherInitializationFacts(
    fs,
    workspaceRoot,
    detectedProject({ backend: backend(["manage.py", "requirements.txt"]) }),
    DEFAULT_CONFIGURATION
  );
  assert.equal(withoutVenv.pythonDependenciesInstalled, undefined);

  const withVenv = await gatherInitializationFacts(
    fs,
    workspaceRoot,
    detectedProject({ backend: backend(["manage.py", "requirements.txt"]), python: venvPython() }),
    DEFAULT_CONFIGURATION
  );
  assert.equal(withVenv.pythonDependenciesInstalled, false);
});

void test("gatherInitializationFacts detects requirements.txt evidence from the backend detector's own evidence list", async () => {
  const fs = new InMemoryFileSystemProbe();
  const result = await gatherInitializationFacts(
    fs,
    workspaceRoot,
    detectedProject({ backend: backend(["manage.py", "requirements.txt"]) }),
    DEFAULT_CONFIGURATION
  );
  assert.equal(result.requirementsFileDetected, true);
});
