import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import { DEFAULT_CONFIGURATION } from "../../src/config/configurationModel";
import type { PackageManager } from "../../src/detection/packageManagerDetector";
import { DEFAULT_EXPRESS_PRESET_ID, EXPRESS_PRESETS, findExpressPreset } from "../../src/project/create/express/expressNewProjectPresets";
import {
  buildExpressCreatePlan,
  normalizeNpmPackageName,
  resolveExpressProjectPaths,
  type ExpressInputs,
  type ExpressScaffoldContext
} from "../../src/project/create/express/expressScaffoldPlan";
import { executeScaffoldSteps } from "../../src/project/scaffoldStep";
import { FakeProcessSpawner } from "./fakes/fakeProcessSpawner";
import { InMemoryProjectFileWriter } from "./fakes/inMemoryProjectFileWriter";

const parentDirectory = path.resolve("pc-test-fixtures", "new-project");

function expressInputs(overrides: Partial<ExpressInputs> = {}): ExpressInputs {
  return {
    preset: findExpressPreset("express-only"),
    packageManager: "npm",
    ...overrides
  };
}

function scaffoldContext(spawner: FakeProcessSpawner, writer: InMemoryProjectFileWriter, projectName = "orders-api"): ExpressScaffoldContext {
  return {
    parentDirectory,
    projectName,
    projectFileWriter: writer,
    spawner,
    onOutput: () => undefined,
    configuration: DEFAULT_CONFIGURATION
  };
}

// --- Presets ---

void test("DEFAULT_EXPRESS_PRESET_ID resolves via findExpressPreset()", () => {
  const preset = findExpressPreset(DEFAULT_EXPRESS_PRESET_ID);
  assert.equal(preset.id, "express-vite-react-ts");
  assert.equal(preset.includesFrontend, true);
  assert.equal(preset.viteTemplate, "react-ts");
});

void test("EXPRESS_PRESETS contains exactly express-vite-react-ts and express-only, no more, no fewer", () => {
  assert.deepEqual(
    EXPRESS_PRESETS.map((preset) => preset.id),
    ["express-vite-react-ts", "express-only"]
  );
});

void test("findExpressPreset throws for an unknown id", () => {
  // @ts-expect-error deliberately invalid id
  assert.throws(() => findExpressPreset("express-does-not-exist"));
});

void test("resolveExpressProjectPaths lays out the project flat at the project root, no backend/ nesting", () => {
  const context = scaffoldContext(new FakeProcessSpawner(), new InMemoryProjectFileWriter());
  const paths = resolveExpressProjectPaths(context);
  assert.equal(paths.projectRoot, path.join(parentDirectory, "orders-api"));
});

// --- Express-only plan ---

void test("a full express-only run completes every step in order and returns a matching plan", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const inputs = expressInputs();
  const context = scaffoldContext(spawner, writer);
  const paths = resolveExpressProjectPaths(context);

  spawner.queueAutoSuccess(); // install-dependencies

  const plan = buildExpressCreatePlan(context, inputs);
  const result = await executeScaffoldSteps(plan.steps);

  assert.equal(result.failedStep, undefined);
  assert.equal(plan.projectRoot, paths.projectRoot);
  assert.equal(plan.frontend, undefined);
  assert.deepEqual(plan.gitignoreEntries, []);
  assert.equal(plan.readmeHeaderNote, "Generated with the **Express only** preset.");
  assert.deepEqual(plan.vscodeSettings, {});
  assert.deepEqual(plan.confirmationSummary, ["Preset: Express only", "Package manager: npm"]);
  assert.deepEqual(
    plan.steps.map((step) => step.id),
    ["write-package-json", "write-index-js", "install-dependencies"]
  );
});

void test("package.json and index.js are written before install-dependencies runs (install reads package.json)", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const inputs = expressInputs();
  const context = scaffoldContext(spawner, writer);
  const paths = resolveExpressProjectPaths(context);

  spawner.queueAutoSuccess();

  const plan = buildExpressCreatePlan(context, inputs);
  await executeScaffoldSteps(plan.steps);

  assert.ok(writer.files.has(path.resolve(path.join(paths.projectRoot, "package.json"))));
  assert.ok(writer.files.has(path.resolve(path.join(paths.projectRoot, "index.js"))));
  assert.equal(spawner.spawnCalls.length, 1);
  assert.equal(spawner.spawnCalls[0]?.executable, "npm");
  assert.deepEqual(spawner.spawnCalls[0]?.args, ["install"]);
  assert.equal(spawner.spawnCalls[0]?.cwd, paths.projectRoot);
});

