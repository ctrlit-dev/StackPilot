import * as vscode from "vscode";
import { COMMAND_CREATE_VIRTUAL_ENVIRONMENT, COMMAND_REFRESH } from "../constants";
import { getBackendService } from "../detection/detectedProject";
import { checkVenvHealth } from "../detection/venvHealthCheck";
import { buildCreateVenvCommand, findBasePython } from "../execution/venvCommand";
import { resolveWorkspacePath } from "../utils/paths";
import { showActionableError } from "../ui/notifications";
import type { CommandContext } from "./commandContext";
import { runAndReport } from "./operationRunner";

export function registerVenvCommands(context: CommandContext): vscode.Disposable[] {
  return [vscode.commands.registerCommand(COMMAND_CREATE_VIRTUAL_ENVIRONMENT, () => createVirtualEnvironment(context))];
}

/**
 * Core venv-creation logic without a trust check, reused by both the
 * standalone command below and the Initialize Project flow (spec §10).
 */
export async function runCreateVirtualEnvironment(context: CommandContext): Promise<boolean> {
  const state = context.projectState.getState();
  if (state.selection.kind !== "selected" || state.configuration === undefined) {
    return false;
  }

  const backend = getBackendService(state.detectedProject);
  if (backend === undefined || state.detectedProject === undefined) {
    showActionableError(context.outputChannel, "Create Virtual Environment could not run because no Django project was detected.");
    return false;
  }

  const targetVenvPath = resolveWorkspacePath(state.detectedProject.workspaceRootPath, state.configuration.pythonVenvDirectory);

  const health = await checkVenvHealth(context.fileSystem, targetVenvPath);
  if (health.kind === "healthy") {
    void vscode.window.showInformationMessage("StackPilot: a virtual environment already exists.");
    return false;
  }
  if (health.kind === "broken") {
    const recreate = "Recreate";
    const choice = await vscode.window.showWarningMessage(
      `The virtual environment at ${targetVenvPath} looks broken (its Python executable is missing). Recreate it?`,
      { modal: true },
      recreate
    );
    if (choice !== recreate) {
      return false;
    }
  }

  const basePython = findBasePython(state.detectedProject, targetVenvPath);
  if (basePython === undefined) {
    showActionableError(
      context.outputChannel,
      "Create Virtual Environment could not run because no Python interpreter was found on PATH or in settings."
    );
    return false;
  }

  const command = buildCreateVenvCommand(basePython, targetVenvPath, backend.rootPath);
  const succeeded = await runAndReport(context, "Create Virtual Environment", command);
  if (!succeeded) {
    return false;
  }

  const finalHealth = await checkVenvHealth(context.fileSystem, targetVenvPath);
  if (finalHealth.kind !== "healthy") {
    showActionableError(context.outputChannel, "Create Virtual Environment finished, but the resulting interpreter could not be validated.");
    return false;
  }

  return true;
}

export async function createVirtualEnvironment(context: CommandContext): Promise<void> {
  if (!(await context.workspaceTrust.ensureTrustedForExecution("Create Virtual Environment"))) {
    return;
  }
  if (await runCreateVirtualEnvironment(context)) {
    await vscode.commands.executeCommand(COMMAND_REFRESH);
  }
}
