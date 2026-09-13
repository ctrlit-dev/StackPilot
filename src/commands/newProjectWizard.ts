import * as path from "node:path";
import * as vscode from "vscode";
import { DEFAULT_CONFIGURATION } from "../config/configurationModel";
import { detectPythonEnvironment } from "../detection/pythonDetector";
import { COMMAND_CREATE_PROJECT } from "../constants";
import type { PackageManager } from "../detection/packageManagerDetector";
import type { PythonEnvironment } from "../detection/pythonDetector";
import { buildNewProjectSteps, type NewProjectAnswers } from "../project/newProjectScaffoldPlan";
import { DEFAULT_PRESET_ID, NEW_PROJECT_PRESETS, type NewProjectPreset } from "../project/newProjectPresets";
import { checkDestination, cleanupCreatedPaths } from "../project/projectCollision";
import { validateFolderName } from "../project/projectNameValidation";
import { executeScaffoldSteps } from "../project/scaffoldStep";
import { showActionableError } from "../ui/notifications";
import type { CommandContext } from "./commandContext";
import { validateDjangoAppName } from "./djangoIdentifierValidation";

const PACKAGE_MANAGER_CHOICES: readonly PackageManager[] = ["npm", "pnpm", "yarn", "bun"];

export function registerNewProjectCommand(context: CommandContext): vscode.Disposable[] {
  return [vscode.commands.registerCommand(COMMAND_CREATE_PROJECT, () => runNewProjectWizard(context))];
}

