import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import test from "node:test";

/**
 * Mirrors newProjectWizardIsolation.test.ts's source-level approach, applied
 * to FastAPI's own module instead of the wizard: proves FastAPI Create holds
 * no framework-agnostic-helper-bypassing or Django-specific knowledge -
 * FastAPI's own files never import newProjectWizard.ts, viteFrontendSteps.ts,
 * sharedProjectSteps.ts directly (both are only ever called by the generic
 * composer, projectStepsComposition.ts - see plan §13.2/§18/§32.9), or any
 * Django create file (plan §13.1 - each backend module's own answers/logic
 * stays entirely private to that module).
 */
const FASTAPI_MODULE_FILES = ["fastApiCreateInputs.ts", "fastApiScaffoldPlan.ts", "fastApiCreateModule.ts", "fastApiNewProjectPresets.ts"] as const;

// __dirname resolves under out/test/unit/ once compiled - the real source tree lives three levels up.
const fastApiSources = FASTAPI_MODULE_FILES.map((fileName) => ({
  fileName,
  source: fs.readFileSync(path.resolve(__dirname, "..", "..", "..", "src", "project", "create", "fastapi", fileName), "utf8")
}));

/**
 * Import-statement patterns only - deliberately not a bare-word scan.
 * FastAPI's own files legitimately mention "django"/"djangoCreateModule" etc.
 * in explanatory comments (mirroring the codebase's own established
 * commenting convention of cross-referencing sibling modules by name); what
 * must never happen is an actual `import ... from` coupling to any of these.
 */
const FORBIDDEN_IMPORT_PATTERNS: readonly RegExp[] = [
  /from\s+["'][^"']*commands\/newProjectWizard["']/,
  /from\s+["'][^"']*\/viteFrontendSteps["']/,
  /from\s+["'][^"']*\/sharedProjectSteps["']/,
  /from\s+["'][^"']*\/create\/django\//
];

void test("FastAPI's own module files import none of newProjectWizard, viteFrontendSteps, sharedProjectSteps, or any Django create file", () => {
  for (const { fileName, source } of fastApiSources) {
    for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
      assert.equal(pattern.test(source), false, `${fileName} must not reference ${pattern}`);
    }
  }
});

void test("fastApiScaffoldPlan.ts contains no vscode import (stays pure and vscode-free)", () => {
  const scaffoldPlanSource = fastApiSources.find((entry) => entry.fileName === "fastApiScaffoldPlan.ts")?.source ?? "";
  assert.equal(/from\s+["']vscode["']/.test(scaffoldPlanSource), false);
});

void test("fastApiCreateModule.ts contains no top-level vscode-calling import (only a lazy import inside prepare())", () => {
  const moduleSource = fastApiSources.find((entry) => entry.fileName === "fastApiCreateModule.ts")?.source ?? "";
  assert.equal(/^import[^;]*vscode/m.test(moduleSource), false);
});
