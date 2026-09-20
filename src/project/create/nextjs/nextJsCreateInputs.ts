import * as vscode from "vscode";
import type { PackageManager } from "../../../detection/packageManagerDetector";
import { DEFAULT_NEXTJS_PRESET_ID, NEXTJS_PRESETS, findNextJsPreset, type NextJsPreset } from "./nextJsNewProjectPresets";
import type { NextJsInputs } from "./nextJsScaffoldPlan";

const PACKAGE_MANAGER_CHOICES: readonly PackageManager[] = ["npm", "pnpm", "yarn", "bun"];

/**
 * Next.js's own presentation half - mirrors express/expressCreateInputs.ts's
 * shape. Only one preset currently exists
 * (docs/NEXTJS_CODE_TRUTH_AND_IMPLEMENTATION_PLAN.md §19.1), so this never
 * shows a single-item preset picker - it silently selects it, the same
 * "modules.length === 1 ? auto-select : showQuickPick" precedent
 * `commands/newProjectWizard.ts`'s own `pickProjectCreateModule()` already
 * uses one level up. The only real decision a user makes here is the
 * package manager. ESC at any step cancels with zero side effects. This
 * file is the only place in Next.js's module allowed to call vscode APIs -
 * nextJsScaffoldPlan.ts stays vscode-free.
 */
export async function collectNextJsInputs(): Promise<NextJsInputs | undefined> {
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

async function pickPreset(): Promise<NextJsPreset | undefined> {
  if (NEXTJS_PRESETS.length === 1) {
    return findNextJsPreset(DEFAULT_NEXTJS_PRESET_ID);
  }

  const items = NEXTJS_PRESETS.map((preset) => ({
    label: preset.id === DEFAULT_NEXTJS_PRESET_ID ? `${preset.label} (Recommended)` : preset.label,
    description: preset.description,
    preset
  }));
  const pick = await vscode.window.showQuickPick(items, { title: "New Next.js Project: Choose a Preset" });
  return pick?.preset;
}

async function pickPackageManager(): Promise<PackageManager | undefined> {
  const pick = await vscode.window.showQuickPick(
    PACKAGE_MANAGER_CHOICES.map((manager) => ({ label: manager, manager })),
    { title: "New Next.js Project: Choose a Package Manager" }
  );
  return pick?.manager;
}
