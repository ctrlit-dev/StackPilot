import assert from "node:assert/strict";
import test from "node:test";

import { buildNextScaffoldCommand } from "../../src/execution/nextScaffoldCommand";

const NEXTJS_PRESET_FLAGS = ["--ts", "--tailwind", "--eslint", "--app", "--src-dir", "--import-alias", "@/*", "--disable-git"];

void test("builds the empirically-verified non-interactive npm scaffold command", () => {
  const command = buildNextScaffoldCommand("npm", "C:\\projects\\my-app");
  assert.equal(command.executable, "npx");
  assert.deepEqual(command.args, ["--yes", "create-next-app@latest", ".", ...NEXTJS_PRESET_FLAGS, "--use-npm", "--yes"]);
  assert.equal(command.cwd, "C:\\projects\\my-app");
});

void test("builds the documented pnpm scaffold command with the explicit --use-pnpm flag", () => {
  const command = buildNextScaffoldCommand("pnpm", "C:\\projects\\my-app");
  assert.equal(command.executable, "pnpm");
  assert.deepEqual(command.args, ["create", "next-app", ".", ...NEXTJS_PRESET_FLAGS, "--use-pnpm", "--yes"]);
});

void test("builds the documented yarn scaffold command with the explicit --use-yarn flag", () => {
  const command = buildNextScaffoldCommand("yarn", "C:\\projects\\my-app");
  assert.equal(command.executable, "yarn");
  assert.deepEqual(command.args, ["create", "next-app", ".", ...NEXTJS_PRESET_FLAGS, "--use-yarn", "--yes"]);
});

void test("builds the documented bun scaffold command with the explicit --use-bun flag", () => {
  const command = buildNextScaffoldCommand("bun", "C:\\projects\\my-app");
  assert.equal(command.executable, "bun");
  assert.deepEqual(command.args, ["create", "next-app", ".", ...NEXTJS_PRESET_FLAGS, "--use-bun", "--yes"]);
});

void test("every package manager's argv includes the deterministic preset flags and --disable-git", () => {
  for (const manager of ["npm", "pnpm", "yarn", "bun"] as const) {
    const command = buildNextScaffoldCommand(manager, "C:\\projects\\my-app");
    for (const flag of NEXTJS_PRESET_FLAGS) {
      assert.ok(command.args.includes(flag), `${manager} argv must include ${flag}`);
    }
  }
});

void test("targets the root directory ('.') for every package manager, never a nested subfolder name", () => {
  for (const manager of ["npm", "pnpm", "yarn", "bun"] as const) {
    const command = buildNextScaffoldCommand(manager, "C:\\projects\\my-app");
    assert.ok(command.args.includes("."), `${manager} argv must scaffold into the already-created project root ('.')`);
  }
});

void test("uses no shell - executable and args are always separate, never a concatenated command string", () => {
  const command = buildNextScaffoldCommand("npm", "C:\\projects\\my-app");
  assert.equal(typeof command.executable, "string");
  assert.ok(Array.isArray(command.args));
  for (const arg of command.args) {
    assert.equal(typeof arg, "string");
  }
});
