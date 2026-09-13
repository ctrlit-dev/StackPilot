import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFrontendBuildCommand,
  buildFrontendInstallCommand,
  buildFrontendTestCommand
} from "../../src/execution/frontendOperationCommand";

const rootPath = "/workspace/frontend";

void test("builds a plain 'npm install', never 'npm ci'", () => {
  const command = buildFrontendInstallCommand(rootPath, "npm");
  assert.equal(command.executable, "npm");
  assert.deepEqual(command.args, ["install"]);
  assert.equal(command.args.includes("ci"), false);
});

void test("builds the install command for pnpm/yarn/bun as their direct 'install' subcommand", () => {
  assert.deepEqual(buildFrontendInstallCommand(rootPath, "pnpm"), { executable: "pnpm", args: ["install"], cwd: "/workspace/frontend" });
  assert.deepEqual(buildFrontendInstallCommand(rootPath, "yarn"), { executable: "yarn", args: ["install"], cwd: "/workspace/frontend" });
  assert.deepEqual(buildFrontendInstallCommand(rootPath, "bun"), { executable: "bun", args: ["install"], cwd: "/workspace/frontend" });
});

void test("builds the configured build script via 'npm run <script>'", () => {
  const command = buildFrontendBuildCommand(rootPath, "npm", "build");
  assert.equal(command.executable, "npm");
  assert.deepEqual(command.args, ["run", "build"]);
});

void test("builds the configured test script via the package manager's run form", () => {
  const command = buildFrontendTestCommand(rootPath, "pnpm", "test");
  assert.equal(command.executable, "pnpm");
  assert.deepEqual(command.args, ["test"]);
});
