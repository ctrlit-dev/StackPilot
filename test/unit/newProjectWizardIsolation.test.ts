import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import test from "node:test";

/**
 * Mechanically prevents newProjectWizard.ts from becoming framework-specific
 * again (plan §27/§28's standing invariant). A source-level check, not a
 * fragile file-name test: it targets the one import boundary the
 * architecture promises - the wizard may depend on the ProjectCreateModule
 * contract and the registry, but never on a concrete project module.
 */
// __dirname resolves under out/test/unit/ once compiled - the real source tree lives three levels up (out/test/unit/../../.. = repo root).
const wizardSource = fs.readFileSync(path.resolve(__dirname, "..", "..", "..", "src", "commands", "newProjectWizard.ts"), "utf8");

const FORBIDDEN_IMPORT_PATTERNS: readonly RegExp[] = [
  /from\s+["'][^"']*\/create\/django\//,
  /from\s+["'][^"']*\/create\/fastapi\//,
  /from\s+["'][^"']*\/create\/express\//,
  /from\s+["'][^"']*\/create\/nestjs\//,
  /djangoCreateModule|djangoCreateInputs|djangoScaffoldPlan/,
  /fastApiCreateModule|fastApiCreateInputs|fastApiScaffoldPlan/,
  /expressCreateModule|expressCreateInputs|expressScaffoldPlan/,
  /nestJsCreateModule|nestJsCreateInputs|nestJsScaffoldPlan/
];

void test("newProjectWizard.ts imports no concrete backend module", () => {
  for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
    assert.equal(pattern.test(wizardSource), false, `newProjectWizard.ts must not reference ${pattern}`);
  }
});

void test("newProjectWizard.ts contains no framework-id string-literal dispatch", () => {
  assert.equal(/["']django["']/.test(wizardSource), false, "the wizard must not compare against the \"django\" id literal");
  assert.equal(/projectModule\.id\s*===/.test(wizardSource), false, "the wizard must not branch on module.id");
});

void test("newProjectWizard.ts imports only the generic ProjectCreateModule contract and registry from project/create/", () => {
  const createImports = [...wizardSource.matchAll(/from\s+["']([^"']*\/project\/create\/[^"']*)["']/g)].map((match) => match[1]);
  for (const importPath of createImports) {
    assert.ok(
      /\/create\/(projectCreateModule|projectCreateModules|projectStepsComposition)$/.test(importPath ?? ""),
      `unexpected create/ import in newProjectWizard.ts: ${importPath}`
    );
  }
});

/**
 * The wizard treats projectPlan.confirmationSummary as an opaque
 * readonly string[] - it must never itself construct a Django-specific
 * confirmation line (that content lives only in djangoScaffoldPlan.ts).
 * Targeted at Django's own known summary-line prefixes, not generic
 * user-facing text, so this stays robust against unrelated wording changes.
 */
void test("newProjectWizard.ts does not construct any backend-specific confirmation line itself", () => {
  for (const forbidden of ["Preset:", "Django package:", "Starter app:", "Virtual environment:"]) {
    assert.equal(wizardSource.includes(forbidden), false, `newProjectWizard.ts must not itself build the "${forbidden}" confirmation line`);
  }
});
