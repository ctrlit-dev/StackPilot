import * as vscode from "vscode";
import { COMMAND_OPEN_SETTINGS, COMMAND_START_BACKEND, COMMAND_STOP_BACKEND } from "../constants";
import { showActionableError } from "../ui/notifications";
import type { CommandContext } from "./commandContext";
import { offerToOpenInBrowser } from "./openInBrowserOffer";
import { nextPortSuggestion } from "./portConflict";
import { planBackendStart } from "./startPlans";

export function registerBackendCommands(context: CommandContext): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(COMMAND_START_BACKEND, () => startBackend(context)),
    vscode.commands.registerCommand(COMMAND_STOP_BACKEND, () => stopBackend(context))
  ];
}

export async function startBackend(context: CommandContext): Promise<void> {
  const state = context.projectState.getState();
  if (state.selection.kind !== "selected" || state.configuration === undefined) {
    void vscode.window.showWarningMessage("StackPilot: select a workspace folder before starting the Django server.");
    return;
  }
  if (!(await context.workspaceTrust.ensureTrustedForExecution("Starting the Django server"))) {
    return;
  }

  const plan = planBackendStart(state.detectedProject, state.configuration, context.backendAdapter);
  if (plan.kind === "no-backend") {
    showActionableError(context.outputChannel, "Django could not be started because no Django project was detected.");
    return;
  }
  if (plan.kind === "no-python") {
    showActionableError(context.outputChannel, "Django could not be started because no Python interpreter was found.");
    return;
  }

  let command = plan.command;
  const requestedPort = command.expectedPort;
  if (requestedPort !== undefined && !(await context.portChecker.isPortAvailable(state.configuration.backendHost, requestedPort))) {
    const suggestedPort = nextPortSuggestion(requestedPort);
    const useSuggested = `Use ${suggestedPort}`;
    const choice = await vscode.window.showWarningMessage(`Port ${requestedPort} is already in use.`, useSuggested, "Open Settings", "Cancel");
    if (choice === "Open Settings") {
      await vscode.commands.executeCommand(COMMAND_OPEN_SETTINGS);
      return;
    }
    if (choice !== useSuggested) {
      return;
    }

    const backend = state.detectedProject?.backend.selected;
    const python = state.detectedProject?.python.selected;
    if (backend === undefined || python === undefined) {
      return;
    }
    command = context.backendAdapter.buildStartCommand(python, backend, state.configuration.backendHost, suggestedPort);
  }

  context.terminalManager.reveal("backend");
  const result = await context.processManager.start("backend", command);
  if (result.outcome === "spawn-failed") {
    showActionableError(context.outputChannel, `Django server failed to start: ${result.reason}`);
    return;
  }
  if (result.outcome === "started") {
    await offerToOpenInBrowser(context, "backend", result.descriptor);
  }
}

export async function stopBackend(context: CommandContext): Promise<void> {
  await context.processManager.stop("backend");
}
