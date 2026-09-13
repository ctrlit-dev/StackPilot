import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import { DEFAULT_CONFIGURATION } from "../../src/config/configurationModel";
import type { BackendProject } from "../../src/detection/backendDetector";
import type { DetectedProject, DetectedService } from "../../src/detection/detectedProject";
import type { FrontendProject } from "../../src/detection/frontendDetector";
import type { PythonEnvironment } from "../../src/detection/pythonDetector";
import {
  analyzeInitialization,
  gatherInitializationFacts,
  type InitializationBackendFramework,
  type InitializationFacts
} from "../../src/commands/initializationAnalysis";
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

function detectedProject(
  overrides: {
    backend?: BackendProject;
    backendFramework?: InitializationBackendFramework;
    frontend?: FrontendProject;
    python?: PythonEnvironment;
  } = {}
): DetectedProject {
  const pythonDetection = {
    selected: overrides.python,
    candidates: overrides.python === undefined ? [] : [overrides.python],
    diagnostics: []
  };
  const services: DetectedService[] = [];
  if (overrides.backend !== undefined) {
    const framework = overrides.backendFramework ?? "django";
    services.push({
      id: "backend",
      rootPath: overrides.backend.rootPath,
      frameworkId: framework,
      runtime: { kind: "python", detection: pythonDetection },
      frameworkMetadata:
        framework === "django"
          ? { kind: "django", managePyPath: overrides.backend.managePyPath, apps: [] }
          : { kind: "fastapi", appImport: "main:app" },
      score: overrides.backend.score,
      evidence: overrides.backend.evidence
    });
  }
  if (overrides.frontend !== undefined) {
    services.push({
      id: "frontend",
      rootPath: overrides.frontend.rootPath,
      frameworkId: "vite",
      runtime: {
        kind: "node",
        packageManager: overrides.frontend.packageManager,
        packageJsonPath: overrides.frontend.packageJsonPath,
        scripts: overrides.frontend.scripts
      },
      score: overrides.frontend.score,
      evidence: overrides.frontend.evidence
    });
  }
  return {
    workspaceRootPath: workspaceRoot,
    services,
    pythonRuntime: pythonDetection,
    diagnostics: []
  };
}

// --- analyzeInitialization (pure) ---

function facts(overrides: Partial<InitializationFacts> = {}): InitializationFacts {
  return {
    backendDetected: false,
    backendFramework: undefined,
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

void test("labels the top row 'Django project detected' when the detected backend is Django", () => {
  const plan = analyzeInitialization(facts({ backendDetected: true, backendFramework: "django" }));
  assert.equal(plan.checklist[0]?.label, "Django project detected");
});

void test("labels the top row 'FastAPI project detected' when the detected backend is FastAPI, not Django", () => {
  const plan = analyzeInitialization(facts({ backendDetected: true, backendFramework: "fastapi" }));
  assert.equal(plan.checklist[0]?.label, "FastAPI project detected");
  assert.ok(!plan.checklist.some((item) => item.label === "Django project detected"));
});

void test("falls back to a framework-neutral label when a backend is detected but its framework is unrecognized", () => {
  const plan = analyzeInitialization(facts({ backendDetected: true, backendFramework: undefined }));
  assert.equal(plan.checklist[0]?.label, "Backend project detected");
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

void test("gatherInitializationFacts reports Django as installed once the django package is present in the venv", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "backend", ".venv", "bin", "python"))
    .addFile(path.join(workspaceRoot, "backend", ".venv", "Lib", "site-packages", "django", "__init__.py"));

  const result = await gatherInitializationFacts(
    fs,
    workspaceRoot,
    detectedProject({ backend: backend(["manage.py", "requirements.txt"]), python: venvPython() }),
    DEFAULT_CONFIGURATION
  );
  assert.equal(result.backendFramework, "django");
  assert.equal(result.pythonDependenciesInstalled, true);
});

void test("gatherInitializationFacts identifies a FastAPI backend via its own metadata, not a guessed filename", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(workspaceRoot, "backend", ".venv", "bin", "python"));
  const result = await gatherInitializationFacts(
    fs,
    workspaceRoot,
    detectedProject({ backend: backend(["main.py", "requirements.txt"]), backendFramework: "fastapi", python: venvPython() }),
    DEFAULT_CONFIGURATION
  );
  assert.equal(result.backendFramework, "fastapi");
});

void test("gatherInitializationFacts reports FastAPI dependencies installed once the fastapi package is present in the venv", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "backend", ".venv", "bin", "python"))
    .addFile(path.join(workspaceRoot, "backend", ".venv", "Lib", "site-packages", "fastapi", "__init__.py"));

  const result = await gatherInitializationFacts(
    fs,
    workspaceRoot,
    detectedProject({ backend: backend(["main.py", "requirements.txt"]), backendFramework: "fastapi", python: venvPython() }),
    DEFAULT_CONFIGURATION
  );
  assert.equal(result.pythonDependenciesInstalled, true);
});

void test("gatherInitializationFacts reports FastAPI dependencies as not installed when the fastapi package is missing", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(workspaceRoot, "backend", ".venv", "bin", "python"));

  const result = await gatherInitializationFacts(
    fs,
    workspaceRoot,
    detectedProject({ backend: backend(["main.py", "requirements.txt"]), backendFramework: "fastapi", python: venvPython() }),
    DEFAULT_CONFIGURATION
  );
  assert.equal(result.pythonDependenciesInstalled, false);
});

void test("gatherInitializationFacts never reports FastAPI dependencies installed just because Django is present in the venv (reproduces the fixed bug)", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "backend", ".venv", "bin", "python"))
    .addFile(path.join(workspaceRoot, "backend", ".venv", "Lib", "site-packages", "django", "__init__.py"));

  const result = await gatherInitializationFacts(
    fs,
    workspaceRoot,
    detectedProject({ backend: backend(["main.py", "requirements.txt"]), backendFramework: "fastapi", python: venvPython() }),
    DEFAULT_CONFIGURATION
  );
  assert.equal(result.backendFramework, "fastapi");
  assert.equal(result.pythonDependenciesInstalled, false);
});

void test("gatherInitializationFacts treats a backend with an unrecognized framework as unverifiable, never as Django", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "backend", ".venv", "bin", "python"))
    .addFile(path.join(workspaceRoot, "backend", ".venv", "Lib", "site-packages", "django", "__init__.py"));
  const python = venvPython();

  const project: DetectedProject = {
    workspaceRootPath: workspaceRoot,
    services: [
      {
        id: "backend",
        rootPath: path.join(workspaceRoot, "backend"),
        frameworkId: "flask",
        runtime: { kind: "python", detection: { selected: python, candidates: [python], diagnostics: [] } },
        score: 80,
        evidence: ["requirements.txt"]
      }
    ],
    pythonRuntime: { selected: python, candidates: [python], diagnostics: [] },
    diagnostics: []
  };

  const result = await gatherInitializationFacts(fs, workspaceRoot, project, DEFAULT_CONFIGURATION);
  assert.equal(result.backendFramework, undefined);
  assert.equal(result.pythonDependenciesInstalled, undefined);
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
