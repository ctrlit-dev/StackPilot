import assert from "node:assert/strict";
import test from "node:test";

import type { FrontendProject } from "../../src/detection/frontendDetector";
import { buildFrontendDevCommand } from "../../src/execution/frontendCommand";

function frontend(): FrontendProject {
  return {
    rootPath: "/workspace/frontend",
    packageJsonPath: "/workspace/frontend/package.json",
    viteConfigPath: "/workspace/frontend/vite.config.ts",
    scripts: { dev: "vite" },
    packageManager: { kind: "detected", manager: "npm", source: "lockfile", evidence: "package-lock.json" },
    score: 90,
    evidence: ["package.json", "vite.config.ts"]
  };
}

void test("builds 'npm run <script>' for npm", () => {
  const command = buildFrontendDevCommand(frontend(), "npm", "dev", 5173);
  assert.equal(command.executable, "npm");
  assert.deepEqual(command.args, ["run", "dev"]);
  assert.equal(command.cwd, "/workspace/frontend");
  assert.equal(command.expectedPort, 5173);
});

void test("builds 'pnpm <script>' for pnpm", () => {
  const command = buildFrontendDevCommand(frontend(), "pnpm", "dev");
  assert.equal(command.executable, "pnpm");
  assert.deepEqual(command.args, ["dev"]);
});

void test("builds 'yarn <script>' for yarn", () => {
  const command = buildFrontendDevCommand(frontend(), "yarn", "dev");
  assert.equal(command.executable, "yarn");
  assert.deepEqual(command.args, ["dev"]);
});

void test("builds 'bun run <script>' for bun", () => {
  const command = buildFrontendDevCommand(frontend(), "bun", "dev");
  assert.equal(command.executable, "bun");
  assert.deepEqual(command.args, ["run", "dev"]);
});

void test("uses the configured script name rather than assuming 'dev'", () => {
  const command = buildFrontendDevCommand(frontend(), "npm", "start");
  assert.deepEqual(command.args, ["run", "start"]);
});

void test("does not force a --port flag, leaving Vite free to pick its own port", () => {
  const command = buildFrontendDevCommand(frontend(), "npm", "dev", 5173);
  assert.ok(!command.args.includes("--port"));
});
