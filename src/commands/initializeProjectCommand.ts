import * as vscode from "vscode";
import { COMMAND_INITIALIZE_PROJECT, COMMAND_REFRESH } from "../constants";
import { runInstallPythonDependencies } from "./backendOperationCommands";
import type { CommandContext } from "./commandContext";
import { runInstallFrontendDependencies } from "./frontendOperationCommands";
import { analyzeInitialization, gatherInitializationFacts } from "./initializationAnalysis";
import { showActionableError } from "../ui/notifications";
import { runCreateVirtualEnvironment } from "./venvCommands";

type StepId = "createVenv" | "installPythonDependencies" | "installFrontendDependencies";

const STEP_LABELS: Record<StepId, string> = {
  createVenv: "Create Virtual Environment",
  installPythonDependencies: "Install Python Dependencies",
  installFrontendDependencies: "Install Frontend Dependencies"
};

// Dependency installs need a working venv first.
const STEP_ORDER: readonly StepId[] = ["createVenv", "installPythonDependencies", "installFrontendDependencies"];

export function registerInitializeProjectCommand(context: CommandContext): vscode.Disposable[] {
  return [vscode.commands.registerCommand(COMMAND_INITIALIZE_PROJECT, () => initializeProject(context))];
}

function formatChecklistLine(label: string, done: boolean | undefined): string {
  const mark = done === undefined ? "?" : done ? "✓" : "✗";
  return `${mark} ${label}`;
}

export async function initializeProject(context: CommandContext): Promise<void> {
  const state = context.projectState.getState();
  if (state.selection.kind !== "selected" || state.detectedProject === undefined || state.configuration === undefined) {
    void vscode.window.showWarningMessage("StackPilot: select a workspace folder before initializing.");
    return;
  }

  if (!(await context.workspaceTrust.ensureTrustedForExecution("Initialize Project"))) {
    return;
  }

  const facts = await gatherInitializationFacts(
    context.fileSystem,
    state.detectedProject.workspaceRootPath,
    state.detectedProject,
    state.configuration
  );
  const plan = analyzeInitialization(facts);

  context.outputChannel.appendLine("Project setup");
  for (const item of plan.checklist) {
    context.outputChannel.appendLine(formatChecklistLine(item.label, item.done));
  }

  const availableSteps: StepId[] = [];
  if (plan.canCreateVenv) {
    availableSteps.push("createVenv");
  }
  if (plan.canInstallPythonDependencies) {
    availableSteps.push("installPythonDependencies");
  }
  if (plan.canInstallFrontendDependencies) {
    availableSteps.push("installFrontendDependencies");
  }

  if (availableSteps.length === 0) {
    context.outputChannel.show(true);
    void vscode.window.showInformationMessage("StackPilot: this project already looks fully set up.");
    return;
  }

  // A review step before any change is made (spec §25: "Prefer a review step
  // before making changes") - nothing is pre-selected, so the user must
  // actively choose what to run rather than everything running by default.
  const picked = await vscode.window.showQuickPick(
    availableSteps.map((id) => ({ label: STEP_LABELS[id], id })),
    {
      title: "Project setup",
      placeHolder: plan.checklist.map((item) => formatChecklistLine(item.label, item.done)).join("   "),
      canPickMany: true
    }
  );
  if (picked === undefined || picked.length === 0) {
    return;
  }

  const selected = new Set(picked.map((item) => item.id));
  for (const id of STEP_ORDER) {
    if (!selected.has(id)) {
      continue;
    }

    const succeeded = await runStep(context, id);
    if (!succeeded) {
      showActionableError(
        context.outputChannel,
        `Project setup stopped after "${STEP_LABELS[id]}" failed. Steps completed before this one were kept.`
      );
      return;
    }

    // A later step (e.g. installing Python dependencies) needs to see the
    // venv createVenv just created, not the stale pre-step detection result.
    await vscode.commands.executeCommand(COMMAND_REFRESH);
  }

  void vscode.window.showInformationMessage("StackPilot: project setup completed.");
}

async function runStep(context: CommandContext, id: StepId): Promise<boolean> {
  switch (id) {
    case "createVenv":
      return runCreateVirtualEnvironment(context);
    case "installPythonDependencies":
      return runInstallPythonDependencies(context);
    case "installFrontendDependencies":
      return runInstallFrontendDependencies(context);
  }
}
