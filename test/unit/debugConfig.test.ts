import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_CONFIGURATION } from "../../src/config/configurationModel";
import type { BackendProject } from "../../src/detection/backendDetector";
import type { DetectedProject, DetectedService } from "../../src/detection/detectedProject";
import type { FrontendProject } from "../../src/detection/frontendDetector";
import type { PythonEnvironment } from "../../src/detection/pythonDetector";
import {
  buildLaunchConfigurations,
  DEBUG_COMPOUND_NAME_FULL_STACK,
  DEBUG_CONFIG_NAME_BACKEND,
  DEBUG_CONFIG_NAME_FRONTEND,
  mergeLaunchEntriesByName
} from "../../src/project/debugConfig";

interface LegacyDetectionOverrides {
  readonly backend?: { readonly selected?: BackendProject; readonly candidates?: readonly BackendProject[]; readonly diagnostics?: readonly string[] };
  readonly frontend?: { readonly selected?: FrontendProject; readonly candidates?: readonly FrontendProject[]; readonly diagnostics?: readonly string[] };
  readonly python?: { readonly selected?: PythonEnvironment; readonly candidates?: readonly PythonEnvironment[]; readonly diagnostics?: readonly string[] };
}

function detectedProject(overrides: LegacyDetectionOverrides = {}): DetectedProject {
  const pythonSelected = overrides.python?.selected;
  const pythonDetection = { selected: pythonSelected, candidates: pythonSelected === undefined ? [] : [pythonSelected], diagnostics: [] };
  const services: DetectedService[] = [];

  const backend = overrides.backend?.selected;
  if (backend !== undefined) {
    services.push({
      id: "backend",
      rootPath: backend.rootPath,
      frameworkId: "django",
      runtime: { kind: "python", detection: pythonDetection },
      frameworkMetadata: { kind: "django", managePyPath: backend.frameworkEntryPath, apps: [] },
      score: backend.score,
      evidence: backend.evidence
    });
  }

  const frontend = overrides.frontend?.selected;
  if (frontend !== undefined) {
    services.push({
      id: "frontend",
      rootPath: frontend.rootPath,
      frameworkId: "vite",
      runtime: {
        kind: "node",
        packageManager: frontend.packageManager,
        packageJsonPath: frontend.packageJsonPath,
        scripts: frontend.scripts
      },
      score: frontend.score,
      evidence: frontend.evidence
    });
  }

  return {
    workspaceRootPath: "/workspace",
    services,
    pythonRuntime: pythonDetection,
    diagnostics: []
  };
}

void test("builds no configurations when nothing was detected", () => {
  const plan = buildLaunchConfigurations({ workspaceRootPath: "/workspace", detectedProject: detectedProject(), configuration: DEFAULT_CONFIGURATION });
  assert.deepEqual(plan.configurations, []);
  assert.deepEqual(plan.compounds, []);
});

void test("omits the backend configuration when a backend is detected but no Python interpreter is", () => {
  const plan = buildLaunchConfigurations({
    workspaceRootPath: "/workspace",
    detectedProject: detectedProject({
      backend: {
        selected: { rootPath: "/workspace/backend", frameworkEntryPath: "/workspace/backend/manage.py", score: 80, evidence: ["manage.py"] },
        candidates: [],
        diagnostics: []
      }
    }),
    configuration: DEFAULT_CONFIGURATION
  });
  assert.deepEqual(plan.configurations, []);
});

