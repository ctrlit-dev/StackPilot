import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

interface CommandContribution {
  readonly command: string;
  readonly enablement?: string;
}

const DJANGO_ONLY_COMMANDS = [
  "stackPilot.makeMigrations",
  "stackPilot.migrate",
  "stackPilot.showMigrations",
  "stackPilot.createSuperuser",
  "stackPilot.openDjangoShell",
  "stackPilot.openDbShell",
  "stackPilot.createDjangoApp",
  "stackPilot.runDjangoTests",
  "stackPilot.runManagementCommand",
  "stackPilot.djangoAppMakeMigrations",
  "stackPilot.djangoAppMigrate",
  "stackPilot.djangoAppShowMigrations",
  "stackPilot.djangoAppTest"
] as const;

function loadCommands(): readonly CommandContribution[] {
  const packageJsonPath = path.join(__dirname, "..", "..", "..", "package.json");
  const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    contributes: { commands: readonly CommandContribution[] };
  };
  return manifest.contributes.commands;
}

void test("every Django-only command is gated by stackPilot.hasDjangoBackend, not the backend-generic key", () => {
  const commands = loadCommands();
  for (const id of DJANGO_ONLY_COMMANDS) {
    const command = commands.find((c) => c.command === id);
    assert.ok(command !== undefined, `expected package.json to contribute command ${id}`);
    assert.equal(command?.enablement, "stackPilot.hasDjangoBackend", `unexpected enablement for ${id}`);
  }
});

void test("Open Admin is gated by backendRunning && hasDjangoBackend", () => {
  const commands = loadCommands();
  const openAdmin = commands.find((c) => c.command === "stackPilot.openAdmin");
  assert.equal(openAdmin?.enablement, "stackPilot.backendRunning && stackPilot.hasDjangoBackend");
});

void test("backend-generic Python lifecycle commands are NOT narrowed to Django-only", () => {
  const commands = loadCommands();
  const installDeps = commands.find((c) => c.command === "stackPilot.installPythonDependencies");
  const createVenv = commands.find((c) => c.command === "stackPilot.createVirtualEnvironment");
  assert.equal(installDeps?.enablement, "stackPilot.hasBackend");
  assert.equal(createVenv?.enablement, "stackPilot.hasBackend");
});
