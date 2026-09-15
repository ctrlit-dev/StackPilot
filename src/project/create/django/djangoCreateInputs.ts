import * as vscode from "vscode";
import { validateDjangoAppName } from "../../../adapters/djangoIdentifierValidation";
import type { PackageManager } from "../../../detection/packageManagerDetector";
import { detectPythonEnvironment, type PythonEnvironment } from "../../../detection/pythonDetector";
import { showActionableError } from "../../../ui/notifications";
import { validateFolderName } from "../../projectNameValidation";
import type { BackendCreateContext } from "../backendCreateModule";
import { DEFAULT_PRESET_ID, NEW_PROJECT_PRESETS, type NewProjectPreset } from "./djangoNewProjectPresets";
import type { DjangoInputs } from "./djangoScaffoldPlan";

const PACKAGE_MANAGER_CHOICES: readonly PackageManager[] = ["npm", "pnpm", "yarn", "bun"];

/**
 * Django's own presentation half - moved verbatim from the pre-CREATE-ARCH-1B
 * newProjectWizard.ts. Every prompt's title, wording, default, validation,
 * and ordering is unchanged; ESC at any step cancels with zero side effects,
 * exactly as before. This file is the only place in Django's module allowed
 * to call vscode APIs - djangoScaffoldPlan.ts stays vscode-free.
 *
 * Ends after the package-manager prompt (CREATE-ARCH-1B.1 correction): the
 * Git-repository prompt and the final confirmation dialog are generic
 * project-creation concerns, not Django inputs - the generic wizard asks
 * Git and composes/shows the one final confirmation itself, using this
 * module's confirmationSummary contribution (built in djangoScaffoldPlan.ts).
 */
export async function collectDjangoInputs(context: BackendCreateContext): Promise<DjangoInputs | undefined> {
  const preset = await pickPreset();
  if (preset === undefined) {
    return undefined;
  }

  const basePython = await pickBasePython(context);
  if (basePython === undefined) {
    return undefined;
  }

  const venvDirectoryName = await vscode.window.showInputBox({
    title: "New Django + Vite Project: Virtual Environment Folder",
    prompt: "Folder name for the virtual environment, created inside backend/",
    value: ".venv",
    validateInput: (value) => validationMessage(validateFolderName(value))
  });
  if (venvDirectoryName === undefined) {
    return undefined;
  }

  const djangoPackageName = await vscode.window.showInputBox({
    title: "New Django + Vite Project: Django Project Package Name",
    prompt: "Python package name for the Django project (does not need to match the folder name)",
    value: "config",
    validateInput: (value) => validationMessage(validateDjangoAppName(value))
  });
  if (djangoPackageName === undefined) {
    return undefined;
  }

  const starterAppNameInput = await vscode.window.showInputBox({
    title: "New Django + Vite Project: Starter App (Optional)",
    prompt: "Optional: name of an initial Django app to create now. Leave empty to skip.",
    validateInput: (value) => (value.length === 0 ? undefined : validationMessage(validateDjangoAppName(value)))
  });
  if (starterAppNameInput === undefined) {
    return undefined;
  }
  const starterAppName = starterAppNameInput.length === 0 ? undefined : starterAppNameInput;

  let packageManager: PackageManager | undefined;
  if (preset.includesFrontend) {
    const pick = await vscode.window.showQuickPick(
      PACKAGE_MANAGER_CHOICES.map((manager) => ({ label: manager, manager })),
      { title: "New Django + Vite Project: Choose a Package Manager" }
    );
    if (pick === undefined) {
      return undefined;
    }
    packageManager = pick.manager;
  }

  return { preset, basePython, venvDirectoryName, djangoPackageName, starterAppName, packageManager };
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

async function pickPreset(): Promise<NewProjectPreset | undefined> {
  const items = NEW_PROJECT_PRESETS.map((preset) => ({
    label: preset.id === DEFAULT_PRESET_ID ? `${preset.label} (Recommended)` : preset.label,
    description: preset.description,
    preset
  }));
  const pick = await vscode.window.showQuickPick(items, { title: "New Django + Vite Project: Choose a Preset" });
  return pick?.preset;
}

async function pickBasePython(context: BackendCreateContext): Promise<PythonEnvironment | undefined> {
  // No project exists yet, so this only ever finds PATH-based interpreters
  // (there is no backend/.venv to detect and no configured interpreter for
  // a project that does not exist).
  const detection = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "New Django + Vite Project: Looking for a Python interpreter…" },
    () => withTimeout(detectPythonEnvironment(context.fileSystem, process.cwd(), undefined, context.configuration), 10_000)
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
