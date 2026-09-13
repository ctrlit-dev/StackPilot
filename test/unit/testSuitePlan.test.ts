import assert from "node:assert/strict";
import test from "node:test";

import type { BackendProject } from "../../src/detection/backendDetector";
import type { FrontendProject } from "../../src/detection/frontendDetector";
import type { PackageManagerDetection } from "../../src/detection/packageManagerDetector";
import type { DetectedProject } from "../../src/detection/projectDetector";
import type { PythonEnvironment } from "../../src/detection/pythonDetector";
import { backendTestSuitePlan, frontendTestSuitePlan } from "../../src/testing/testSuitePlan";

function detectedProject(overrides: {
  backend?: BackendProject;
  frontend?: FrontendProject;
  python?: PythonEnvironment;
} = {}): DetectedProject {
  return {
    workspaceRootPath: "/workspace",
    backend: { selected: overrides.backend, candidates: [], diagnostics: [] },
    frontend: { selected: overrides.frontend, candidates: [], diagnostics: [] },
    python: { selected: overrides.python, candidates: [], diagnostics: [] },
    diagnostics: []
  };
}

function backend(): BackendProject {
  return { rootPath: "/workspace/backend", managePyPath: "/workspace/backend/manage.py", score: 80, evidence: ["manage.py"] };
}

function python(): PythonEnvironment {
  return { executablePath: "/workspace/backend/.venv/bin/python", source: "venv", validation: "exists" };
}

function frontend(packageManager: PackageManagerDetection, scripts: Record<string, string> = { dev: "vite" }): FrontendProject {
  return {
    rootPath: "/workspace/frontend",
    packageJsonPath: "/workspace/frontend/package.json",
    scripts,
    packageManager,
    score: 90,
    evidence: []
  };
}

const npmDetected: PackageManagerDetection = { kind: "detected", manager: "npm", source: "lockfile", evidence: "package-lock.json" };

void test("backendTestSuitePlan reports unavailable when no backend was detected", () => {
  const plan = backendTestSuitePlan(detectedProject());
  assert.equal(plan.kind, "unavailable");
  assert.equal(plan.reason, "No Django project was detected.");
});

void test("backendTestSuitePlan reports unavailable when a backend is detected but no interpreter is", () => {
  const plan = backendTestSuitePlan(detectedProject({ backend: backend() }));
  assert.equal(plan.kind, "unavailable");
  assert.equal(plan.reason, "No Python interpreter was found.");
});

void test("backendTestSuitePlan is ready with the manage.py test command once everything is detected", () => {
  const plan = backendTestSuitePlan(detectedProject({ backend: backend(), python: python() }));
  assert.equal(plan.kind, "ready");
  assert.deepEqual(plan.command?.args, ["/workspace/backend/manage.py", "test"]);
});

void test("frontendTestSuitePlan reports unavailable when no frontend was detected", () => {
  const plan = frontendTestSuitePlan(detectedProject(), "test");
  assert.equal(plan.kind, "unavailable");
  assert.equal(plan.reason, "No Vite frontend was detected.");
});

void test("frontendTestSuitePlan reports unavailable when the test script is missing", () => {
  const plan = frontendTestSuitePlan(detectedProject({ frontend: frontend(npmDetected, { dev: "vite" }) }), "test");
  assert.equal(plan.kind, "unavailable");
  assert.equal(plan.reason, 'No "test" script was found in package.json.');
});

void test("frontendTestSuitePlan is ready with the run command once a test script is detected", () => {
  const plan = frontendTestSuitePlan(detectedProject({ frontend: frontend(npmDetected, { dev: "vite", test: "vitest" }) }), "test");
  assert.equal(plan.kind, "ready");
  assert.deepEqual(plan.command?.args, ["run", "test"]);
});

void test("frontendTestSuitePlan reports the ambiguous package managers by name", () => {
  const plan = frontendTestSuitePlan(
    detectedProject({
      frontend: frontend(
        {
          kind: "ambiguous",
          candidates: [
            { manager: "npm", lockfile: "package-lock.json" },
            { manager: "pnpm", lockfile: "pnpm-lock.yaml" }
          ]
        },
        { dev: "vite", test: "vitest" }
      )
    }),
    "test"
  );
  assert.equal(plan.kind, "unavailable");
  assert.equal(plan.reason, "Multiple package managers were detected (npm, pnpm).");
});
