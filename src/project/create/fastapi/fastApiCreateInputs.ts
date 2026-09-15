import * as vscode from "vscode";
import type { PackageManager } from "../../../detection/packageManagerDetector";
import { detectPythonEnvironment, type PythonEnvironment } from "../../../detection/pythonDetector";
import { showActionableError } from "../../../ui/notifications";
import { validateFolderName } from "../../projectNameValidation";
import type { BackendCreateContext } from "../backendCreateModule";
import { DEFAULT_FASTAPI_PRESET_ID, FASTAPI_PRESETS, type FastApiPreset } from "./fastApiNewProjectPresets";
import type { FastApiInputs } from "./fastApiScaffoldPlan";

const PACKAGE_MANAGER_CHOICES: readonly PackageManager[] = ["npm", "pnpm", "yarn", "bun"];

/**
 * FastAPI's own presentation half - mirrors django/djangoCreateInputs.ts's
 * shape and reuses the same generic detectPythonEnvironment()/
 * validateFolderName() primitives (no second Python discovery, no
 * FastAPI-specific package-manager detection). Shorter than Django's: no
 * package-name or starter-app prompt exists, since the flat main.py layout
 * has nothing analogous to name. ESC at any step cancels with zero side
 * effects. This file is the only place in FastAPI's module allowed to call
 * vscode APIs - fastApiScaffoldPlan.ts stays vscode-free.
 *
 * Ends after the package-manager prompt, same as Django: the Git-repository
 * prompt and the final confirmation dialog are generic project-creation
 * concerns owned by the wizard, not a backend input.
 */
export async function collectFastApiInputs(context: BackendCreateContext): Promise<FastApiInputs | undefined> {
  const preset = await pickPreset();
  if (preset === undefined) {
    return undefined;
  }

  const basePython = await pickBasePython(context);
  if (basePython === undefined) {
    return undefined;
  }

  const venvDirectoryName = await vscode.window.showInputBox({
    title: "New FastAPI Project: Virtual Environment Folder",
    prompt: "Folder name for the virtual environment, created at the project root",
    value: ".venv",
    validateInput: (value) => validationMessage(validateFolderName(value))
  });
  if (venvDirectoryName === undefined) {
    return undefined;
  }

  let packageManager: PackageManager | undefined;
  if (preset.includesFrontend) {
    const pick = await vscode.window.showQuickPick(
      PACKAGE_MANAGER_CHOICES.map((manager) => ({ label: manager, manager })),
      { title: "New FastAPI Project: Choose a Package Manager" }
    );
    if (pick === undefined) {
      return undefined;
    }
    packageManager = pick.manager;
  }

  return { preset, basePython, venvDirectoryName, packageManager };
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

async function pickPreset(): Promise<FastApiPreset | undefined> {
  const items = FASTAPI_PRESETS.map((preset) => ({
    label: preset.id === DEFAULT_FASTAPI_PRESET_ID ? `${preset.label} (Recommended)` : preset.label,
    description: preset.description,
    preset
  }));
  const pick = await vscode.window.showQuickPick(items, { title: "New FastAPI Project: Choose a Preset" });
  return pick?.preset;
}

async function pickBasePython(context: BackendCreateContext): Promise<PythonEnvironment | undefined> {
  // No project exists yet, so this only ever finds PATH-based interpreters -
  // same precondition and same underlying detectPythonEnvironment() call
  // django/djangoCreateInputs.ts's own pickBasePython() already makes.
  const detection = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "New FastAPI Project: Looking for a Python interpreter…" },
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
    { title: "New FastAPI Project: Choose a Python Interpreter" }
  );
  return pick?.candidate;
}
