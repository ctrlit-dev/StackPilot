import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import { DEFAULT_CONFIGURATION, type StackPilotConfiguration } from "../../src/config/configurationModel";
import { detectFrontendProject } from "../../src/detection/frontendDetector";
import { InMemoryFileSystemProbe } from "./fakes/inMemoryFileSystem";

const workspaceRoot = path.resolve("pc-test-fixtures", "frontend-detector");

function configuration(overrides: Partial<StackPilotConfiguration> = {}): StackPilotConfiguration {
  return { ...DEFAULT_CONFIGURATION, ...overrides };
}

function packageJson(scripts: Record<string, string>): string {
  return JSON.stringify({ name: "fixture", scripts });
}

void test("detects a Vite frontend in ./frontend", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "frontend", "package.json"), packageJson({ dev: "vite", build: "vite build" }))
    .addFile(path.join(workspaceRoot, "frontend", "vite.config.ts"));

  const result = await detectFrontendProject(fs, workspaceRoot, configuration());

  assert.equal(result.selected?.rootPath, path.join(workspaceRoot, "frontend"));
  assert.equal(result.selected?.viteConfigPath, path.join(workspaceRoot, "frontend", "vite.config.ts"));
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
  assert.equal(result.selected?.viteConfigPath, undefined);
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
