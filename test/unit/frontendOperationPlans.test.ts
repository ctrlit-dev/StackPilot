import assert from "node:assert/strict";
import test from "node:test";

import type { DetectedProject, DetectedService } from "../../src/detection/detectedProject";
import type { FrontendProject } from "../../src/detection/frontendDetector";
import type { PackageManagerDetection } from "../../src/detection/packageManagerDetector";
import {
  planBuildFrontend,
  planInstallFrontendDependencies,
  planRunFrontendScript,
  planTestFrontend
} from "../../src/commands/frontendOperationPlans";

function detectedProject(frontend?: FrontendProject): DetectedProject {
  const services: DetectedService[] = [];
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
    pythonRuntime: { selected: undefined, candidates: [], diagnostics: [] },
    diagnostics: []
  };
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

void test("planInstallFrontendDependencies reports no-frontend when nothing is detected", () => {
  assert.equal(planInstallFrontendDependencies(detectedProject()).kind, "no-frontend");
});

void test("planInstallFrontendDependencies builds 'npm install' when ready", () => {
  const plan = planInstallFrontendDependencies(detectedProject(frontend(npmDetected)));
  assert.equal(plan.kind, "ready");
  if (plan.kind === "ready") {
    assert.deepEqual(plan.command.args, ["install"]);
  }
});

void test("planInstallFrontendDependencies reports a missing package manager", () => {
  const plan = planInstallFrontendDependencies(
    detectedProject(frontend({ kind: "missing", reason: "No supported package-manager lockfile was found." }))
  );
  assert.equal(plan.kind, "package-manager-missing");
});

void test("planInstallFrontendDependencies reports an ambiguous package manager", () => {
  const plan = planInstallFrontendDependencies(
    detectedProject(
      frontend({
        kind: "ambiguous",
        candidates: [
          { manager: "npm", lockfile: "package-lock.json" },
          { manager: "yarn", lockfile: "yarn.lock" }
        ]
      })
    )
  );
  assert.equal(plan.kind, "package-manager-ambiguous");
});

void test("planBuildFrontend reports no-script when the build script is missing", () => {
  const plan = planBuildFrontend(detectedProject(frontend(npmDetected, { dev: "vite" })), "build");
  assert.equal(plan.kind, "no-script");
});

void test("planBuildFrontend builds the run command when the script exists", () => {
  const plan = planBuildFrontend(detectedProject(frontend(npmDetected, { dev: "vite", build: "vite build" })), "build");
  assert.equal(plan.kind, "ready");
  if (plan.kind === "ready") {
    assert.deepEqual(plan.command.args, ["run", "build"]);
  }
});

void test("planTestFrontend reports no-script when there is no test script (not every Vite project has tests)", () => {
  const plan = planTestFrontend(detectedProject(frontend(npmDetected, { dev: "vite" })), "test");
  assert.equal(plan.kind, "no-script");
});

void test("planTestFrontend builds the run command when a test script exists", () => {
  const plan = planTestFrontend(detectedProject(frontend(npmDetected, { dev: "vite", test: "vitest" })), "test");
  assert.equal(plan.kind, "ready");
  if (plan.kind === "ready") {
    assert.deepEqual(plan.command.args, ["run", "test"]);
  }
});

void test("planRunFrontendScript runs any script name, not just build/test", () => {
  const plan = planRunFrontendScript(detectedProject(frontend(npmDetected, { dev: "vite", lint: "eslint ." })), "lint");
  assert.equal(plan.kind, "ready");
  if (plan.kind === "ready") {
    assert.deepEqual(plan.command.args, ["run", "lint"]);
  }
});

void test("planRunFrontendScript reports no-script for a name that isn't in package.json", () => {
  const plan = planRunFrontendScript(detectedProject(frontend(npmDetected, { dev: "vite" })), "lint");
  assert.equal(plan.kind, "no-script");
});