void test("package.json content matches the expected contract", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const inputs = expressInputs();
  const context = scaffoldContext(spawner, writer, "My Express App");
  const paths = resolveExpressProjectPaths(context);

  spawner.queueAutoSuccess();
  const plan = buildExpressCreatePlan(context, inputs);
  await executeScaffoldSteps(plan.steps);

  const content = writer.files.get(path.resolve(path.join(paths.projectRoot, "package.json")));
  assert.notEqual(content, undefined);
  const parsed = JSON.parse(content ?? "{}") as Record<string, unknown>;
  assert.equal(parsed.name, "my-express-app");
  assert.equal(parsed.version, "1.0.0");
  assert.equal(parsed.private, true);
  assert.deepEqual(parsed.scripts, { dev: "node index.js", start: "node index.js" });
  assert.deepEqual(parsed.dependencies, { express: "^5.0.0" });
  assert.equal("type" in parsed, false);
  assert.equal("devDependencies" in parsed, false);
});

void test("index.js contains binding-aware Express evidence and HOST/PORT reads", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const inputs = expressInputs();
  const context = scaffoldContext(spawner, writer);
  const paths = resolveExpressProjectPaths(context);

  spawner.queueAutoSuccess();
  const plan = buildExpressCreatePlan(context, inputs);
  await executeScaffoldSteps(plan.steps);

  const content = writer.files.get(path.resolve(path.join(paths.projectRoot, "index.js"))) ?? "";
  assert.match(content, /const express = require\(["']express["']\)/);
  assert.match(content, /const app = express\(\)/);
  assert.match(content, /process\.env\.PORT/);
  assert.match(content, /process\.env\.HOST/);
});

void test("express-only plan never writes any Python artifact", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const inputs = expressInputs();
  const context = scaffoldContext(spawner, writer);

  spawner.queueAutoSuccess();
  const plan = buildExpressCreatePlan(context, inputs);
  await executeScaffoldSteps(plan.steps);

  for (const filePath of writer.files.keys()) {
    assert.ok(!filePath.endsWith("manage.py"));
    assert.ok(!filePath.endsWith("requirements.txt"));
    assert.ok(!filePath.includes(".venv"));
  }
});

void test("express-only plan never writes .gitignore/README.md/.vscode/settings.json itself - shared-root-writer-owned", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const inputs = expressInputs();
  const context = scaffoldContext(spawner, writer);
  const paths = resolveExpressProjectPaths(context);

  spawner.queueAutoSuccess();
  const plan = buildExpressCreatePlan(context, inputs);
  await executeScaffoldSteps(plan.steps);

  assert.equal(writer.files.has(path.resolve(path.join(paths.projectRoot, ".gitignore"))), false);
  assert.equal(writer.files.has(path.resolve(path.join(paths.projectRoot, "README.md"))), false);
  assert.equal(writer.files.has(path.resolve(path.join(paths.projectRoot, ".vscode", "settings.json"))), false);
  assert.deepEqual(plan.gitignoreEntries, []);
});

void test("stops at install-dependencies when it fails, having already written package.json and index.js", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const inputs = expressInputs();
  const context = scaffoldContext(spawner, writer);
  const paths = resolveExpressProjectPaths(context);

  spawner.queueAutoSuccess({ code: 1, signal: null }); // install-dependencies fails

  const plan = buildExpressCreatePlan(context, inputs);
  const result = await executeScaffoldSteps(plan.steps);

  assert.equal(result.failedStep?.id, "install-dependencies");
  assert.ok(writer.files.has(path.resolve(path.join(paths.projectRoot, "package.json"))));
  assert.ok(writer.files.has(path.resolve(path.join(paths.projectRoot, "index.js"))));
});

// --- Package manager matrix ---

const PACKAGE_MANAGERS: readonly PackageManager[] = ["npm", "pnpm", "yarn", "bun"];

