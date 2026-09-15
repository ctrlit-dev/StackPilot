import * as path from "node:path";
import * as vscode from "vscode";
import { DEFAULT_CONFIGURATION } from "../config/configurationModel";
import { COMMAND_CREATE_PROJECT } from "../constants";
import type { ProjectCreateModule, ProjectCreatePlan } from "../project/create/projectCreateModule";
import { PROJECT_CREATE_MODULES } from "../project/create/projectCreateModules";
import { composeProjectSteps } from "../project/create/projectStepsComposition";
import { composeConfirmationSummaryLines } from "../project/generatedFiles";
import { checkDestination, cleanupCreatedPaths } from "../project/projectCollision";
import { validateFolderName } from "../project/projectNameValidation";
import { executeScaffoldSteps } from "../project/scaffoldStep";
import type { CommandContext } from "./commandContext";

export function registerNewProjectCommand(context: CommandContext): vscode.Disposable[] {
  return [vscode.commands.registerCommand(COMMAND_CREATE_PROJECT, () => runNewProjectWizard(context))];
}

/**
 * Thin, generic VS Code UI orchestration. Knows the ProjectCreateModule
 * contract and the PROJECT_CREATE_MODULES registry, and nothing else about
 * any concrete framework - no framework id, no per-framework branch, no
 * import of a concrete project module (see
 * docs/CREATE_ARCH_MODULAR_PROJECT_CREATION_PLAN.md §13.4/§27). Every prompt
 * can be cancelled with ESC, which exits the wizard immediately without any
 * side effect - nothing is created until the generic final confirmation
 * (below) approves.
 */
export async function runNewProjectWizard(context: CommandContext): Promise<void> {
  const parentDirectory = await pickParentDirectory();
  if (parentDirectory === undefined) {
    return;
  }

  const projectName = await pickProjectName(context, parentDirectory);
  if (projectName === undefined) {
    return;
  }

  const projectModule = await pickProjectCreateModule(PROJECT_CREATE_MODULES);
  if (projectModule === undefined) {
    return;
  }

  const outputSink: { current?: { write(chunk: string): void } } = {};
  const onOutput = (chunk: string): void => outputSink.current?.write(chunk);

  const projectPlan = await projectModule.prepare({
    parentDirectory,
    projectName,
    fileSystem: context.fileSystem,
    projectFileWriter: context.projectFileWriter,
    spawner: context.spawner,
    outputChannel: context.outputChannel,
    onOutput,
    configuration: DEFAULT_CONFIGURATION
  });
  if (projectPlan === undefined) {
    return;
  }

  const initializeGit = await pickGitChoice();
  if (initializeGit === undefined) {
    return;
  }

  const confirmed = await confirmProjectSummary(projectPlan.projectRoot, projectName, projectPlan, initializeGit);
  if (!confirmed) {
    return;
  }

  await createProject(context, projectPlan, projectName, initializeGit, outputSink, onOutput);
}

/** Generic - "should Git be initialized" has no backend-specific meaning (plan §32.1/§18). Wording/choices unchanged from the pre-CREATE-ARCH-1B.1 Django-owned prompt. */
async function pickGitChoice(): Promise<boolean | undefined> {
  const gitChoice = await vscode.window.showQuickPick(["Yes", "No"], {
    title: "New Django + Vite Project: Initialize a Git repository?"
  });
  if (gitChoice === undefined) {
    return undefined;
  }
  return gitChoice === "Yes";
}

/** Generic composition of the one final confirmation dialog - the wizard never reads into projectPlan.confirmationSummary's individual lines, only renders them verbatim. */
async function confirmProjectSummary(projectRoot: string, projectName: string, projectPlan: ProjectCreatePlan, initializeGit: boolean): Promise<boolean> {
  const summaryLines = composeConfirmationSummaryLines({ projectRoot, backendSummary: projectPlan.confirmationSummary, initializeGit });
  const choice = await vscode.window.showWarningMessage(
    `Create project "${projectName}"?`,
    { modal: true, detail: summaryLines.join("\n") },
    "Create Project"
  );
  return choice === "Create Project";
}

