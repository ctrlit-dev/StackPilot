import * as path from "node:path";
import * as vscode from "vscode";
import {
  COMMAND_CREATE_DJANGO_APP,
  COMMAND_CREATE_SUPERUSER,
  COMMAND_INSTALL_PYTHON_DEPENDENCIES,
  COMMAND_MAKE_MIGRATIONS,
  COMMAND_MIGRATE,
  COMMAND_OPEN_DB_SHELL,
  COMMAND_OPEN_DJANGO_SHELL,
  COMMAND_REFRESH,
  COMMAND_RUN_DJANGO_TESTS,
  COMMAND_RUN_MANAGEMENT_COMMAND,
  COMMAND_SHOW_MIGRATIONS
} from "../constants";
import { getBackendService } from "../detection/detectedProject";
import { showActionableError } from "../ui/notifications";
import { splitCommandArguments } from "../utils/commandLine";
import {
  planCreateApp,
  planCreateSuperuser,
  planDbShell,
  planDjangoShell,
  planDjangoTest,
  planInstallPythonDependencies,
  planMakeMigrations,
  planManagementCommand,
  planMigrate,
  planShowMigrations
} from "./backendOperationPlans";
import type { CommandContext } from "./commandContext";
import { offerToRegisterInstalledApp } from "./installedAppsCommand";
import { runAndReport } from "./operationRunner";

export function registerBackendOperationCommands(context: CommandContext): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(COMMAND_MAKE_MIGRATIONS, () => makeMigrations(context)),
    vscode.commands.registerCommand(COMMAND_MIGRATE, () => migrate(context)),
    vscode.commands.registerCommand(COMMAND_SHOW_MIGRATIONS, () => showMigrations(context)),
    vscode.commands.registerCommand(COMMAND_RUN_DJANGO_TESTS, () => runDjangoTests(context)),
    vscode.commands.registerCommand(COMMAND_CREATE_DJANGO_APP, () => createDjangoApp(context)),
    vscode.commands.registerCommand(COMMAND_OPEN_DJANGO_SHELL, () => openDjangoShell(context)),
    vscode.commands.registerCommand(COMMAND_OPEN_DB_SHELL, () => openDbShell(context)),
    vscode.commands.registerCommand(COMMAND_CREATE_SUPERUSER, () => createSuperuser(context)),
    vscode.commands.registerCommand(COMMAND_INSTALL_PYTHON_DEPENDENCIES, () => installPythonDependencies(context)),
    vscode.commands.registerCommand(COMMAND_RUN_MANAGEMENT_COMMAND, () => runManagementCommand(context))
  ];
}

function reportBackendPrerequisiteFailure(context: CommandContext, title: string, kind: "no-backend" | "no-python"): void {
  const message =
    kind === "no-backend"
      ? `${title} could not run because no Django project was detected.`
      : `${title} could not run because no Python interpreter was found.`;
  showActionableError(context.outputChannel, message);
}

export async function makeMigrations(context: CommandContext): Promise<void> {
  if (!(await context.workspaceTrust.ensureTrustedForExecution("Make Migrations"))) {
    return;
  }
  const plan = planMakeMigrations(context.projectState.getState().detectedProject, context.backendAdapter);
  if (plan.kind !== "ready") {
    reportBackendPrerequisiteFailure(context, "Make Migrations", plan.kind);
    return;
  }
  if (await runAndReport(context, "Make Migrations", plan.command)) {
    await vscode.commands.executeCommand(COMMAND_REFRESH);
  }
}

export async function migrate(context: CommandContext): Promise<void> {
  if (!(await context.workspaceTrust.ensureTrustedForExecution("Migrate"))) {
    return;
  }
  const plan = planMigrate(context.projectState.getState().detectedProject, context.backendAdapter);
  if (plan.kind !== "ready") {
    reportBackendPrerequisiteFailure(context, "Migrate", plan.kind);
    return;
  }
  if (await runAndReport(context, "Migrate", plan.command)) {
    await vscode.commands.executeCommand(COMMAND_REFRESH);
  }
}

export async function showMigrations(context: CommandContext): Promise<void> {
  if (!(await context.workspaceTrust.ensureTrustedForExecution("Show Migrations"))) {
    return;
  }
  const plan = planShowMigrations(context.projectState.getState().detectedProject, context.backendAdapter);
  if (plan.kind !== "ready") {
    reportBackendPrerequisiteFailure(context, "Show Migrations", plan.kind);
    return;
  }
  await runAndReport(context, "Show Migrations", plan.command);
}

export async function runDjangoTests(context: CommandContext): Promise<void> {
  if (!(await context.workspaceTrust.ensureTrustedForExecution("Run Django Tests"))) {
    return;
  }
  const plan = planDjangoTest(context.projectState.getState().detectedProject, context.backendAdapter);
  if (plan.kind !== "ready") {
    reportBackendPrerequisiteFailure(context, "Run Django Tests", plan.kind);
    return;
  }
  await runAndReport(context, "Run Django Tests", plan.command);
}

/**
 * Core install logic without a trust check, reused by both the standalone
 * command below and the Initialize Project flow (which already checked
 * trust once for the whole batch of steps it runs).
 */
