import * as vscode from "vscode";
import { COMMAND_START_FRONTEND, COMMAND_STOP_FRONTEND } from "../constants";
import { showActionableError } from "../ui/notifications";
import type { CommandContext } from "./commandContext";
import { offerToOpenInBrowser } from "./openInBrowserOffer";
import { planFrontendStart } from "./startPlans";

export function registerFrontendCommands(context: CommandContext): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(COMMAND_START_FRONTEND, () => startFrontend(context)),
    vscode.commands.registerCommand(COMMAND_STOP_FRONTEND, () => stopFrontend(context))
  ];
}

export async function startFrontend(context: CommandContext): Promise<void> {
  const state = context.projectState.getState();
  if (state.selection.kind !== "selected" || state.configuration === undefined) {
    void vscode.window.showWarningMessage("StackPilot: select a workspace folder before starting the frontend server.");
    return;
  }
  if (!(await context.workspaceTrust.ensureTrustedForExecution("Starting the frontend dev server"))) {
    return;
  }

  const plan = planFrontendStart(state.detectedProject, state.configuration);
  if (plan.kind === "no-frontend") {
    showActionableError(context.outputChannel, "The frontend dev server could not be started because no frontend was detected.");
    return;
  }
  if (plan.kind === "package-manager-missing") {
    showActionableError(context.outputChannel, `The frontend dev server could not be started: ${plan.reason}`);
    return;
  }
  if (plan.kind === "package-manager-ambiguous") {
    showActionableError(
      context.outputChannel,
      `Multiple package managers were detected (${plan.candidates.join(", ")}). Set stackPilot.frontend.packageManager to choose one.`
    );
    return;
  }

  // Unlike Django, Vite already falls back to another port gracefully and
  // reports the real one in its own output (spec §15), so there is no
  // separate pre-flight port-conflict dialog here (see backendCommands.ts).
  context.terminalManager.reveal("frontend");
  const result = await context.processManager.start("frontend", plan.command);
  if (result.outcome === "spawn-failed") {
    showActionableError(context.outputChannel, `Frontend dev server failed to start: ${result.reason}`);
    return;
  }
  if (result.outcome === "started") {
    await offerToOpenInBrowser(context, "frontend", result.descriptor);
  }
}

export async function stopFrontend(context: CommandContext): Promise<void> {
  await context.processManager.stop("frontend");
}
