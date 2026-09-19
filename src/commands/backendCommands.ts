import * as vscode from "vscode";
import { COMMAND_OPEN_SETTINGS, COMMAND_START_BACKEND, COMMAND_STOP_BACKEND } from "../constants";
import { getBackendService } from "../detection/detectedProject";
import { showActionableError } from "../ui/notifications";
import type { CommandContext } from "./commandContext";
import { offerToOpenInBrowser } from "./openInBrowserOffer";
import { nextPortSuggestion } from "./portConflict";
import { planBackendStart, resolveBackendStartAdapter } from "./startPlans";

export function registerBackendCommands(context: CommandContext): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(COMMAND_START_BACKEND, () => startBackend(context)),
    vscode.commands.registerCommand(COMMAND_STOP_BACKEND, () => stopBackend(context))
  ];
}

export async function startBackend(context: CommandContext): Promise<void> {
  const state = context.projectState.getState();
  if (state.selection.kind !== "selected" || state.configuration === undefined) {
    void vscode.window.showWarningMessage("StackPilot: select a workspace folder before starting the backend server.");
    return;
  }
  if (!(await context.workspaceTrust.ensureTrustedForExecution("Starting the backend server"))) {
    return;
  }

  const plan = planBackendStart(state.detectedProject, state.configuration, context.backendStartAdapters);
  if (plan.kind === "no-backend") {
    showActionableError(context.outputChannel, "The backend could not be started because no backend project was detected.");
    return;
  }
  if (plan.kind === "unsupported-framework") {
    showActionableError(context.outputChannel, "The backend could not be started because its framework is not supported yet.");
    return;
  }
  if (plan.kind === "no-python") {
    showActionableError(context.outputChannel, "The backend could not be started because no Python interpreter was found.");
    return;
  }
  if (plan.kind === "package-manager-missing") {
    showActionableError(context.outputChannel, `The backend could not be started: ${plan.reason}`);
    return;
  }
  if (plan.kind === "package-manager-ambiguous") {
    showActionableError(
      context.outputChannel,
      `The backend could not be started: multiple package managers were detected (${plan.candidates.join(", ")}). Remove all but one lockfile to disambiguate.`
    );
    return;
  }
  if (plan.kind === "no-script") {
    showActionableError(
      context.outputChannel,
      "The backend could not be started because its package.json has no 'dev' or 'start' script."
    );
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

    const backendService = getBackendService(state.detectedProject);
    const adapter = resolveBackendStartAdapter(state.detectedProject, context.backendStartAdapters);
    if (backendService === undefined || adapter === undefined) {
      return;
    }
    // The runtime prerequisite (Python interpreter, or a resolved Node
    // package manager + dev/start script) was already confirmed by the
    // "ready" plan that got us here in the first place - buildStartCommand
    // just needs the new port, same as before EXPRESS-1B.
    command = adapter.buildStartCommand(backendService, state.configuration.backendHost, suggestedPort);
  }

  context.terminalManager.reveal("backend");
  const result = await context.processManager.start("backend", command);
  if (result.outcome === "spawn-failed") {
    showActionableError(context.outputChannel, `Backend server failed to start: ${result.reason}`);
    return;
  }
  if (result.outcome === "started") {
    await offerToOpenInBrowser(context, "backend", result.descriptor);
  }
}

export async function stopBackend(context: CommandContext): Promise<void> {
  await context.processManager.stop("backend");
}
