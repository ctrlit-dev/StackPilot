import * as vscode from "vscode";
import {
  COMMAND_BUILD_FRONTEND,
  COMMAND_INSTALL_FRONTEND_DEPENDENCIES,
  COMMAND_REFRESH,
  COMMAND_RUN_FRONTEND_SCRIPT,
  COMMAND_RUN_FRONTEND_TESTS
} from "../constants";
import { getFrontendService, getNodeRuntime } from "../detection/detectedProject";
import { showActionableError } from "../ui/notifications";
import type { CommandContext } from "./commandContext";
import {
  planBuildFrontend,
  planInstallFrontendDependencies,
  planRunFrontendScript,
  planTestFrontend,
  type FrontendOperationPlan
} from "./frontendOperationPlans";
import { runAndReport } from "./operationRunner";

export function registerFrontendOperationCommands(context: CommandContext): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(COMMAND_INSTALL_FRONTEND_DEPENDENCIES, () => installFrontendDependencies(context)),
    vscode.commands.registerCommand(COMMAND_BUILD_FRONTEND, () => buildFrontend(context)),
    vscode.commands.registerCommand(COMMAND_RUN_FRONTEND_TESTS, () => runFrontendTests(context)),
    vscode.commands.registerCommand(COMMAND_RUN_FRONTEND_SCRIPT, () => runFrontendScript(context))
  ];
}

function reportFrontendPlanFailure(
  context: CommandContext,
  title: string,
  plan: Exclude<FrontendOperationPlan, { readonly kind: "ready" }>
): void {
  if (plan.kind === "no-frontend") {
    showActionableError(context.outputChannel, `${title} could not run because no frontend was detected.`);
  } else if (plan.kind === "package-manager-missing") {
    showActionableError(context.outputChannel, `${title} could not run: ${plan.reason}`);
  } else if (plan.kind === "package-manager-ambiguous") {
    showActionableError(
      context.outputChannel,
      `${title} could not run: multiple package managers were detected (${plan.candidates.join(", ")}). Set stackPilot.frontend.packageManager to choose one.`
    );
  } else {
    showActionableError(context.outputChannel, `${title} could not run because no matching package.json script was found.`);
  }
}

/**
 * Core install logic without a trust check, reused by both the standalone
 * command below and the Initialize Project flow.
 */
export async function runInstallFrontendDependencies(context: CommandContext): Promise<boolean> {
  const plan = planInstallFrontendDependencies(context.projectState.getState().detectedProject);
  if (plan.kind !== "ready") {
    reportFrontendPlanFailure(context, "Install Frontend Dependencies", plan);
    return false;
  }
  return runAndReport(context, "Install Frontend Dependencies", plan.command);
}

export async function installFrontendDependencies(context: CommandContext): Promise<void> {
  if (!(await context.workspaceTrust.ensureTrustedForExecution("Install Frontend Dependencies"))) {
    return;
  }
  // Only on success (DIAGNOSTICS-1B gap): re-detects the project so
  // node.dependencies.missing does not stay stale after an install this
  // command just performed. Not added inside runInstallFrontendDependencies()
  // itself - the Initialize Project flow calls that shared function directly
  // and already calls COMMAND_REFRESH once per completed step, so doing it
  // there too would refresh twice for the same success.
  if (await runInstallFrontendDependencies(context)) {
    await vscode.commands.executeCommand(COMMAND_REFRESH);
  }
}

export async function buildFrontend(context: CommandContext): Promise<void> {
  const state = context.projectState.getState();
  if (state.configuration === undefined) {
    return;
  }
  if (!(await context.workspaceTrust.ensureTrustedForExecution("Build Frontend"))) {
    return;
  }
  const plan = planBuildFrontend(state.detectedProject, state.configuration.frontendBuildScript);
  if (plan.kind !== "ready") {
    reportFrontendPlanFailure(context, "Build Frontend", plan);
    return;
  }
  await runAndReport(context, "Build Frontend", plan.command);
}

export async function runFrontendTests(context: CommandContext): Promise<void> {
  const state = context.projectState.getState();
  if (state.configuration === undefined) {
    return;
  }
  if (!(await context.workspaceTrust.ensureTrustedForExecution("Run Frontend Tests"))) {
    return;
  }
  const plan = planTestFrontend(state.detectedProject, state.configuration.frontendTestScript);
  if (plan.kind !== "ready") {
    reportFrontendPlanFailure(context, "Run Frontend Tests", plan);
    return;
  }
  await runAndReport(context, "Run Frontend Tests", plan.command);
}

export async function runFrontendScript(context: CommandContext): Promise<void> {
  const scripts = getNodeRuntime(getFrontendService(context.projectState.getState().detectedProject))?.scripts;
  if (scripts === undefined) {
    showActionableError(context.outputChannel, "Run Script could not run because no frontend was detected.");
    return;
  }
  const scriptNames = Object.keys(scripts);
  if (scriptNames.length === 0) {
    showActionableError(context.outputChannel, "Run Script could not run because package.json has no scripts.");
    return;
  }

  const picked = await vscode.window.showQuickPick(
    scriptNames.map((name) => ({ label: name, description: scripts[name] })),
    { title: "Run package.json Script" }
  );
  if (picked === undefined) {
    return;
  }

  if (!(await context.workspaceTrust.ensureTrustedForExecution(`Run Script: ${picked.label}`))) {
    return;
  }

  const plan = planRunFrontendScript(context.projectState.getState().detectedProject, picked.label);
  if (plan.kind !== "ready") {
    reportFrontendPlanFailure(context, `Run Script: ${picked.label}`, plan);
    return;
  }
  await runAndReport(context, `Run Script: ${picked.label}`, plan.command);
}
