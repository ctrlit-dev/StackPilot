import assert from "node:assert/strict";
import test from "node:test";

import { buildViteScaffoldCommand } from "../../src/execution/viteScaffoldCommand";

void test("builds the empirically-verified non-interactive npm scaffold command", () => {
  const command = buildViteScaffoldCommand("npm", "my-app", "react-ts", "C:\\projects");
  assert.equal(command.executable, "npm");
  assert.deepEqual(command.args, ["create", "vite@latest", "my-app", "--yes", "--", "--template", "react-ts", "--no-interactive"]);
  assert.equal(command.cwd, "C:\\projects");
});

void test("builds the documented pnpm scaffold command", () => {
  const command = buildViteScaffoldCommand("pnpm", "my-app", "react", "C:\\projects");
  assert.equal(command.executable, "pnpm");
  assert.deepEqual(command.args, ["create", "vite", "my-app", "--template", "react", "--no-interactive"]);
});

void test("builds the documented yarn scaffold command", () => {
  const command = buildViteScaffoldCommand("yarn", "my-app", "react-ts", "C:\\projects");
  assert.deepEqual(command.args, ["create", "vite", "my-app", "--template", "react-ts", "--no-interactive"]);
});

void test("builds the documented bun scaffold command", () => {
  const command = buildViteScaffoldCommand("bun", "my-app", "react-ts", "C:\\projects");
  assert.deepEqual(command.args, ["create", "vite", "my-app", "--template", "react-ts", "--no-interactive"]);
});
