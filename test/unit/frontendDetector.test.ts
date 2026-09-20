import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import type { FrontendFrameworkDetection } from "../../src/adapters/frontendFrameworkDetection";
import { nextFrontendDetection } from "../../src/adapters/nextFrontendDetection";
import { viteFrontendDetection } from "../../src/adapters/viteFrontendDetection";
import { DEFAULT_CONFIGURATION, type StackPilotConfiguration } from "../../src/config/configurationModel";
import { detectFrontendProject as detectFrontendProjectWithFrameworkDetection } from "../../src/detection/frontendDetector";
import type { FileSystemProbe } from "../../src/detection/fileSystem";
import { InMemoryFileSystemProbe } from "./fakes/inMemoryFileSystem";

const workspaceRoot = path.resolve("pc-test-fixtures", "frontend-detector");

function configuration(overrides: Partial<StackPilotConfiguration> = {}): StackPilotConfiguration {
  return { ...DEFAULT_CONFIGURATION, ...overrides };
}

function packageJson(scripts: Record<string, string>): string {
  return JSON.stringify({ name: "fixture", scripts });
}

/**
 * Every existing test below exercises real Vite detection, unchanged - see
 * the delegation test at the bottom for proof that this is injected, not
 * hard-coded. NEXTJS-1B: the real production wiring registers Vite AND
 * Next.js together (`extension.ts`); this helper mirrors that exact array,
 * not just Vite alone, so every existing fixture also proves it stays
 * correctly unrecognized-as-Next.js (no regression from adding a second
 * registered detection).
 */
function detectFrontendProject(fs: FileSystemProbe, workspaceRootPath: string, config: StackPilotConfiguration) {
  return detectFrontendProjectWithFrameworkDetection(fs, workspaceRootPath, config, [viteFrontendDetection, nextFrontendDetection]);
}

void test("detects a Vite frontend in ./frontend", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "frontend", "package.json"), packageJson({ dev: "vite", build: "vite build" }))
    .addFile(path.join(workspaceRoot, "frontend", "vite.config.ts"));

  const result = await detectFrontendProject(fs, workspaceRoot, configuration());

  assert.equal(result.selected?.rootPath, path.join(workspaceRoot, "frontend"));
  assert.equal(result.selected?.frameworkConfigPath, path.join(workspaceRoot, "frontend", "vite.config.ts"));
  assert.deepEqual(result.selected?.scripts, { dev: "vite", build: "vite build" });
});

void test("reports no frontend when no package.json is found", async () => {
  const fs = new InMemoryFileSystemProbe();

  const result = await detectFrontendProject(fs, workspaceRoot, configuration());

  assert.equal(result.selected, undefined);
});

void test("prefers the candidate with a Vite config over one without", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "client", "package.json"), packageJson({ start: "node server.js" }))
    .addFile(path.join(workspaceRoot, "frontend", "package.json"), packageJson({ dev: "vite" }))
    .addFile(path.join(workspaceRoot, "frontend", "vite.config.ts"));

  const result = await detectFrontendProject(fs, workspaceRoot, configuration());

  assert.equal(result.selected?.rootPath, path.join(workspaceRoot, "frontend"));
});

void test("uses a configured frontend directory override", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(workspaceRoot, "web", "package.json"), packageJson({ dev: "vite" }));

  const result = await detectFrontendProject(fs, workspaceRoot, configuration({ frontendDirectory: "web" }));

  assert.equal(result.selected?.rootPath, path.join(workspaceRoot, "web"));
});

void test("skips a candidate with invalid package.json and reports a diagnostic", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(workspaceRoot, "frontend", "package.json"), "{ not valid json");

  const result = await detectFrontendProject(fs, workspaceRoot, configuration());

  assert.equal(result.selected, undefined);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.includes("Invalid package.json")));
});

void test("still detects a frontend that is missing the preferred dev script", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(workspaceRoot, "frontend", "package.json"), packageJson({ start: "vite" }));

  const result = await detectFrontendProject(fs, workspaceRoot, configuration());

  assert.equal(result.selected?.rootPath, path.join(workspaceRoot, "frontend"));
  assert.deepEqual(result.selected?.scripts, { start: "vite" });
  assert.equal(Object.hasOwn(result.selected?.scripts ?? {}, "dev"), false);
});

void test("still detects a frontend that has no Vite config file", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(workspaceRoot, "frontend", "package.json"), packageJson({ dev: "node server.js" }));

  const result = await detectFrontendProject(fs, workspaceRoot, configuration());

  assert.equal(result.selected?.rootPath, path.join(workspaceRoot, "frontend"));
  assert.equal(result.selected?.frameworkConfigPath, undefined);
});

