import * as path from "node:path";
import type { StackPilotConfiguration } from "../config/configurationModel";
import type { FileSystemProbe } from "../detection/fileSystem";
import type { DetectedProject } from "../detection/projectDetector";
import { isDjangoInstalled } from "../detection/pythonPackageCheck";
import { resolveWorkspacePath } from "../utils/paths";

export interface InitializationFacts {
  readonly backendDetected: boolean;
  readonly requirementsFileDetected: boolean;
  readonly venvDetected: boolean;
  /** undefined = not checkable (no working venv to inspect) */
  readonly pythonDependenciesInstalled: boolean | undefined;
  readonly frontendDetected: boolean;
  /** undefined = not checkable (no frontend detected) */
  readonly nodeModulesDetected: boolean | undefined;
}

const REQUIREMENTS_EVIDENCE = ["requirements.txt", "requirements/dev.txt"] as const;

/**
 * Gathers the raw facts spec §25's checklist needs, beyond what normal
 * detection already provides. This is the only impure part - the actual
 * checklist/action decisions in analyzeInitialization() below are pure.
 */
export async function gatherInitializationFacts(
  fs: FileSystemProbe,
  workspaceRootPath: string,
  detectedProject: DetectedProject | undefined,
  configuration: StackPilotConfiguration
): Promise<InitializationFacts> {
  const backend = detectedProject?.backend.selected;
  const frontend = detectedProject?.frontend.selected;
  const python = detectedProject?.python.selected;

  const requirementsFileDetected = backend !== undefined && REQUIREMENTS_EVIDENCE.some((file) => backend.evidence.includes(file));
  const venvDetected = python?.source === "venv";

  let pythonDependenciesInstalled: boolean | undefined;
  if (venvDetected) {
    const venvPath = python?.environmentPath ?? resolveWorkspacePath(workspaceRootPath, configuration.pythonVenvDirectory);
    pythonDependenciesInstalled = await isDjangoInstalled(fs, venvPath);
  }

  let nodeModulesDetected: boolean | undefined;
  if (frontend !== undefined) {
    nodeModulesDetected = await fs.directoryExists(path.join(frontend.rootPath, "node_modules"));
  }

  return {
    backendDetected: backend !== undefined,
    requirementsFileDetected,
    venvDetected,
    pythonDependenciesInstalled,
    frontendDetected: frontend !== undefined,
    nodeModulesDetected
  };
}

export interface InitializationChecklistItem {
  readonly label: string;
  /** undefined = unknown/not checkable, shown distinctly from done/not-done */
  readonly done: boolean | undefined;
}

export interface InitializationPlan {
  readonly checklist: readonly InitializationChecklistItem[];
  readonly canCreateVenv: boolean;
  readonly canInstallPythonDependencies: boolean;
  readonly canInstallFrontendDependencies: boolean;
}

/**
 * Builds the spec §25 checklist and the set of applicable follow-up actions.
 * Every action offered here is idempotent to run again (venv creation
 * refuses to overwrite a healthy one; pip/npm install are safe re-runs), so
 * offering an action the user has already completed is harmless rather than
 * "reinstalling everything on every click".
 */
export function analyzeInitialization(facts: InitializationFacts): InitializationPlan {
  const checklist: InitializationChecklistItem[] = [{ label: "Django project detected", done: facts.backendDetected }];

  if (facts.backendDetected) {
    checklist.push({ label: "Virtual environment", done: facts.venvDetected });
    checklist.push({ label: "requirements.txt detected", done: facts.requirementsFileDetected });
    if (facts.requirementsFileDetected) {
      checklist.push({ label: "Python dependencies installed", done: facts.pythonDependenciesInstalled });
    }
  }

  checklist.push({ label: "Vite frontend detected", done: facts.frontendDetected });
  if (facts.frontendDetected) {
    checklist.push({ label: "node_modules present", done: facts.nodeModulesDetected });
  }

  return {
    checklist,
    canCreateVenv: facts.backendDetected && !facts.venvDetected,
    canInstallPythonDependencies: facts.backendDetected && facts.requirementsFileDetected && facts.pythonDependenciesInstalled !== true,
    canInstallFrontendDependencies: facts.frontendDetected && facts.nodeModulesDetected !== true
  };
}
