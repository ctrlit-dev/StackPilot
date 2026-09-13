import { getFrontendService, getNodeRuntime, type DetectedProject } from "../detection/detectedProject";
import type { PackageManager } from "../detection/packageManagerDetector";
import {
  buildFrontendBuildCommand,
  buildFrontendInstallCommand,
  buildFrontendScriptCommand,
  buildFrontendTestCommand
} from "../execution/frontendOperationCommand";
import type { OneShotCommandOptions } from "../execution/oneShotCommand";

export type FrontendOperationPlan =
  | { readonly kind: "ready"; readonly command: OneShotCommandOptions }
  | { readonly kind: "no-frontend" }
  | { readonly kind: "package-manager-missing"; readonly reason: string }
  | { readonly kind: "package-manager-ambiguous"; readonly candidates: readonly string[] }
  | { readonly kind: "no-script" };

export function planInstallFrontendDependencies(detectedProject: DetectedProject | undefined): FrontendOperationPlan {
  const frontendService = getFrontendService(detectedProject);
  if (frontendService === undefined) {
    return { kind: "no-frontend" };
  }

  const packageManager = getNodeRuntime(frontendService)?.packageManager;
  if (packageManager === undefined || packageManager.kind === "missing") {
    return {
      kind: "package-manager-missing",
      reason: packageManager?.kind === "missing" ? packageManager.reason : "No supported package-manager lockfile was found."
    };
  }
  if (packageManager.kind === "ambiguous") {
    return { kind: "package-manager-ambiguous", candidates: packageManager.candidates.map((candidate) => candidate.manager) };
  }

  return { kind: "ready", command: buildFrontendInstallCommand(frontendService.rootPath, packageManager.manager) };
}

/**
 * Shared by build/test/run-script: all need a frontend, a resolved package
 * manager, AND (unlike install) an actual matching package.json script
 * (spec §24: "Only enable when a matching script exists. Do not assume
 * every Vite project has tests.").
 */
function planScriptOperation(
  detectedProject: DetectedProject | undefined,
  scriptName: string,
  build: (rootPath: string, packageManager: PackageManager, scriptName: string) => OneShotCommandOptions
): FrontendOperationPlan {
  const frontendService = getFrontendService(detectedProject);
  if (frontendService === undefined) {
    return { kind: "no-frontend" };
  }

  const runtime = getNodeRuntime(frontendService);
  const packageManager = runtime?.packageManager;
  if (packageManager === undefined || packageManager.kind === "missing") {
    return {
      kind: "package-manager-missing",
      reason: packageManager?.kind === "missing" ? packageManager.reason : "No supported package-manager lockfile was found."
    };
  }
  if (packageManager.kind === "ambiguous") {
    return { kind: "package-manager-ambiguous", candidates: packageManager.candidates.map((candidate) => candidate.manager) };
  }

  if (runtime === undefined || !Object.hasOwn(runtime.scripts, scriptName)) {
    return { kind: "no-script" };
  }

  return { kind: "ready", command: build(frontendService.rootPath, packageManager.manager, scriptName) };
}

export function planBuildFrontend(detectedProject: DetectedProject | undefined, buildScript: string): FrontendOperationPlan {
  return planScriptOperation(detectedProject, buildScript, buildFrontendBuildCommand);
}

export function planTestFrontend(detectedProject: DetectedProject | undefined, testScript: string): FrontendOperationPlan {
  return planScriptOperation(detectedProject, testScript, buildFrontendTestCommand);
}

/**
 * The escape hatch for any package.json script without a dedicated menu
 * entry (e.g. "lint", "format", a custom "codegen" script).
 */
export function planRunFrontendScript(detectedProject: DetectedProject | undefined, scriptName: string): FrontendOperationPlan {
  return planScriptOperation(detectedProject, scriptName, buildFrontendScriptCommand);
}