export async function runInstallPythonDependencies(context: CommandContext): Promise<boolean> {
  const plan = planInstallPythonDependencies(context.projectState.getState().detectedProject);
  if (plan.kind === "no-backend" || plan.kind === "no-python") {
    reportBackendPrerequisiteFailure(context, "Install Python Dependencies", plan.kind);
    return false;
  }
  if (plan.kind === "no-requirements-file") {
    showActionableError(context.outputChannel, "No requirements.txt (or requirements/dev.txt) was found to install from.");
    return false;
  }
  if (plan.kind === "unsupported-dependency-manager") {
    showActionableError(
      context.outputChannel,
      `This project uses ${plan.detected}, which StackPilot does not install dependencies for yet. Install them using that tool directly.`
    );
    return false;
  }

  return runAndReport(context, "Install Python Dependencies", plan.command);
}

export async function installPythonDependencies(context: CommandContext): Promise<void> {
  if (!(await context.workspaceTrust.ensureTrustedForExecution("Install Python Dependencies"))) {
    return;
  }
  await runInstallPythonDependencies(context);
}

export async function createDjangoApp(context: CommandContext): Promise<void> {
  if (!(await context.workspaceTrust.ensureTrustedForExecution("Create Django App"))) {
    return;
  }

  const appName = await vscode.window.showInputBox({
    title: "Create Django App",
    prompt: "Enter the new Django app name",
    validateInput: (value) => {
      const result = context.backendAdapter.validateAppName(value);
      return result.valid ? undefined : result.reason;
    }
  });
  if (appName === undefined) {
    return;
  }

  const state = context.projectState.getState();
  const plan = planCreateApp(state.detectedProject, appName, context.backendAdapter);
  if (plan.kind === "invalid-name") {
    showActionableError(context.outputChannel, `Could not create app: ${plan.reason}`);
    return;
  }
  if (plan.kind !== "ready") {
    reportBackendPrerequisiteFailure(context, "Create Django App", plan.kind);
    return;
  }

  const succeeded = await runAndReport(context, `Create Django App: ${appName}`, plan.command);
  if (!succeeded) {
    return;
  }

  const backendRootPath = getBackendService(state.detectedProject)?.rootPath;
  if (backendRootPath !== undefined) {
    await vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(path.join(backendRootPath, appName)));
    await offerToRegisterInstalledApp(context, backendRootPath, appName);
  }
  await vscode.commands.executeCommand(COMMAND_REFRESH);
}

export async function openDjangoShell(context: CommandContext): Promise<void> {
  if (!(await context.workspaceTrust.ensureTrustedForExecution("Django Shell"))) {
    return;
  }
  const plan = planDjangoShell(context.projectState.getState().detectedProject, context.backendAdapter);
  if (plan.kind !== "ready") {
    reportBackendPrerequisiteFailure(context, "Django Shell", plan.kind);
    return;
  }
  context.interactiveTerminals.open("djangoShell", "StackPilot — Django Shell", plan.invocation);
}

export async function openDbShell(context: CommandContext): Promise<void> {
  if (!(await context.workspaceTrust.ensureTrustedForExecution("Database Shell"))) {
    return;
  }
  const plan = planDbShell(context.projectState.getState().detectedProject, context.backendAdapter);
  if (plan.kind !== "ready") {
    reportBackendPrerequisiteFailure(context, "Database Shell", plan.kind);
    return;
  }
  context.interactiveTerminals.open("dbShell", "StackPilot — Database Shell", plan.invocation);
}

export async function createSuperuser(context: CommandContext): Promise<void> {
  if (!(await context.workspaceTrust.ensureTrustedForExecution("Create Superuser"))) {
    return;
  }
  const plan = planCreateSuperuser(context.projectState.getState().detectedProject, context.backendAdapter);
  if (plan.kind !== "ready") {
    reportBackendPrerequisiteFailure(context, "Create Superuser", plan.kind);
    return;
  }
  context.interactiveTerminals.open("createSuperuser", "StackPilot — Create Superuser", plan.invocation, false);
}

export async function runManagementCommand(context: CommandContext): Promise<void> {
  if (!(await context.workspaceTrust.ensureTrustedForExecution("Run Django Management Command"))) {
    return;
  }

  const input = await vscode.window.showInputBox({
    title: "Run Django Management Command",
    prompt: "manage.py subcommand and arguments",
    placeHolder: "e.g. makemessages -l de, or dumpdata myapp.Model --indent 2",
    validateInput: (value) => (value.trim().length === 0 ? "Enter a manage.py subcommand." : undefined)
  });
  if (input === undefined) {
    return;
  }

  const args = splitCommandArguments(input);
  const plan = planManagementCommand(context.projectState.getState().detectedProject, args, context.backendAdapter);
  if (plan.kind !== "ready") {
    reportBackendPrerequisiteFailure(context, "Run Django Management Command", plan.kind);
    return;
  }

  if (await runAndReport(context, `manage.py ${args.join(" ")}`, plan.command)) {
    await vscode.commands.executeCommand(COMMAND_REFRESH);
  }
}
