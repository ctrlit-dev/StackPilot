import assert from "node:assert/strict";
import test from "node:test";

import type { FrontendProject } from "../../src/detection/frontendDetector";
import {
  buildFrontendBuildCommand,
  buildFrontendInstallCommand,
  buildFrontendTestCommand
} from "../../src/execution/frontendOperationCommand";

function frontend(): FrontendProject {
  return {
    rootPath: "/workspace/frontend",
    packageJsonPath: "/workspace/frontend/package.json",
    scripts: { dev: "vite", build: "vite build", test: "vitest" },
    packageManager: { kind: "detected", manager: "npm", source: "lockfile", evidence: "package-lock.json" },
    score: 90,
    evidence: []
  };
}

void test("builds a plain 'npm install', never 'npm ci'", () => {
  const command = buildFrontendInstallCommand(frontend(), "npm");
  assert.equal(command.executable, "npm");
  assert.deepEqual(command.args, ["install"]);
  assert.equal(command.args.includes("ci"), false);
});

void test("builds the install command for pnpm/yarn/bun as their direct 'install' subcommand", () => {
  assert.deepEqual(buildFrontendInstallCommand(frontend(), "pnpm"), { executable: "pnpm", args: ["install"], cwd: "/workspace/frontend" });
  assert.deepEqual(buildFrontendInstallCommand(frontend(), "yarn"), { executable: "yarn", args: ["install"], cwd: "/workspace/frontend" });
  assert.deepEqual(buildFrontendInstallCommand(frontend(), "bun"), { executable: "bun", args: ["install"], cwd: "/workspace/frontend" });
});

void test("builds the configured build script via 'npm run <script>'", () => {
  const command = buildFrontendBuildCommand(frontend(), "npm", "build");
  assert.equal(command.executable, "npm");
  assert.deepEqual(command.args, ["run", "build"]);
});

void test("builds the configured test script via the package manager's run form", () => {
  const command = buildFrontendTestCommand(frontend(), "pnpm", "test");
  assert.equal(command.executable, "pnpm");
  assert.deepEqual(command.args, ["test"]);
});
