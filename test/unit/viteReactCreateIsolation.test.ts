import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import test from "node:test";

/**
 * Mirrors fastApiCreateIsolation.test.ts's/newProjectWizardIsolation.test.ts's
 * source-level approach, applied to the standalone React + Vite module:
 * proves it holds no coupling to the wizard, the nested-companion Vite
 * helper, the shared-file helper, or either Python module's own create
 * files, and that only projectCreateModules.ts is the central registration
 * point (docs/VITE_CREATE_CODE_TRUTH_AND_IMPLEMENTATION_PLAN.md §37).
 */
const VITE_REACT_MODULE_FILES = ["viteReactCreateInputs.ts", "viteReactScaffoldPlan.ts", "viteReactCreateModule.ts"] as const;

// __dirname resolves under out/test/unit/ once compiled - the real source tree lives three levels up.
const viteReactSources = VITE_REACT_MODULE_FILES.map((fileName) => ({
  fileName,
  source: fs.readFileSync(path.resolve(__dirname, "..", "..", "..", "src", "project", "create", "vitereact", fileName), "utf8")
}));

function readSource(...segments: readonly string[]): string {
  return fs.readFileSync(path.resolve(__dirname, "..", "..", "..", "src", ...segments), "utf8");
}

/**
 * Import-statement patterns only - deliberately not a bare-word scan, since
 * explanatory comments legitimately cross-reference sibling modules by name
 * (the same convention django/fastapi's own isolation tests already rely on).
 */
const FORBIDDEN_IMPORT_PATTERNS: readonly RegExp[] = [
  /from\s+["'][^"']*commands\/newProjectWizard["']/,
  /from\s+["'][^"']*\/viteFrontendSteps["']/,
  /from\s+["'][^"']*\/sharedProjectSteps["']/,
  /from\s+["'][^"']*\/create\/django\//,
  /from\s+["'][^"']*\/create\/fastapi\//
];

void test("viteReact's own module files import none of newProjectWizard, viteFrontendSteps, sharedProjectSteps, or either Python module's own create files", () => {
  for (const { fileName, source } of viteReactSources) {
    for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
      assert.equal(pattern.test(source), false, `${fileName} must not reference ${pattern}`);
    }
  }
});

void test("viteReactScaffoldPlan.ts contains no vscode import (stays pure and vscode-free)", () => {
  const scaffoldPlanSource = viteReactSources.find((entry) => entry.fileName === "viteReactScaffoldPlan.ts")?.source ?? "";
  assert.equal(/from\s+["']vscode["']/.test(scaffoldPlanSource), false);
});

void test("viteReactCreateModule.ts contains no top-level vscode-calling import (only a lazy import inside prepare())", () => {
  const moduleSource = viteReactSources.find((entry) => entry.fileName === "viteReactCreateModule.ts")?.source ?? "";
  assert.equal(/^import[^;]*vscode/m.test(moduleSource), false);
});

void test("projectStepsComposition.ts references no vitereact module - it stays generic over ProjectCreatePlan alone", () => {
  const source = readSource("project", "create", "projectStepsComposition.ts");
  assert.equal(/vitereact|viteReactCreateModule|viteReactCreateInputs|viteReactScaffoldPlan/i.test(source), false);
});

void test("sharedProjectSteps.ts references no vitereact module - it stays generic over already-composed content strings", () => {
  const source = readSource("project", "sharedProjectSteps.ts");
  assert.equal(/vitereact|viteReactCreateModule|viteReactCreateInputs|viteReactScaffoldPlan/i.test(source), false);
});

void test("frontend detection/adapter files reference no project/create module - detection stays framework-neutral and Create-layer-unaware", () => {
  for (const detectionFile of ["frontendDetector.ts"]) {
    const source = readSource("detection", detectionFile);
    assert.equal(/project\/create/.test(source), false, `${detectionFile} must not reference project/create/`);
  }
  for (const adapterFile of ["viteFrontendDetection.ts", "viteFrontendAdapter.ts"]) {
    const source = readSource("adapters", adapterFile);
    assert.equal(/project\/create/.test(source), false, `${adapterFile} must not reference project/create/`);
  }
});

void test("projectCreateModules.ts is the only file that imports viteReactCreateModule", () => {
  const projectRoot = path.resolve(__dirname, "..", "..", "..");
  const createDir = path.join(projectRoot, "src", "project", "create");
  const importers: string[] = [];

  const walk = (directoryPath: string): void => {
    for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
        continue;
      }
      if (!entry.name.endsWith(".ts") || entry.name === "viteReactCreateModule.ts") {
        continue;
      }
      const source = fs.readFileSync(entryPath, "utf8");
      if (/viteReactCreateModule/.test(source)) {
        importers.push(path.relative(projectRoot, entryPath));
      }
    }
  };
  walk(createDir);

  assert.deepEqual(importers, [path.join("src", "project", "create", "projectCreateModules.ts")]);
});
