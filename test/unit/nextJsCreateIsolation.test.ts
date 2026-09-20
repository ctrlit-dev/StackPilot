import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import test from "node:test";

/**
 * Mirrors expressCreateIsolation.test.ts's own established approach,
 * applied to Next.js's module instead of Express's: proves Next.js Create
 * holds no framework-agnostic-helper-bypassing or other-framework-specific
 * knowledge - Next.js's own files never import newProjectWizard.ts,
 * viteFrontendSteps.ts, sharedProjectSteps.ts directly (all three are only
 * ever called by the generic composer, projectStepsComposition.ts), or any
 * Django/FastAPI/Express create file, or the concrete Vite React Create
 * module's own internals (this module's entire output already is the root
 * project - it never uses, and never needs, a nested-companion mechanism).
 */
const NEXTJS_MODULE_FILES = ["nextJsCreateInputs.ts", "nextJsScaffoldPlan.ts", "nextJsCreateModule.ts", "nextJsNewProjectPresets.ts"] as const;

const CREATE_ROOT = path.resolve(__dirname, "..", "..", "..", "src", "project", "create");

// __dirname resolves under out/test/unit/ once compiled - the real source tree lives three levels up.
const nextJsSources = NEXTJS_MODULE_FILES.map((fileName) => ({
  fileName,
  source: fs.readFileSync(path.join(CREATE_ROOT, "nextjs", fileName), "utf8")
}));

/**
 * Import-statement patterns only - deliberately not a bare-word scan.
 * Next.js's own files legitimately mention "django"/"fastapi"/"vite"/
 * "express" etc. in explanatory comments (mirroring the codebase's own
 * established commenting convention of cross-referencing sibling modules
 * by name); what must never happen is an actual `import ... from` coupling
 * to any of these.
 */
const FORBIDDEN_IMPORT_PATTERNS: readonly RegExp[] = [
  /from\s+["'][^"']*commands\/newProjectWizard["']/,
  /from\s+["'][^"']*\/viteFrontendSteps["']/,
  /from\s+["'][^"']*\/sharedProjectSteps["']/,
  /from\s+["'][^"']*\/create\/django\//,
  /from\s+["'][^"']*\/create\/fastapi\//,
  /from\s+["'][^"']*\/create\/express\//,
  /from\s+["'][^"']*\/create\/vitereact\//
];

void test("Next.js's own module files import none of newProjectWizard, viteFrontendSteps, sharedProjectSteps, or any Django/FastAPI/Express/Vite React create file", () => {
  for (const { fileName, source } of nextJsSources) {
    for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
      assert.equal(pattern.test(source), false, `${fileName} must not reference ${pattern}`);
    }
  }
});

void test("nextJsScaffoldPlan.ts contains no vscode import (stays pure and vscode-free)", () => {
  const scaffoldPlanSource = nextJsSources.find((entry) => entry.fileName === "nextJsScaffoldPlan.ts")?.source ?? "";
  assert.equal(/from\s+["']vscode["']/.test(scaffoldPlanSource), false);
});

void test("nextJsNewProjectPresets.ts contains no vscode import and no scaffold-execution logic", () => {
  const presetsSource = nextJsSources.find((entry) => entry.fileName === "nextJsNewProjectPresets.ts")?.source ?? "";
  assert.equal(/from\s+["']vscode["']/.test(presetsSource), false);
  assert.equal(/writeFileStep|commandStep|ScaffoldStep/.test(presetsSource), false);
});

void test("nextJsCreateModule.ts contains no top-level vscode-calling import (only a lazy import inside prepare())", () => {
  const moduleSource = nextJsSources.find((entry) => entry.fileName === "nextJsCreateModule.ts")?.source ?? "";
  assert.equal(/^import[^;]*vscode/m.test(moduleSource), false);
});

void test("no other framework's Create module imports Next.js's own internals", () => {
  const otherModuleDirectories = ["django", "fastapi", "vitereact", "express"] as const;
  for (const directory of otherModuleDirectories) {
    const directoryPath = path.join(CREATE_ROOT, directory);
    for (const fileName of fs.readdirSync(directoryPath)) {
      const source = fs.readFileSync(path.join(directoryPath, fileName), "utf8");
      assert.equal(/from\s+["'][^"']*\/create\/nextjs\//.test(source), false, `${directory}/${fileName} must not reference Next.js's own create module`);
    }
  }
});

void test("projectCreateModules.ts is the only file importing nextJsCreateModule", () => {
  const searchRoots = [CREATE_ROOT, path.resolve(__dirname, "..", "..", "..", "src", "commands")];
  const importingFiles: string[] = [];

  const walk = (directoryPath: string): void => {
    for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
        continue;
      }
      if (!entry.name.endsWith(".ts") || entry.name === "nextJsCreateModule.ts") {
        continue;
      }
      const source = fs.readFileSync(entryPath, "utf8");
      if (/from\s+["'][^"']*\/nextjs\/nextJsCreateModule["']/.test(source)) {
        importingFiles.push(entry.name);
      }
    }
  };

  for (const root of searchRoots) {
    walk(root);
  }

  assert.deepEqual(importingFiles, ["projectCreateModules.ts"]);
});

void test("no existing Create module received Next.js-specific fields or knowledge", () => {
  const otherModuleDirectories = ["django", "fastapi", "vitereact", "express"] as const;
  for (const directory of otherModuleDirectories) {
    const directoryPath = path.join(CREATE_ROOT, directory);
    for (const fileName of fs.readdirSync(directoryPath)) {
      const source = fs.readFileSync(path.join(directoryPath, fileName), "utf8");
      assert.equal(/nextjs|next-app|create-next-app|NextJs/i.test(source), false, `${directory}/${fileName} must have no Next.js-specific knowledge`);
    }
  }
});
