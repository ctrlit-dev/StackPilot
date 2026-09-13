import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import {
  COMMAND_BUILD_FRONTEND,
  COMMAND_CREATE_DJANGO_APP,
  COMMAND_CREATE_PROJECT,
  COMMAND_CREATE_SUPERUSER,
  COMMAND_CREATE_VIRTUAL_ENVIRONMENT,
  COMMAND_INITIALIZE_PROJECT,
  COMMAND_INSTALL_FRONTEND_DEPENDENCIES,
  COMMAND_INSTALL_PYTHON_DEPENDENCIES,
  COMMAND_MAKE_MIGRATIONS,
  COMMAND_MIGRATE,
  COMMAND_OPEN_APPLICATION,
  COMMAND_OPEN_DJANGO_SHELL,
  COMMAND_OPEN_LOGS,
  COMMAND_OPEN_SETTINGS,
  COMMAND_REFRESH,
  COMMAND_RUN_DJANGO_TESTS,
  COMMAND_RUN_FRONTEND_TESTS,
  COMMAND_SELECT_WORKSPACE,
  COMMAND_SHOW_MIGRATIONS,
  COMMAND_START_ALL,
  COMMAND_START_BACKEND,
  COMMAND_START_FRONTEND,
  COMMAND_STOP_ALL,
  COMMAND_STOP_BACKEND,
  COMMAND_STOP_FRONTEND,
  VIEW_ID
} from "../../../src/constants";

function hasPackageName(packageJson: unknown, name: string): boolean {
  return (
    typeof packageJson === "object" &&
    packageJson !== null &&
    "name" in packageJson &&
    packageJson.name === name
  );
}

export async function run(): Promise<void> {
  await vscode.commands.executeCommand(COMMAND_REFRESH);

  const extension = vscode.extensions.all.find((candidate) => hasPackageName(candidate.packageJSON, "stackpilot"));
  assert.ok(extension, "development extension should be discoverable");
  assert.equal(extension.isActive, true, "refresh command should activate the extension");

  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes(COMMAND_REFRESH), "refresh command should be registered");
  assert.ok(commands.includes(COMMAND_SELECT_WORKSPACE), "workspace selection command should be registered");
  for (const command of [
    COMMAND_START_BACKEND,
    COMMAND_STOP_BACKEND,
    COMMAND_START_FRONTEND,
    COMMAND_STOP_FRONTEND,
    COMMAND_START_ALL,
    COMMAND_STOP_ALL,
    COMMAND_OPEN_LOGS,
    COMMAND_OPEN_SETTINGS,
    COMMAND_MAKE_MIGRATIONS,
    COMMAND_MIGRATE,
    COMMAND_SHOW_MIGRATIONS,
    COMMAND_CREATE_SUPERUSER,
    COMMAND_OPEN_DJANGO_SHELL,
    COMMAND_CREATE_DJANGO_APP,
    COMMAND_RUN_DJANGO_TESTS,
    COMMAND_INSTALL_PYTHON_DEPENDENCIES,
    COMMAND_INSTALL_FRONTEND_DEPENDENCIES,
    COMMAND_BUILD_FRONTEND,
    COMMAND_RUN_FRONTEND_TESTS,
    COMMAND_CREATE_VIRTUAL_ENVIRONMENT,
    COMMAND_INITIALIZE_PROJECT,
    COMMAND_CREATE_PROJECT,
    COMMAND_OPEN_APPLICATION
  ]) {
    assert.ok(commands.includes(command), `${command} should be registered`);
  }

  // The extension itself owns the one createTreeView() registration for this
  // id (created during activate()); a second registration for the same id
  // would throw, so this only checks it was contributed in the manifest.
  const extensionPackageJson = extension.packageJSON as { contributes?: { views?: Record<string, Array<{ id: string }>> } };
  const declaredViewIds = Object.values(extensionPackageJson.contributes?.views ?? {}).flat().map((view) => view.id);
  assert.ok(declaredViewIds.includes(VIEW_ID), "StackPilot tree view should be contributed in package.json");
}
