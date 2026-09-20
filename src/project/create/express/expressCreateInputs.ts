import * as vscode from "vscode";
import type { PackageManager } from "../../../detection/packageManagerDetector";
import { DEFAULT_EXPRESS_PRESET_ID, EXPRESS_PRESETS, type ExpressPreset } from "./expressNewProjectPresets";
import type { ExpressInputs } from "./expressScaffoldPlan";

const PACKAGE_MANAGER_CHOICES: readonly PackageManager[] = ["npm", "pnpm", "yarn", "bun"];

/**
 * Express's own presentation half - mirrors django/fastapi's own
 * collect*Inputs() shape, shorter than either: no Python interpreter, no
 * venv-directory prompt, no package/starter-app-name prompt exists (§9 -
 * package.json's own "name" is derived, never asked for). Takes no
 * `ProjectCreateContext` - nothing here needs the filesystem, spawner, or
 * workspace state, unlike FastAPI's own `pickBasePython()`. ESC at any step
 * cancels with zero side effects. This file is the only place in Express's
 * module allowed to call vscode APIs - expressScaffoldPlan.ts stays
 * vscode-free.
 *
 * Unlike FastAPI (which only asks for a package manager when its Vite preset
 * is chosen, since FastAPI's own backend is pip-only), Express always asks -
 * its own `<packageManager> install` step needs one regardless of preset
 * (plan §5). The same choice is reused for the nested Vite frontend when the
 * "+ Vite" preset is picked - one prompt, not two.
 */
export async function collectExpressInputs(): Promise<ExpressInputs | undefined> {
  const preset = await pickPreset();
  if (preset === undefined) {
    return undefined;
  }

  const packageManager = await pickPackageManager();
  if (packageManager === undefined) {
    return undefined;
  }

  return { preset, packageManager };
}

async function pickPreset(): Promise<ExpressPreset | undefined> {
  const items = EXPRESS_PRESETS.map((preset) => ({
    label: preset.id === DEFAULT_EXPRESS_PRESET_ID ? `${preset.label} (Recommended)` : preset.label,
    description: preset.description,
    preset
  }));
  const pick = await vscode.window.showQuickPick(items, { title: "New Express Project: Choose a Preset" });
  return pick?.preset;
}

async function pickPackageManager(): Promise<PackageManager | undefined> {
  const pick = await vscode.window.showQuickPick(
    PACKAGE_MANAGER_CHOICES.map((manager) => ({ label: manager, manager })),
    { title: "New Express Project: Choose a Package Manager" }
  );
  return pick?.manager;
}
