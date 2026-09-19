import * as path from "node:path";
import type { StackPilotConfiguration } from "../config/configurationModel";
import { getBackendService, getDjangoMetadata, getFastApiMetadata, getFrontendService, type DetectedProject } from "../detection/detectedProject";
import type { FileSystemProbe } from "../detection/fileSystem";
import { isPythonPackageInstalled } from "../detection/pythonPackageCheck";
import { resolveWorkspacePath } from "../utils/paths";

/** The backend frameworks this checklist can name specifically and verify a Python dependency for - see `FRAMEWORK_PACKAGE_NAME`. */
export type InitializationBackendFramework = "django" | "fastapi";

export interface InitializationFacts {
  readonly backendDetected: boolean;
  /**
   * The detected backend's framework, sourced from `getDjangoMetadata`/
   * `getFastApiMetadata` (never guessed from a filename) - undefined when no
   * backend was detected at all, or when one was detected but its framework
   * is neither of the two this checklist currently knows how to name and
   * verify. Drives both the checklist's top-row label and which package
   * `pythonDependenciesInstalled` actually checks for.
   */
  readonly backendFramework: InitializationBackendFramework | undefined;
  readonly requirementsFileDetected: boolean;
  readonly venvDetected: boolean;
  /** undefined = not checkable (no working venv to inspect, or the detected backend's framework isn't one this checklist can verify) */
  readonly pythonDependenciesInstalled: boolean | undefined;
  readonly frontendDetected: boolean;
  /** undefined = not checkable (no frontend detected) */
  readonly nodeModulesDetected: boolean | undefined;
}

const REQUIREMENTS_EVIDENCE = ["requirements.txt", "requirements/dev.txt"] as const;

/**
 * Each supported backend framework's own top-level importable package name -
 * conveniently identical to its `InitializationBackendFramework`/
 * `FrameworkAdapterId` string today, but kept as its own explicit mapping
 * (spec: "kleine, explizite Lösung", not a registry) rather than relying on
 * that coincidence.
 */
const FRAMEWORK_PACKAGE_NAME: Record<InitializationBackendFramework, string> = {
  django: "django",
  fastapi: "fastapi"
};

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
  const backend = getBackendService(detectedProject);
  const frontend = getFrontendService(detectedProject);
  const python = detectedProject?.pythonRuntime.selected;

  const backendFramework: InitializationBackendFramework | undefined =
    getDjangoMetadata(backend) !== undefined ? "django" : getFastApiMetadata(backend) !== undefined ? "fastapi" : undefined;

  const requirementsFileDetected = backend !== undefined && REQUIREMENTS_EVIDENCE.some((file) => backend.evidence.includes(file));
  const venvDetected = python?.source === "venv";

  let pythonDependenciesInstalled: boolean | undefined;
  if (venvDetected && backendFramework !== undefined) {
    const venvPath = python?.environmentPath ?? resolveWorkspacePath(workspaceRootPath, configuration.pythonVenvDirectory);
    pythonDependenciesInstalled = await isPythonPackageInstalled(fs, venvPath, FRAMEWORK_PACKAGE_NAME[backendFramework]);
  }

  let nodeModulesDetected: boolean | undefined;
  if (frontend !== undefined) {
    nodeModulesDetected = await fs.directoryExists(path.join(frontend.rootPath, "node_modules"));
  }

  return {
    backendDetected: backend !== undefined,
    backendFramework,
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
 * The checklist's top-row label, named after the actually detected backend
 * framework (never a hard-coded "Django") - sourced from `facts.backendFramework`,
 * which is itself sourced from `getDjangoMetadata`/`getFastApiMetadata`, never
 * guessed from a filename. Falls back to a framework-neutral "Backend project
 * detected" label both when nothing was detected at all (including a
 * deliberately backend-less standalone frontend project) and for the
 * currently-unreachable case of a detected backend whose framework this
 * checklist does not (yet) know how to name specifically - never claiming
 * Django for a backend that isn't Django.
 */
function backendChecklistLabel(facts: InitializationFacts): string {
  if (facts.backendFramework === "fastapi") {
    return "FastAPI project detected";
  }
  if (facts.backendFramework === "django") {
    return "Django project detected";
  }
  return "Backend project detected";
}

/**
 * Builds the spec §25 checklist and the set of applicable follow-up actions.
 * Every action offered here is idempotent to run again (venv creation
 * refuses to overwrite a healthy one; pip/npm install are safe re-runs), so
 * offering an action the user has already completed is harmless rather than
 * "reinstalling everything on every click".
 */
export function analyzeInitialization(facts: InitializationFacts): InitializationPlan {
  const checklist: InitializationChecklistItem[] = [{ label: backendChecklistLabel(facts), done: facts.backendDetected }];

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
