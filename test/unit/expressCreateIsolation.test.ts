import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import test from "node:test";

/**
 * Mirrors fastApiCreateIsolation.test.ts's own established approach, applied
 * to Express's module instead of FastAPI's: proves Express Create holds no
 * framework-agnostic-helper-bypassing or other-framework-specific knowledge -
 * Express's own files never import newProjectWizard.ts, viteFrontendSteps.ts,
 * sharedProjectSteps.ts directly (all three are only ever called by the
 * generic composer, projectStepsComposition.ts), or any Django/FastAPI create
 * file, or the concrete Vite React Create module's own internals (the
 * generic `.frontend`/FrontendScaffoldRequest mechanism already suffices -
 * see docs/EXPRESS_1D_CODE_TRUTH_AND_IMPLEMENTATION_PLAN.md §10/§20).
 */
const EXPRESS_MODULE_FILES = ["expressCreateInputs.ts", "expressScaffoldPlan.ts", "expressCreateModule.ts", "expressNewProjectPresets.ts"] as const;

const CREATE_ROOT = path.resolve(__dirname, "..", "..", "..", "src", "project", "create");

// __dirname resolves under out/test/unit/ once compiled - the real source tree lives three levels up.
const expressSources = EXPRESS_MODULE_FILES.map((fileName) => ({
  fileName,
  source: fs.readFileSync(path.join(CREATE_ROOT, "express", fileName), "utf8")
}));

/**
 * Import-statement patterns only - deliberately not a bare-word scan.
 * Express's own files legitimately mention "django"/"fastapi"/"vite" etc. in
 * explanatory comments (mirroring the codebase's own established
 * commenting convention of cross-referencing sibling modules by name); what
 * must never happen is an actual `import ... from` coupling to any of these.
 */
const FORBIDDEN_IMPORT_PATTERNS: readonly RegExp[] = [
  /from\s+["'][^"']*commands\/newProjectWizard["']/,
  /from\s+["'][^"']*\/viteFrontendSteps["']/,
  /from\s+["'][^"']*\/sharedProjectSteps["']/,
  /from\s+["'][^"']*\/create\/django\//,
  /from\s+["'][^"']*\/create\/fastapi\//,
  /from\s+["'][^"']*\/create\/vitereact\//
];

void test("Express's own module files import none of newProjectWizard, viteFrontendSteps, sharedProjectSteps, or any Django/FastAPI/Vite React create file", () => {
  for (const { fileName, source } of expressSources) {
    for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
      assert.equal(pattern.test(source), false, `${fileName} must not reference ${pattern}`);
    }
  }
});

void test("expressScaffoldPlan.ts contains no vscode import (stays pure and vscode-free)", () => {
  const scaffoldPlanSource = expressSources.find((entry) => entry.fileName === "expressScaffoldPlan.ts")?.source ?? "";
  assert.equal(/from\s+["']vscode["']/.test(scaffoldPlanSource), false);
});

void test("expressNewProjectPresets.ts contains no vscode import and no scaffold-execution logic", () => {
  const presetsSource = expressSources.find((entry) => entry.fileName === "expressNewProjectPresets.ts")?.source ?? "";
  assert.equal(/from\s+["']vscode["']/.test(presetsSource), false);
  assert.equal(/writeFileStep|commandStep|ScaffoldStep/.test(presetsSource), false);
});

void test("expressCreateModule.ts contains no top-level vscode-calling import (only a lazy import inside prepare())", () => {
  const moduleSource = expressSources.find((entry) => entry.fileName === "expressCreateModule.ts")?.source ?? "";
  assert.equal(/^import[^;]*vscode/m.test(moduleSource), false);
});

void test("no other framework's Create module imports Express's own internals", () => {
  const otherModuleDirectories = ["django", "fastapi", "vitereact"] as const;
  for (const directory of otherModuleDirectories) {
    const directoryPath = path.join(CREATE_ROOT, directory);
    for (const fileName of fs.readdirSync(directoryPath)) {
      const source = fs.readFileSync(path.join(directoryPath, fileName), "utf8");
      assert.equal(/from\s+["'][^"']*\/create\/express\//.test(source), false, `${directory}/${fileName} must not reference Express's own create module`);
    }
  }
});

void test("projectCreateModules.ts is the only file importing expressCreateModule", () => {
  const searchRoots = [CREATE_ROOT, path.resolve(__dirname, "..", "..", "..", "src", "commands")];
  const importingFiles: string[] = [];

  const walk = (directoryPath: string): void => {
    for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
        continue;
      }
      if (!entry.name.endsWith(".ts") || entry.name === "expressCreateModule.ts") {
        continue;
      }
      const source = fs.readFileSync(entryPath, "utf8");
      if (/from\s+["'][^"']*\/express\/expressCreateModule["']/.test(source)) {
        importingFiles.push(entry.name);
      }
    }
  };

  for (const root of searchRoots) {
    walk(root);
  }

  assert.deepEqual(importingFiles, ["projectCreateModules.ts"]);
});