for (const manager of PACKAGE_MANAGERS) {
  void test(`install step uses '${manager} install' with structured argv, never a shell string`, async () => {
    const spawner = new FakeProcessSpawner();
    const writer = new InMemoryProjectFileWriter();
    const inputs = expressInputs({ packageManager: manager });
    const context = scaffoldContext(spawner, writer);
    const paths = resolveExpressProjectPaths(context);

    spawner.queueAutoSuccess();
    const plan = buildExpressCreatePlan(context, inputs);
    await executeScaffoldSteps(plan.steps);

    const installCall = spawner.spawnCalls.find((call) => call.args.includes("install"));
    assert.equal(installCall?.executable, manager);
    assert.deepEqual(installCall?.args, ["install"]);
    assert.equal(installCall?.cwd, paths.projectRoot);
  });
}

// --- Express + Vite plan ---

void test("the express-vite-react-ts preset requests a Vite frontend with the shared package manager and react-ts template", () => {
  const context = scaffoldContext(new FakeProcessSpawner(), new InMemoryProjectFileWriter());
  const inputs = expressInputs({ preset: findExpressPreset("express-vite-react-ts"), packageManager: "pnpm" });

  const plan = buildExpressCreatePlan(context, inputs);

  assert.deepEqual(plan.frontend, { packageManager: "pnpm", template: "react-ts", frontendPort: DEFAULT_CONFIGURATION.frontendPort });
});

void test("the express-only preset never requests a frontend", () => {
  const context = scaffoldContext(new FakeProcessSpawner(), new InMemoryProjectFileWriter());
  const inputs = expressInputs({ preset: findExpressPreset("express-only") });

  const plan = buildExpressCreatePlan(context, inputs);

  assert.equal(plan.frontend, undefined);
});

void test("Express's own plan.steps never scaffold a Vite frontend directly - the generic composer owns that", () => {
  const context = scaffoldContext(new FakeProcessSpawner(), new InMemoryProjectFileWriter());
  const inputs = expressInputs({ preset: findExpressPreset("express-vite-react-ts") });

  const plan = buildExpressCreatePlan(context, inputs);

  assert.ok(!plan.steps.some((step) => step.id.includes("vite") || step.id.includes("frontend")));
  assert.deepEqual(
    plan.steps.map((step) => step.id),
    ["write-package-json", "write-index-js", "install-dependencies"]
  );
});

// --- normalizeNpmPackageName ---
// Every expected value below is hand-derived from the exact documented
// transformation order (lowercase -> trim -> replace disallowed runs with
// "-" -> strip leading "."/"_" -> strip leading/trailing "-" -> slice(214)
// -> strip a trailing "-" introduced exactly at the cut).

const NORMALIZE_CASES: readonly { readonly input: string; readonly expected: string }[] = [
  { input: "My Express App", expected: "my-express-app" },
  { input: "My_App", expected: "my_app" },
  { input: ".hidden", expected: "hidden" },
  { input: "_private", expected: "private" },
  { input: "TEST APP", expected: "test-app" },
  { input: "你好", expected: "express-app" },
  { input: "!!!", expected: "express-app" },
  { input: "___", expected: "express-app" },
  { input: "already-valid-name", expected: "already-valid-name" },
  // Unicode mixed with ASCII: "é" is stripped (replaced), the trailing
  // dash that replacement leaves behind is then stripped too.
  { input: "café", expected: "caf" }
];

for (const { input, expected } of NORMALIZE_CASES) {
  void test(`normalizeNpmPackageName(${JSON.stringify(input)}) === ${JSON.stringify(expected)}`, () => {
    assert.equal(normalizeNpmPackageName(input), expected);
  });
}

void test("normalizeNpmPackageName caps the result at 214 characters", () => {
  const longName = "a".repeat(300);
  const result = normalizeNpmPackageName(longName);
  assert.equal(result.length, 214);
  assert.equal(result, "a".repeat(214));
});

void test("normalizeNpmPackageName never leaves a dangling trailing '-' introduced exactly at the 214-char cut", () => {
  // Character 214 (1-indexed) is the space, which becomes "-" right at the slice boundary.
  const longName = `${"a".repeat(213)} b`;
  const result = normalizeNpmPackageName(longName);
  assert.equal(result, "a".repeat(213));
  assert.ok(!result.endsWith("-"));
});

void test("normalizeNpmPackageName leaves an already-npm-safe name unchanged (identity)", () => {
  assert.equal(normalizeNpmPackageName("orders-api"), "orders-api");
});