async function pickParentDirectory(): Promise<string | undefined> {
  const selection = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    title: "New Django + Vite Project: Choose Parent Directory",
    openLabel: "Choose Parent Directory"
  });
  return selection?.[0]?.fsPath;
}

async function pickProjectName(context: CommandContext, parentDirectory: string): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title: "New Django + Vite Project: Project Folder Name",
    prompt: `The project will be created inside: ${parentDirectory}`,
    validateInput: async (value) => {
      const nameValidation = validateFolderName(value);
      if (!nameValidation.valid) {
        return nameValidation.reason;
      }
      const destinationCheck = await checkDestination(context.projectFileWriter, path.join(parentDirectory, value));
      return destinationCheck.ok ? undefined : destinationCheck.reason;
    }
  });
}

/** Auto-selects while exactly one module is registered - mirrors the pre-existing pickBasePython pattern, keeping today's Django-only UX unchanged. */
async function pickProjectCreateModule(modules: readonly ProjectCreateModule[]): Promise<ProjectCreateModule | undefined> {
  if (modules.length === 1) {
    return modules[0];
  }

  const pick = await vscode.window.showQuickPick(
    modules.map((module) => ({ label: module.label, description: module.description, module })),
    { title: "New Project: Choose a Project Type" }
  );
  return pick?.module;
}

async function createProject(
  context: CommandContext,
  projectPlan: ProjectCreatePlan,
  projectName: string,
  initializeGit: boolean,
  outputSink: { current?: { write(chunk: string): void } },
  onOutput: (chunk: string, stream: "stdout" | "stderr") => void
): Promise<void> {
  outputSink.current = context.operationTerminal.begin(`New Project: ${projectName}`);
  let gitStatus: { status: "initialized" | "unavailable" | "failed"; detail?: string } | undefined;

  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Creating "${projectName}"…`, cancellable: true },
    async (progress, token) => {
      const steps = composeProjectSteps(context.spawner, context.projectFileWriter, projectPlan, {
        initializeGit,
        onOutput,
        onGitStatus: (status, detail) => {
          gitStatus = { status, detail };
        }
      });
      return executeScaffoldSteps(steps, (step) => progress.report({ message: step.label }), token);
    }
  );

  if (result.cancelled) {
    await handleScaffoldStoppedEarly(
      context,
      "Project setup was cancelled.",
      "Steps completed before cancelling were kept.",
      result.createdPaths
    );
    return;
  }

  if (result.failedStep !== undefined) {
    await handleScaffoldStoppedEarly(
      context,
      `Project setup stopped at "${result.failedStep.label}".`,
      result.failedStep.errorMessage,
      result.createdPaths
    );
    return;
  }

  if (gitStatus?.status === "unavailable") {
    context.outputChannel.appendLine("Git was not found; repository initialization was skipped.");
  } else if (gitStatus?.status === "failed") {
    context.outputChannel.appendLine(`Git repository initialization failed: ${gitStatus.detail ?? "unknown error"}`);
  }

  await offerToOpenProject(projectPlan.projectRoot, projectName);
}

async function handleScaffoldStoppedEarly(
  context: CommandContext,
  message: string,
  detail: string,
  createdPaths: readonly string[]
): Promise<void> {
  const choice = await vscode.window.showErrorMessage(message, { modal: true, detail }, "Clean Up Created Files", "Keep Partial Project");

  if (choice !== "Clean Up Created Files") {
    return;
  }
  if (createdPaths.length === 0) {
    return;
  }

  const confirmed = await vscode.window.showWarningMessage(
    `Delete ${createdPaths.length} item(s) this operation created?`,
    { modal: true, detail: createdPaths.join("\n") },
    "Delete"
  );
  if (confirmed !== "Delete") {
    return;
  }

  await cleanupCreatedPaths(context.projectFileWriter, createdPaths);
  void vscode.window.showInformationMessage("StackPilot: cleanup completed. Pre-existing files were never touched.");
}

async function offerToOpenProject(projectRoot: string, projectName: string): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    `Project "${projectName}" was created successfully.`,
    "Open Project",
    "Open in New Window"
  );

  if (choice === "Open Project") {
    await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(projectRoot), { forceReuseWindow: true });
  } else if (choice === "Open in New Window") {
    await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(projectRoot), { forceNewWindow: true });
  }
}
