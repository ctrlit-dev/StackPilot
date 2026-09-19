import * as vscode from "vscode";
import type { PackageManager } from "../../../detection/packageManagerDetector";
import type { ViteTemplate } from "../../../execution/viteScaffoldCommand";
import { describeViteTemplate, type ViteReactInputs } from "./viteReactScaffoldPlan";

const PACKAGE_MANAGER_CHOICES: readonly PackageManager[] = ["npm", "pnpm", "yarn", "bun"];
const VITE_TEMPLATE_CHOICES: readonly ViteTemplate[] = ["react-ts", "react"];
const DEFAULT_VITE_TEMPLATE: ViteTemplate = "react-ts";

/**
 * React + Vite's own presentation half - mirrors django/djangoCreateInputs.ts's
 * and fastapi/fastApiCreateInputs.ts's shape. No preset prompt exists - only
 * two real decisions exist for a standalone Vite scaffold (template, package
 * manager), which does not warrant a preset table (plan §5/§8). ESC at any
 * step cancels with zero side effects. This file is the only place in this
 * module allowed to call vscode APIs - viteReactScaffoldPlan.ts stays
 * vscode-free.
 *
 * Ends after the package-manager prompt, same as Django/FastAPI: the
 * Git-repository prompt and the final confirmation dialog are generic
 * project-creation concerns owned by the wizard, not a module input.
 *
 * Takes no ProjectCreateContext - unlike Django's/FastAPI's own
 * collectXInputs(), nothing here needs Python detection, the file system, or
 * any other injected fact; both real decisions (template, package manager)
 * are closed-choice prompts with no external state to consult.
 */
export async function collectViteReactInputs(): Promise<ViteReactInputs | undefined> {
  const template = await pickTemplate();
  if (template === undefined) {
    return undefined;
  }

  const packageManager = await pickPackageManager();
  if (packageManager === undefined) {
    return undefined;
  }

  return { template, packageManager };
}

async function pickTemplate(): Promise<ViteTemplate | undefined> {
  const items = VITE_TEMPLATE_CHOICES.map((template) => ({
    label: template === DEFAULT_VITE_TEMPLATE ? `${describeViteTemplate(template)} (Recommended)` : describeViteTemplate(template),
    template
  }));
  const pick = await vscode.window.showQuickPick(items, { title: "New React + Vite Project: Choose a Template" });
  return pick?.template;
}

async function pickPackageManager(): Promise<PackageManager | undefined> {
  const pick = await vscode.window.showQuickPick(
    PACKAGE_MANAGER_CHOICES.map((manager) => ({ label: manager, manager })),
    { title: "New React + Vite Project: Choose a Package Manager" }
  );
  return pick?.manager;
}
