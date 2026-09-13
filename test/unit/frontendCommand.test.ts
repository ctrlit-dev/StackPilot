import assert from "node:assert/strict";
import test from "node:test";

import { buildFrontendDevCommand } from "../../src/execution/frontendCommand";

const rootPath = "/workspace/frontend";

void test("builds 'npm run <script>' for npm", () => {
  const command = buildFrontendDevCommand(rootPath, "npm", "dev", 5173);
  assert.equal(command.executable, "npm");
  assert.deepEqual(command.args, ["run", "dev"]);
  assert.equal(command.cwd, "/workspace/frontend");
  assert.equal(command.expectedPort, 5173);
});

void test("builds 'pnpm <script>' for pnpm", () => {
  const command = buildFrontendDevCommand(rootPath, "pnpm", "dev");
  assert.equal(command.executable, "pnpm");
  assert.deepEqual(command.args, ["dev"]);
});

void test("builds 'yarn <script>' for yarn", () => {
  const command = buildFrontendDevCommand(rootPath, "yarn", "dev");
  assert.equal(command.executable, "yarn");
  assert.deepEqual(command.args, ["dev"]);
});

void test("builds 'bun run <script>' for bun", () => {
  const command = buildFrontendDevCommand(rootPath, "bun", "dev");
  assert.equal(command.executable, "bun");
  assert.deepEqual(command.args, ["run", "dev"]);
});

void test("uses the configured script name rather than assuming 'dev'", () => {
  const command = buildFrontendDevCommand(rootPath, "npm", "start");
  assert.deepEqual(command.args, ["run", "start"]);
});

void test("does not force a --port flag, leaving Vite free to pick its own port", () => {
  const command = buildFrontendDevCommand(rootPath, "npm", "dev", 5173);
  assert.ok(!command.args.includes("--port"));
});
