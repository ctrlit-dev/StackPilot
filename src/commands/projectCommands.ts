import * as vscode from "vscode";
import {
  COMMAND_COPY_BACKEND_URL,
  COMMAND_COPY_FRONTEND_URL,
  COMMAND_OPEN_ADMIN,
  COMMAND_OPEN_APPLICATION,
  COMMAND_OPEN_LOGS,
  COMMAND_OPEN_SETTINGS,
  COMMAND_OPEN_SIMPLE_BROWSER,
  COMMAND_START_ALL,
  COMMAND_STOP_ALL
} from "../constants";
import type { ManagedProcessKind, StartProcessOptions } from "../execution/processManager";
import { showActionableError } from "../ui/notifications";
import type { CommandContext } from "./commandContext";
import { planOpenApplication, planServiceUrl } from "./openApplicationPlan";
import { offerToOpenInBrowser } from "./openInBrowserOffer";
import { planBackendStart, planFrontendStart } from "./startPlans";

export function registerProjectCommands(context: CommandContext): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(COMMAND_START_ALL, () => startAll(context)),
    vscode.commands.registerCommand(COMMAND_STOP_ALL, () => stopAll(context)),
    vscode.commands.registerCommand(COMMAND_OPEN_APPLICATION, () => openApplication(context)),
    vscode.commands.registerCommand(COMMAND_OPEN_SIMPLE_BROWSER, () => openInSimpleBrowser(context)),
    vscode.commands.registerCommand(COMMAND_COPY_BACKEND_URL, () => copyServiceUrl(context, "backend")),
    vscode.commands.registerCommand(COMMAND_COPY_FRONTEND_URL, () => copyServiceUrl(context, "frontend")),
    vscode.commands.registerCommand(COMMAND_OPEN_ADMIN, () => openAdmin(context)),
    vscode.commands.registerCommand(COMMAND_OPEN_LOGS, () => context.outputChannel.show(true)),
    vscode.commands.registerCommand(COMMAND_OPEN_SETTINGS, () =>
      vscode.commands.executeCommand("workbench.action.openSettings", "stackPilot")
    )
  ];
}

export async function startAll(context: CommandContext): Promise<void> {
  const state = context.projectState.getState();
  if (state.selection.kind !== "selected" || state.configuration === undefined) {
    void vscode.window.showWarningMessage("StackPilot: select a workspace folder before starting.");
    return;
  }
  if (!(await context.workspaceTrust.ensureTrustedForExecution("Starting managed dev servers"))) {
    return;
  }

  const backendPlan = planBackendStart(state.detectedProject, state.configuration);
  const frontendPlan = planFrontendStart(state.detectedProject, state.configuration);

  const optionsByKind: Partial<Record<ManagedProcessKind, StartProcessOptions>> = {};
  if (backendPlan.kind === "ready") {
    optionsByKind.backend = backendPlan.command;
  }
  if (frontendPlan.kind === "ready") {
    optionsByKind.frontend = frontendPlan.command;
  }

  if (optionsByKind.backend === undefined && optionsByKind.frontend === undefined) {
    showActionableError(context.outputChannel, "Start All found nothing to start: no Django backend or Vite frontend is ready.");
    return;
  }

  if (optionsByKind.backend !== undefined) {
    context.terminalManager.reveal("backend");
  }
  if (optionsByKind.frontend !== undefined) {
    context.terminalManager.reveal("frontend");
  }

  const results = await context.processManager.startAll(optionsByKind);
  const failures: string[] = [];
  if (results.backend.outcome === "spawn-failed") {
    failures.push(`Backend: ${results.backend.reason}`);
  }
  if (results.frontend.outcome === "spawn-failed") {
    failures.push(`Frontend: ${results.frontend.reason}`);
  }
  if (failures.length > 0) {
    showActionableError(context.outputChannel, `Start All: some components failed to start.\n${failures.join("\n")}`);
    return;
  }

  // A single offer, preferring the frontend, rather than one notification
  // per component that started (spec §45: avoid notification spam).
  if (results.frontend.outcome === "started") {
    await offerToOpenInBrowser(context, "frontend", results.frontend.descriptor);
  } else if (results.backend.outcome === "started") {
    await offerToOpenInBrowser(context, "backend", results.backend.descriptor);
  }
}

export async function stopAll(context: CommandContext): Promise<void> {
  await context.processManager.stopAll();
}

/**
 * spec §62: "Never open arbitrary workspace-controlled URLs automatically
 * without user action" - this only ever runs on an explicit command
 * invocation, and only opens a URL this extension itself constructed from
 * the process it is managing (host/port), never a workspace-supplied value.
 */
export async function openApplication(context: CommandContext): Promise<void> {
  const state = context.projectState.getState();
  const backendHost = state.configuration?.backendHost ?? "127.0.0.1";
  const plan = planOpenApplication(
    context.processManager.getState("backend"),
    context.processManager.getState("frontend"),
    context.frontendUrlTracker.getUrl(),
    backendHost
  );

  if (plan.kind === "nothing-running") {
    showActionableError(context.outputChannel, "Open Application could not run because nothing is currently running. Start the backend or frontend first.");
    return;
  }

  await vscode.env.openExternal(vscode.Uri.parse(plan.url));
}

/** VS Code's built-in "Simple Browser" tab, so the running app can be previewed without leaving the editor. */
export async function openInSimpleBrowser(context: CommandContext): Promise<void> {
  const state = context.projectState.getState();
  const backendHost = state.configuration?.backendHost ?? "127.0.0.1";
  const plan = planOpenApplication(
    context.processManager.getState("backend"),
    context.processManager.getState("frontend"),
    context.frontendUrlTracker.getUrl(),
    backendHost
  );

  if (plan.kind === "nothing-running") {
    showActionableError(
      context.outputChannel,
      "Open in Simple Browser could not run because nothing is currently running. Start the backend or frontend first."
    );
    return;
  }

  await vscode.commands.executeCommand("simpleBrowser.show", plan.url);
}

async function copyServiceUrl(context: CommandContext, kind: ManagedProcessKind): Promise<void> {
  const state = context.projectState.getState();
  const backendHost = state.configuration?.backendHost ?? "127.0.0.1";
  const url = planServiceUrl(kind, context.processManager.getState(kind), context.frontendUrlTracker.getUrl(), backendHost);

  if (url === undefined) {
    showActionableError(context.outputChannel, `Could not copy the ${kind} URL because it is not currently running.`);
    return;
  }

  await vscode.env.clipboard.writeText(url);
  void vscode.window.showInformationMessage(`StackPilot: copied ${url}`);
}

/** Django-specific: every Django project ships /admin/, so this skips having to type the URL by hand. */
export async function openAdmin(context: CommandContext): Promise<void> {
  const state = context.projectState.getState();
  const backendHost = state.configuration?.backendHost ?? "127.0.0.1";
  const url = planServiceUrl("backend", context.processManager.getState("backend"), context.frontendUrlTracker.getUrl(), backendHost);

  if (url === undefined) {
    showActionableError(context.outputChannel, "Open Admin could not run because the backend is not currently running.");
    return;
  }

  await vscode.env.openExternal(vscode.Uri.parse(`${url.replace(/\/$/, "")}/admin/`));
}
