import * as path from "node:path";
import type { StackPilotConfiguration } from "../config/configurationModel";
import {
  frameworkDisplayLabel,
  getBackendService,
  getDjangoMetadata,
  getFastApiMetadata,
  getFrontendService,
  type DetectedProject
} from "../detection/detectedProject";
import type { FileSystemProbe } from "../detection/fileSystem";
import { isPythonPackageInstalled } from "../detection/pythonPackageCheck";
import { resolveWorkspacePath } from "../utils/paths";

/**
 * The backend frameworks this checklist can name specifically. `"express"`
 * (EXPRESS-1C) is a Node-runtime framework and therefore never appears as a
 * key in `FRAMEWORK_PACKAGE_NAME` below - it has no importable Python
 * package to verify, by construction, not by omission.
 */
export type InitializationBackendFramework = "django" | "fastapi" | "express";

export interface InitializationFacts {
  readonly backendDetected: boolean;
  /**
   * The detected backend's framework, sourced from `getDjangoMetadata`/
   * `getFastApiMetadata`/`frameworkId === "express"` (never guessed from a
   * filename) - undefined when no backend was detected at all, or when one
   * was detected but its framework is none of the three this checklist
   * currently knows how to name. Drives the checklist's top-row label.
   */
  readonly backendFramework: InitializationBackendFramework | undefined;
  /**
   * The detected backend's own runtime kind (EXPRESS-1C) - `undefined` only
   * when no backend was detected at all. This is the field `analyzeInitialization()`
   * itself must branch on (not merely a fact `gatherInitializationFacts()`
   * happens to leave falsy) so a Node-runtime backend can never be offered a
   * Python-only action, regardless of *why* the Python-specific facts below
   * are also falsy for it.
   */
  readonly backendRuntimeKind: "python" | "node" | undefined;
  readonly requirementsFileDetected: boolean;
  readonly venvDetected: boolean;
  /** undefined = not checkable (no working venv to inspect, or the detected backend's framework isn't one this checklist can verify) */
  readonly pythonDependenciesInstalled: boolean | undefined;
  /** undefined = not checkable (backend isn't a Node-runtime service). Deliberately separate from the frontend's own `nodeModulesDetected` - a backend's and a frontend's `node_modules` live at two independent service roots and must never be conflated (Express + Vite). */
  readonly backendNodeModulesDetected: boolean | undefined;
  readonly frontendDetected: boolean;
  /** undefined = not checkable (no frontend detected) */
  readonly nodeModulesDetected: boolean | undefined;
  /**
   * NEXTJS-1C: the frontend's own display label ("Vite"/"Next.js"), sourced
   * from `frameworkDisplayLabel()` - never a second, independently
   * maintained framework-name mapping. `undefined` both when no frontend
   * was detected at all and when one was detected but its framework isn't
   * one `frameworkDisplayLabel()` can currently name - the checklist itself
   * (`frontendChecklistLabel()`) is what turns that ambiguity into the
   * correct neutral fallback, using `frontendDetected` to tell the two
   * apart.
   */
  readonly frontendFrameworkLabel: string | undefined;
}

const REQUIREMENTS_EVIDENCE = ["requirements.txt", "requirements/dev.txt"] as const;

/**
 * Each supported Python backend framework's own top-level importable package
 * name - conveniently identical to its `InitializationBackendFramework`/
 * `FrameworkAdapterId` string today, but kept as its own explicit mapping
 * (spec: "kleine, explizite Lösung", not a registry) rather than relying on
 * that coincidence. Deliberately typed over exactly `"django" | "fastapi"`,
 * NOT the full `InitializationBackendFramework` union - Express has no
 * Python package to name, and widening this map would force a meaningless
 * `express: "..."` entry. The one call site below narrows explicitly instead.
 */