void test("builds a debugpy launch configuration for the detected Django backend", () => {
  const plan = buildLaunchConfigurations({
    workspaceRootPath: "/workspace",
    detectedProject: detectedProject({
      backend: {
        selected: { rootPath: "/workspace/backend", frameworkEntryPath: "/workspace/backend/manage.py", score: 80, evidence: ["manage.py"] },
        candidates: [],
        diagnostics: []
      },
      python: {
        selected: { executablePath: "/workspace/backend/.venv/Scripts/python.exe", source: "venv", validation: "exists" },
        candidates: [],
        diagnostics: []
      }
    }),
    configuration: { ...DEFAULT_CONFIGURATION, backendHost: "127.0.0.1", backendPort: 8000 }
  });

  assert.equal(plan.configurations.length, 1);
  const config = plan.configurations[0];
  assert.equal(config.name, DEBUG_CONFIG_NAME_BACKEND);
  assert.equal(config.type, "debugpy");
  assert.equal(config.program, "${workspaceFolder}/backend/manage.py");
  assert.deepEqual(config.args, ["runserver", "--noreload", "127.0.0.1:8000"]);
  assert.equal(config.django, true);
  assert.equal(config.python, "/workspace/backend/.venv/Scripts/python.exe");
});

void test("builds a Chrome launch configuration for the detected frontend", () => {
  const plan = buildLaunchConfigurations({
    workspaceRootPath: "/workspace",
    detectedProject: detectedProject({
      frontend: {
        selected: {
          rootPath: "/workspace/frontend",
          packageJsonPath: "/workspace/frontend/package.json",
          scripts: { dev: "vite" },
          packageManager: { kind: "detected", manager: "npm", source: "lockfile", evidence: "package-lock.json" },
          score: 90,
          evidence: ["package.json"]
        },
        candidates: [],
        diagnostics: []
      }
    }),
    configuration: { ...DEFAULT_CONFIGURATION, frontendPort: 5173 }
  });

  assert.equal(plan.configurations.length, 1);
  const config = plan.configurations[0];
  assert.equal(config.name, DEBUG_CONFIG_NAME_FRONTEND);
  assert.equal(config.type, "chrome");
  assert.equal(config.url, "http://localhost:5173");
  assert.equal(config.webRoot, "${workspaceFolder}/frontend");
});

void test("adds a full-stack compound only when both backend and frontend configurations are built", () => {
  const plan = buildLaunchConfigurations({
    workspaceRootPath: "/workspace",
    detectedProject: detectedProject({
      backend: {
        selected: { rootPath: "/workspace/backend", frameworkEntryPath: "/workspace/backend/manage.py", score: 80, evidence: ["manage.py"] },
        candidates: [],
        diagnostics: []
      },
      python: {
        selected: { executablePath: "/workspace/backend/.venv/bin/python", source: "venv", validation: "exists" },
        candidates: [],
        diagnostics: []
      },
      frontend: {
        selected: {
          rootPath: "/workspace/frontend",
          packageJsonPath: "/workspace/frontend/package.json",
          scripts: { dev: "vite" },
          packageManager: { kind: "detected", manager: "npm", source: "lockfile", evidence: "package-lock.json" },
          score: 90,
          evidence: ["package.json"]
        },
        candidates: [],
        diagnostics: []
      }
    }),
    configuration: DEFAULT_CONFIGURATION
  });

  assert.equal(plan.configurations.length, 2);
  assert.equal(plan.compounds.length, 1);
  assert.equal(plan.compounds[0].name, DEBUG_COMPOUND_NAME_FULL_STACK);
  assert.deepEqual(plan.compounds[0].configurations, [DEBUG_CONFIG_NAME_BACKEND, DEBUG_CONFIG_NAME_FRONTEND]);
});

/**
 * A realistic FastAPI-detected backend service, per the current
 * `DetectedService` model (same shape `fastApiBackendDetection.ts`/
 * `projectDetector.ts` actually produce) - `frameworkId: "fastapi"` and
 * `FastApiServiceMetadata`, no Django metadata at all. Used to prove
 * `buildLaunchConfigurations` (a Django-only debug-config generator today)
 * never fabricates a Django `manage.py runserver` configuration out of
 * FastAPI's own `frameworkEntryPath` ("main.py").
 */