/**
 * Thin VS Code UI orchestration (spec §26) over the already-tested pure
 * logic in src/project/*. Every prompt can be cancelled with ESC, which
 * exits the wizard immediately without any side effect - nothing is created
 * until the final confirmation.
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

  const preset = await pickPreset();
  if (preset === undefined) {
    return;
  }

  const basePython = await pickBasePython(context);
  if (basePython === undefined) {
    return;
  }

  const venvDirectoryName = await vscode.window.showInputBox({
    title: "New Django + Vite Project: Virtual Environment Folder",
    prompt: "Folder name for the virtual environment, created inside backend/",
    value: ".venv",
    validateInput: (value) => validationMessage(validateFolderName(value))
  });
  if (venvDirectoryName === undefined) {
    return;
  }

  const djangoPackageName = await vscode.window.showInputBox({
    title: "New Django + Vite Project: Django Project Package Name",
    prompt: "Python package name for the Django project (does not need to match the folder name)",
    value: "config",
    validateInput: (value) => validationMessage(validateDjangoAppName(value))
  });
  if (djangoPackageName === undefined) {
    return;
  }

  const starterAppNameInput = await vscode.window.showInputBox({
    title: "New Django + Vite Project: Starter App (Optional)",
    prompt: "Optional: name of an initial Django app to create now. Leave empty to skip.",
    validateInput: (value) => (value.length === 0 ? undefined : validationMessage(validateDjangoAppName(value)))
  });
  if (starterAppNameInput === undefined) {
    return;
  }
  const starterAppName = starterAppNameInput.length === 0 ? undefined : starterAppNameInput;

  let packageManager: PackageManager | undefined;
  if (preset.includesFrontend) {
    const pick = await vscode.window.showQuickPick(
      PACKAGE_MANAGER_CHOICES.map((manager) => ({ label: manager, manager })),
      { title: "New Django + Vite Project: Choose a Package Manager" }
    );
    if (pick === undefined) {
      return;
    }
    packageManager = pick.manager;
  }

  const gitChoice = await vscode.window.showQuickPick(["Yes", "No"], {
    title: "New Django + Vite Project: Initialize a Git repository?"
  });
  if (gitChoice === undefined) {
    return;
  }
  const initializeGit = gitChoice === "Yes";

  const answers: NewProjectAnswers = {
    parentDirectory,
    projectName,
    preset,
    basePython,
    venvDirectoryName,
    djangoPackageName,
    starterAppName,
    packageManager,
    backendHost: DEFAULT_CONFIGURATION.backendHost,
    backendPort: DEFAULT_CONFIGURATION.backendPort,
    frontendPort: DEFAULT_CONFIGURATION.frontendPort
  };

  const confirmed = await confirmSummary(answers, initializeGit);
  if (!confirmed) {
    return;
  }

  await createProject(context, answers, initializeGit);
}

function validationMessage(result: { readonly valid: boolean; readonly reason?: string }): string | undefined {
  return result.valid ? undefined : result.reason;
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T | "timeout"> {
  return Promise.race([
    promise,
    new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), milliseconds);
    })
  ]);
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

async function pickPreset(): Promise<NewProjectPreset | undefined> {
  const items = NEW_PROJECT_PRESETS.map((preset) => ({
    label: preset.id === DEFAULT_PRESET_ID ? `${preset.label} (Recommended)` : preset.label,
    description: preset.description,
    preset
  }));
  const pick = await vscode.window.showQuickPick(items, { title: "New Django + Vite Project: Choose a Preset" });
  return pick?.preset;
}

async function pickBasePython(context: CommandContext): Promise<PythonEnvironment | undefined> {
  // No project exists yet, so this only ever finds PATH-based interpreters
  // (there is no backend/.venv to detect and no configured interpreter for
  // a project that does not exist).
  const detection = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "New Django + Vite Project: Looking for a Python interpreter…" },
    () => withTimeout(detectPythonEnvironment(context.fileSystem, process.cwd(), undefined, DEFAULT_CONFIGURATION), 10_000)
  );
  if (detection === "timeout") {
    showActionableError(
      context.outputChannel,
      "New Project could not proceed because Python interpreter detection timed out. This can happen when PATH contains an unreachable network folder. Set the 'StackPilot: Python Interpreter' setting to skip detection."
    );
    return undefined;
  }
  if (detection.candidates.length === 0) {
    showActionableError(context.outputChannel, "New Project could not proceed because no Python interpreter was found on PATH.");
    return undefined;
  }
  if (detection.candidates.length === 1) {
    return detection.candidates[0];
  }

  const pick = await vscode.window.showQuickPick(
    detection.candidates.map((candidate) => ({ label: candidate.executablePath, candidate })),
    { title: "New Django + Vite Project: Choose a Python Interpreter" }
  );
  return pick?.candidate;
}

async function confirmSummary(answers: NewProjectAnswers, initializeGit: boolean): Promise<boolean> {
  const summaryLines = [
    `Location: ${path.join(answers.parentDirectory, answers.projectName)}`,
    `Preset: ${answers.preset.label}`,
    `Python: ${answers.basePython.executablePath}`,
    `Virtual environment: backend/${answers.venvDirectoryName}`,
    `Django package: ${answers.djangoPackageName}`,
    answers.starterAppName === undefined ? undefined : `Starter app: ${answers.starterAppName}`,
    answers.preset.includesFrontend ? `Package manager: ${answers.packageManager}` : undefined,
    `Git repository: ${initializeGit ? "Initialize" : "Skip"}`
  ].filter((line): line is string => line !== undefined);

  const choice = await vscode.window.showWarningMessage(
    `Create project "${answers.projectName}"?`,
    { modal: true, detail: summaryLines.join("\n") },
    "Create Project"
  );
  return choice === "Create Project";
}

async function createProject(context: CommandContext, answers: NewProjectAnswers, initializeGit: boolean): Promise<void> {
  const sink = context.operationTerminal.begin(`New Project: ${answers.projectName}`);
  let gitStatus: { status: "initialized" | "unavailable" | "failed"; detail?: string } | undefined;

  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Creating "${answers.projectName}"…`, cancellable: true },
    async (progress, token) => {
      const steps = buildNewProjectSteps(context.spawner, context.projectFileWriter, answers, {
        initializeGit,
        onOutput: (chunk) => sink.write(chunk),
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

  await offerToOpenProject(answers);
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

async function offerToOpenProject(answers: NewProjectAnswers): Promise<void> {
  const projectRoot = path.join(answers.parentDirectory, answers.projectName);
  const choice = await vscode.window.showInformationMessage(
    `Project "${answers.projectName}" was created successfully.`,
    "Open Project",
    "Open in New Window"
  );

  if (choice === "Open Project") {
    await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(projectRoot), { forceReuseWindow: true });
  } else if (choice === "Open in New Window") {
    await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(projectRoot), { forceNewWindow: true });
  }
}
