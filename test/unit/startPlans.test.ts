import assert from "node:assert/strict";
import test from "node:test";

import { djangoBackendAdapter } from "../../src/adapters/djangoBackendAdapter";
import { DEFAULT_CONFIGURATION } from "../../src/config/configurationModel";
import type { BackendProject } from "../../src/detection/backendDetector";
import type { DetectedProject, DetectedService } from "../../src/detection/detectedProject";
import type { FrontendProject } from "../../src/detection/frontendDetector";
import type { PythonEnvironment } from "../../src/detection/pythonDetector";
import { planBackendStart, planFrontendStart } from "../../src/commands/startPlans";

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
      frameworkMetadata: { kind: "django", managePyPath: backend.managePyPath, apps: [] },
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

void test("planBackendStart reports no-backend when nothing was detected", () => {
  const plan = planBackendStart(detectedProject(), DEFAULT_CONFIGURATION, djangoBackendAdapter);
  assert.equal(plan.kind, "no-backend");
});

void test("planBackendStart reports no-backend when detection has not run yet", () => {
  const plan = planBackendStart(undefined, DEFAULT_CONFIGURATION, djangoBackendAdapter);
  assert.equal(plan.kind, "no-backend");
});

void test("planBackendStart reports no-python when a backend is detected but no interpreter is", () => {
  const plan = planBackendStart(
    detectedProject({
      backend: {
        selected: { rootPath: "/workspace/backend", managePyPath: "/workspace/backend/manage.py", score: 80, evidence: ["manage.py"] },
        candidates: [],
        diagnostics: []
      }
    }),
    DEFAULT_CONFIGURATION,
    djangoBackendAdapter
  );
  assert.equal(plan.kind, "no-python");
});

void test("planBackendStart builds the runserver command when everything is detected", () => {
  const plan = planBackendStart(
    detectedProject({
      backend: {
        selected: { rootPath: "/workspace/backend", managePyPath: "/workspace/backend/manage.py", score: 80, evidence: ["manage.py"] },
        candidates: [],
        diagnostics: []
      },
      python: {
        selected: { executablePath: "/workspace/backend/.venv/bin/python", source: "venv", validation: "exists" },
        candidates: [],
        diagnostics: []
      }
    }),
    { ...DEFAULT_CONFIGURATION, backendHost: "127.0.0.1", backendPort: 8000 },
    djangoBackendAdapter
  );

  assert.equal(plan.kind, "ready");
  if (plan.kind === "ready") {
    assert.equal(plan.command.executable, "/workspace/backend/.venv/bin/python");
    assert.deepEqual(plan.command.args, ["/workspace/backend/manage.py", "runserver", "127.0.0.1:8000"]);
  }
});

void test("planBackendStart delegates the actual command shape to the injected adapter, not a hard-coded one", () => {
  // Proves planBackendStart is adapter-driven rather than Django-specific
  // itself: a fake adapter with a deliberately different command shape must
  // be reflected verbatim in the resulting plan.
  const fakeAdapter = {
    ...djangoBackendAdapter,
    id: "fake-framework",
    buildStartCommand: () => ({ executable: "fake-executable", args: ["fake-arg"], cwd: "/fake/cwd", expectedPort: 1234 })
  };

  const plan = planBackendStart(
    detectedProject({
      backend: {
        selected: { rootPath: "/workspace/backend", managePyPath: "/workspace/backend/manage.py", score: 80, evidence: ["manage.py"] },
        candidates: [],
        diagnostics: []
      },
      python: {
        selected: { executablePath: "/workspace/backend/.venv/bin/python", source: "venv", validation: "exists" },
        candidates: [],
        diagnostics: []
      }
    }),
    DEFAULT_CONFIGURATION,
    fakeAdapter
  );

  assert.equal(plan.kind, "ready");
  if (plan.kind === "ready") {
    assert.deepEqual(plan.command, { executable: "fake-executable", args: ["fake-arg"], cwd: "/fake/cwd", expectedPort: 1234 });
  }
});

void test("planFrontendStart reports no-frontend when nothing was detected", () => {
  const plan = planFrontendStart(detectedProject(), DEFAULT_CONFIGURATION);
  assert.equal(plan.kind, "no-frontend");
});

void test("planFrontendStart reports a missing package manager", () => {
  const plan = planFrontendStart(
    detectedProject({
      frontend: {
        selected: {
          rootPath: "/workspace/frontend",
          packageJsonPath: "/workspace/frontend/package.json",
          scripts: { dev: "vite" },
          packageManager: { kind: "missing", reason: "No supported package-manager lockfile was found." },
          score: 40,
          evidence: ["package.json"]
        },
        candidates: [],
        diagnostics: []
      }
    }),
    DEFAULT_CONFIGURATION
  );
  assert.equal(plan.kind, "package-manager-missing");
});

void test("planFrontendStart reports an ambiguous package manager with candidates", () => {
  const plan = planFrontendStart(
    detectedProject({
      frontend: {
        selected: {
          rootPath: "/workspace/frontend",
          packageJsonPath: "/workspace/frontend/package.json",
          scripts: { dev: "vite" },
          packageManager: {
            kind: "ambiguous",
            candidates: [
              { manager: "npm", lockfile: "package-lock.json" },
              { manager: "pnpm", lockfile: "pnpm-lock.yaml" }
            ]
          },
          score: 40,
          evidence: ["package.json"]
        },
        candidates: [],
        diagnostics: []
      }
    }),
    DEFAULT_CONFIGURATION
  );
  assert.equal(plan.kind, "package-manager-ambiguous");
  if (plan.kind === "package-manager-ambiguous") {
    assert.deepEqual(plan.candidates, ["npm", "pnpm"]);
  }
});

void test("planFrontendStart builds the dev command for the detected package manager", () => {
  const plan = planFrontendStart(
    detectedProject({
      frontend: {
        selected: {
          rootPath: "/workspace/frontend",
          packageJsonPath: "/workspace/frontend/package.json",
          scripts: { dev: "vite" },
          packageManager: { kind: "detected", manager: "pnpm", source: "lockfile", evidence: "pnpm-lock.yaml" },
          score: 90,
          evidence: ["package.json", "vite.config.ts"]
        },
        candidates: [],
        diagnostics: []
      }
    }),
    { ...DEFAULT_CONFIGURATION, frontendDevScript: "dev", frontendPort: 5173 }
  );

  assert.equal(plan.kind, "ready");
  if (plan.kind === "ready") {
    assert.equal(plan.command.executable, "pnpm");
    assert.deepEqual(plan.command.args, ["dev"]);
    assert.equal(plan.command.cwd, "/workspace/frontend");
    assert.equal(plan.command.expectedPort, 5173);
  }
});