function fastApiDetectedProject(python?: PythonEnvironment): DetectedProject {
  const pythonDetection = { selected: python, candidates: python === undefined ? [] : [python], diagnostics: [] };
  const services: DetectedService[] = [
    {
      id: "backend",
      rootPath: "/workspace",
      frameworkId: "fastapi",
      runtime: { kind: "python", detection: pythonDetection },
      frameworkMetadata: { kind: "fastapi", appImport: "main:app" },
      score: 80,
      evidence: ["main.py"]
    }
  ];
  return { workspaceRootPath: "/workspace", services, pythonRuntime: pythonDetection, diagnostics: [] };
}

void test("does not create a Django debug configuration for a FastAPI backend", () => {
  const plan = buildLaunchConfigurations({
    workspaceRootPath: "/workspace",
    detectedProject: fastApiDetectedProject({ executablePath: "/workspace/.venv/bin/python", source: "venv", validation: "exists" }),
    configuration: { ...DEFAULT_CONFIGURATION, backendHost: "127.0.0.1", backendPort: 8000 }
  });

  // No configuration at all was built for the backend - not a Django one,
  // not some generic/best-effort one either.
  assert.deepEqual(plan.configurations, []);
  assert.deepEqual(plan.compounds, []);
});

void test("never interprets a FastAPI backend's frameworkEntryPath (main.py) as manage.py, even with a python interpreter and full config present", () => {
  const plan = buildLaunchConfigurations({
    workspaceRootPath: "/workspace",
    detectedProject: fastApiDetectedProject({ executablePath: "/workspace/.venv/bin/python", source: "venv", validation: "exists" }),
    configuration: { ...DEFAULT_CONFIGURATION, backendHost: "127.0.0.1", backendPort: 8000 }
  });

  // Every one of these would be true for the Django config this same input
  // shape produces (see "builds a debugpy launch configuration for the
  // detected Django backend" above) - none may be true here.
  assert.ok(!plan.configurations.some((config) => config.name === DEBUG_CONFIG_NAME_BACKEND));
  assert.ok(!plan.configurations.some((config) => config.type === "debugpy"));
  assert.ok(!plan.configurations.some((config) => config.django === true));
  assert.ok(!plan.configurations.some((config) => typeof config.program === "string" && config.program.includes("main.py")));
  assert.ok(!plan.configurations.some((config) => Array.isArray(config.args) && config.args.includes("runserver")));
});

void test("does not create a Django debug configuration for a backend whose framework is unrecognized (neither Django nor FastAPI)", () => {
  const python: PythonEnvironment = { executablePath: "/workspace/.venv/bin/python", source: "venv", validation: "exists" };
  const pythonDetection = { selected: python, candidates: [python], diagnostics: [] };
  const project: DetectedProject = {
    workspaceRootPath: "/workspace",
    services: [
      {
        id: "backend",
        rootPath: "/workspace",
        frameworkId: "flask",
        runtime: { kind: "python", detection: pythonDetection },
        score: 80,
        evidence: ["requirements.txt"]
      }
    ],
    pythonRuntime: pythonDetection,
    diagnostics: []
  };

  const plan = buildLaunchConfigurations({ workspaceRootPath: "/workspace", detectedProject: project, configuration: DEFAULT_CONFIGURATION });
  assert.deepEqual(plan.configurations, []);
});

void test("mergeLaunchEntriesByName replaces entries sharing a name and keeps the rest untouched", () => {
  const existing = [
    { name: "My Own Config", type: "node" },
    { name: DEBUG_CONFIG_NAME_BACKEND, type: "python", stale: true }
  ];
  const incoming = [{ name: DEBUG_CONFIG_NAME_BACKEND, type: "debugpy" }];

  const merged = mergeLaunchEntriesByName(existing, incoming);

  assert.deepEqual(merged, [
    { name: "My Own Config", type: "node" },
    { name: DEBUG_CONFIG_NAME_BACKEND, type: "debugpy" }
  ]);
});
