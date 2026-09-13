import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_CONFIGURATION } from "../../src/config/configurationModel";
import type { DetectedProject } from "../../src/detection/projectDetector";
import { planBackendStart, planFrontendStart } from "../../src/commands/startPlans";

function detectedProject(overrides: Partial<DetectedProject> = {}): DetectedProject {
  return {
    workspaceRootPath: "/workspace",
    backend: { candidates: [], diagnostics: [] },
    frontend: { candidates: [], diagnostics: [] },
    python: { candidates: [], diagnostics: [] },
    diagnostics: [],
    ...overrides
  };
}

void test("planBackendStart reports no-backend when nothing was detected", () => {
  const plan = planBackendStart(detectedProject(), DEFAULT_CONFIGURATION);
  assert.equal(plan.kind, "no-backend");
});

void test("planBackendStart reports no-backend when detection has not run yet", () => {
  const plan = planBackendStart(undefined, DEFAULT_CONFIGURATION);
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
    DEFAULT_CONFIGURATION
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
    { ...DEFAULT_CONFIGURATION, backendHost: "127.0.0.1", backendPort: 8000 }
  );

  assert.equal(plan.kind, "ready");
  if (plan.kind === "ready") {
    assert.equal(plan.command.executable, "/workspace/backend/.venv/bin/python");
    assert.deepEqual(plan.command.args, ["/workspace/backend/manage.py", "runserver", "127.0.0.1:8000"]);
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