void test("ignores a configured frontend directory override that escapes the workspace", async () => {
  const outsidePath = path.resolve(workspaceRoot, "..", "outside", "package.json");
  const fs = new InMemoryFileSystemProbe().addFile(outsidePath, packageJson({ dev: "vite" }));

  const result = await detectFrontendProject(fs, workspaceRoot, configuration({ frontendDirectory: "../outside" }));

  assert.equal(result.selected, undefined);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.includes("outside the workspace")));
});

void test("ignores a frontend candidate whose package.json is a symlink escaping the workspace", async () => {
  const outsideTarget = path.resolve(workspaceRoot, "..", "outside", "package.json");
  const fs = new InMemoryFileSystemProbe()
    .addFile(outsideTarget, packageJson({ dev: "vite" }))
    .addSymlink(path.join(workspaceRoot, "frontend", "package.json"), outsideTarget);

  const result = await detectFrontendProject(fs, workspaceRoot, configuration());

  assert.equal(result.selected, undefined);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.includes("escapes the workspace through a symlink")));
});

void test("detects a Vite frontend at a workspace root containing spaces and Unicode characters", async () => {
  const unicodeWorkspaceRoot = path.resolve("pc-test-fixtures", "Projekt Ördner 日本語");
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(unicodeWorkspaceRoot, "frontend", "package.json"), packageJson({ dev: "vite" }))
    .addFile(path.join(unicodeWorkspaceRoot, "frontend", "vite.config.ts"));

  const result = await detectFrontendProject(fs, unicodeWorkspaceRoot, configuration());

  assert.equal(result.selected?.rootPath, path.join(unicodeWorkspaceRoot, "frontend"));
});

void test("detectFrontendProject has no knowledge of 'vite.config' itself - a package.json alone still qualifies, and the injected framework detection only adds evidence", async () => {
  // Proves detectFrontendProject is framework-detection-driven, not Vite-
  // specific itself: a fake framework detection that reports a completely
  // different config file name must have that path reflected verbatim as
  // evidence, and a directory with only package.json (the fake detection
  // finds nothing) must still be a valid candidate - config-file evidence
  // only boosts confidence, it never gates candidacy.
  const fakeDetection: FrontendFrameworkDetection = {
    frameworkId: "fake-framework",
    findFrameworkConfigPath: (_fs, rootPath) => Promise.resolve(path.join(rootPath, "fake.config.js"))
  };
  const fs = new InMemoryFileSystemProbe().addFile(path.join(workspaceRoot, "frontend", "package.json"), packageJson({ dev: "fake" }));

  const result = await detectFrontendProjectWithFrameworkDetection(fs, workspaceRoot, configuration(), [fakeDetection]);

  assert.equal(result.selected?.rootPath, path.join(workspaceRoot, "frontend"));
  assert.equal(result.selected?.frameworkConfigPath, path.join(workspaceRoot, "frontend", "fake.config.js"));
  assert.deepEqual(result.selected?.evidence, ["package.json", "fake.config.js"]);
});

// ---- NEXTJS-1B: frontend framework pluralization -----------------------

void test("detects a Next.js frontend via dependencies.next, with no config file", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(
    path.join(workspaceRoot, "frontend", "package.json"),
    JSON.stringify({ name: "fixture", scripts: { dev: "next dev" }, dependencies: { next: "16.3.5" } })
  );

  const result = await detectFrontendProject(fs, workspaceRoot, configuration());

  assert.equal(result.selected?.rootPath, path.join(workspaceRoot, "frontend"));
  assert.equal(result.selected?.frameworkId, "next");
});

void test("first matching registered frontend detector wins: Vite evidence still resolves to 'vite', not 'next', when both are registered", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "frontend", "package.json"), packageJson({ dev: "vite" }))
    .addFile(path.join(workspaceRoot, "frontend", "vite.config.ts"));

  const result = await detectFrontendProject(fs, workspaceRoot, configuration());

  assert.equal(result.selected?.frameworkId, "vite");
});

void test("a generic, unrecognized Node frontend (neither Vite nor Next.js evidence) still degrades safely to frameworkId undefined", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(workspaceRoot, "frontend", "package.json"), packageJson({ dev: "node server.js" }));

  const result = await detectFrontendProject(fs, workspaceRoot, configuration());

  assert.equal(result.selected?.rootPath, path.join(workspaceRoot, "frontend"));
  assert.equal(result.selected?.frameworkId, undefined);
});

void test("a configured frontend directory override works identically for a Next.js candidate", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(
    path.join(workspaceRoot, "web", "package.json"),
    JSON.stringify({ name: "fixture", scripts: { dev: "next dev" }, dependencies: { next: "16.3.5" } })
  );

  const result = await detectFrontendProject(fs, workspaceRoot, configuration({ frontendDirectory: "web" }));

  assert.equal(result.selected?.rootPath, path.join(workspaceRoot, "web"));
  assert.equal(result.selected?.frameworkId, "next");
});