const FRAMEWORK_PACKAGE_NAME: Record<"django" | "fastapi", string> = {
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

  const backendRuntimeKind = backend?.runtime?.kind;

  const backendFramework: InitializationBackendFramework | undefined =
    getDjangoMetadata(backend) !== undefined
      ? "django"
      : getFastApiMetadata(backend) !== undefined
        ? "fastapi"
        : backend?.frameworkId === "express"
          ? "express"
          : undefined;

  const requirementsFileDetected =
    backendRuntimeKind === "python" && backend !== undefined && REQUIREMENTS_EVIDENCE.some((file) => backend.evidence.includes(file));
  const venvDetected = backendRuntimeKind === "python" && python?.source === "venv";

  let pythonDependenciesInstalled: boolean | undefined;
  if (venvDetected && (backendFramework === "django" || backendFramework === "fastapi")) {
    const venvPath = python?.environmentPath ?? resolveWorkspacePath(workspaceRootPath, configuration.pythonVenvDirectory);
    pythonDependenciesInstalled = await isPythonPackageInstalled(fs, venvPath, FRAMEWORK_PACKAGE_NAME[backendFramework]);
  }

  let backendNodeModulesDetected: boolean | undefined;
  if (backendRuntimeKind === "node" && backend !== undefined) {
    backendNodeModulesDetected = await fs.directoryExists(path.join(backend.rootPath, "node_modules"));
  }

  let nodeModulesDetected: boolean | undefined;
  if (frontend !== undefined) {
    nodeModulesDetected = await fs.directoryExists(path.join(frontend.rootPath, "node_modules"));
  }

  return {
    backendDetected: backend !== undefined,
    backendFramework,
    backendRuntimeKind,
    requirementsFileDetected,
    venvDetected,
    pythonDependenciesInstalled,
    backendNodeModulesDetected,
    frontendDetected: frontend !== undefined,
    nodeModulesDetected,
    frontendFrameworkLabel: frameworkDisplayLabel(frontend)
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
  if (facts.backendFramework === "express") {
    return "Express project detected";
  }
  return "Backend project detected";
}

/**
 * NEXTJS-1C: mirrors `backendChecklistLabel()`'s own naming pattern -
 * named after the actually detected frontend framework (never hard-coded
 * to one framework), sourced from `facts.frontendFrameworkLabel`, itself
 * sourced from `frameworkDisplayLabel()`. Falls back to a framework-neutral
 * "Frontend detected" for a detected frontend whose framework this
 * checklist does not (yet) know how to name specifically - never claiming
 * Vite for a frontend that isn't Vite - and to "No frontend detected" when
 * `facts.frontendDetected` is false, so the row's own wording never
 * contradicts its `done` state.
 */
function frontendChecklistLabel(facts: InitializationFacts): string {
  if (facts.frontendFrameworkLabel !== undefined) {
    return `${facts.frontendFrameworkLabel} frontend detected`;
  }
  return facts.frontendDetected ? "Frontend detected" : "No frontend detected";
}

/**
 * Builds the spec §25 checklist and the set of applicable follow-up actions.
 * Every action offered here is idempotent to run again (venv creation
 * refuses to overwrite a healthy one; pip/npm install are safe re-runs), so
 * offering an action the user has already completed is harmless rather than
 * "reinstalling everything on every click".
 *
 * EXPRESS-1C: `canCreateVenv`/`canInstallPythonDependencies` branch on
 * `facts.backendRuntimeKind` explicitly, here, rather than only trusting
 * `venvDetected`/`requirementsFileDetected` to already be falsy for a
 * Node-runtime backend - this function is the pure logic layer, and it must
 * itself know a Node-runtime backend can never be offered a Python-only
 * action, not merely inherit that as an accident of how the facts were
 * computed upstream.
 */
export function analyzeInitialization(facts: InitializationFacts): InitializationPlan {
  const checklist: InitializationChecklistItem[] = [{ label: backendChecklistLabel(facts), done: facts.backendDetected }];

  if (facts.backendDetected && facts.backendRuntimeKind === "node") {
    checklist.push({ label: "node_modules present", done: facts.backendNodeModulesDetected });
  } else if (facts.backendDetected) {
    checklist.push({ label: "Virtual environment", done: facts.venvDetected });
    checklist.push({ label: "requirements.txt detected", done: facts.requirementsFileDetected });
    if (facts.requirementsFileDetected) {
      checklist.push({ label: "Python dependencies installed", done: facts.pythonDependenciesInstalled });
    }
  }

  checklist.push({ label: frontendChecklistLabel(facts), done: facts.frontendDetected });
  if (facts.frontendDetected) {
    checklist.push({ label: "node_modules present", done: facts.nodeModulesDetected });
  }

  const isPythonBackend = facts.backendDetected && facts.backendRuntimeKind === "python";

  return {
    checklist,
    canCreateVenv: isPythonBackend && !facts.venvDetected,
    canInstallPythonDependencies: isPythonBackend && facts.requirementsFileDetected && facts.pythonDependenciesInstalled !== true,
    canInstallFrontendDependencies: facts.frontendDetected && facts.nodeModulesDetected !== true
  };
}
