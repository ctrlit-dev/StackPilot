import type { BackendStartAdapter } from "../adapters/backendFrameworkAdapter";
import type { StackPilotConfiguration } from "../config/configurationModel";
import {
  getBackendService,
  getFrontendService,
  getNodeRuntime,
  getPythonEnvironment,
  type DetectedProject,
  type DetectedService
} from "../detection/detectedProject";
import { buildFrontendDevCommand } from "../execution/frontendCommand";
import type { StartProcessOptions } from "../execution/processManager";

/**
 * Pure decision logic for "what should Start Backend/Frontend actually do
 * given the current detection results". Kept separate from the vscode
 * command handlers so the branching (spec §44 error taxonomy: no backend, no
 * python, missing/ambiguous package manager) is unit-testable without the
 * Extension Host. `planBackendStart` itself has no knowledge of Django (or
 * any other framework)'s command shape - that is the resolved adapter's job;
 * this function only decides whether a start is possible at all.
 *
 * EXPRESS-1B: a backend can now be Python-runtime (Django/FastAPI) or
 * Node-runtime (Express), each with its own prerequisite shape - see
 * `checkBackendRuntimePrerequisite` below. `package-manager-missing`/
 * `package-manager-ambiguous` mirror `FrontendStartPlan`'s own outcomes for
 * the frontend's Node runtime (reused, not reinvented); `no-script` is new,
 * for a Node-runtime backend with no `dev`/`start` script to run.
 */
export type BackendStartPlan =
  | { readonly kind: "ready"; readonly command: StartProcessOptions }
  | { readonly kind: "no-backend" }
  | { readonly kind: "no-python" }
  | { readonly kind: "unsupported-framework" }
  | { readonly kind: "package-manager-missing"; readonly reason: string }
  | { readonly kind: "package-manager-ambiguous"; readonly candidates: readonly string[] }
  | { readonly kind: "no-script" };

/**
 * The one backend *start* adapter selection boundary (spec §17/§18):
 * resolves which registered `BackendStartAdapter` matches the detected
 * backend service's `frameworkId` - a plain array lookup, not a registry.
 * Shared by `planBackendStart` and the port-conflict retry path in
 * `commands/backendCommands.ts`, so there is exactly one place that knows
 * "how do I go from a detected service to its start adapter".
 */
export function resolveBackendStartAdapter(
  detectedProject: DetectedProject | undefined,
  backendStartAdapters: readonly BackendStartAdapter[]
): BackendStartAdapter | undefined {
  const frameworkId = getBackendService(detectedProject)?.frameworkId;
  if (frameworkId === undefined) {
    return undefined;
  }
  return backendStartAdapters.find((adapter) => adapter.id === frameworkId);
}

/**
 * Confirms the resolved adapter can actually build a start command for this
 * backend service's *runtime* before it is ever called - `buildStartCommand`
 * itself is a pure, always-total descriptor builder with no way to report
 * "not ready" (mirrors `djangoBackendAdapter`'s/`fastApiBackendAdapter`'s
 * own "structurally unreachable fallback" design), so the caller must check
 * first, exactly as it already did for Python.
 *
 * A small, explicit, runtime-*kind*-based branch (`python` vs `node`), not a
 * capability registry, and deliberately still framework-neutral: this
 * function does not import any concrete adapter (Django/FastAPI/Express) by
 * name - only `commands/registerCommands.ts`'s composition root does that -
 * so it only needs to know the two possible Node-backend script *names*
 * ("dev"/"start"), never which one a given adapter prefers. The preference
 * order itself (dev over start) lives in exactly one place,
 * `expressBackendAdapter.ts`'s own `pickExpressScript()` - this check only
 * needs "does at least one exist", which is order-independent.
 */
function checkBackendRuntimePrerequisite(backendService: DetectedService): Exclude<BackendStartPlan, { readonly kind: "ready" }> | undefined {
  const nodeRuntime = getNodeRuntime(backendService);

  if (nodeRuntime === undefined) {
    // Python-family backend (Django/FastAPI), or no runtime resolved at all -
    // existing behavior, unchanged.
    return getPythonEnvironment(backendService) === undefined ? { kind: "no-python" } : undefined;
  }

  const packageManager = nodeRuntime.packageManager;
  if (packageManager.kind === "missing") {
    return { kind: "package-manager-missing", reason: packageManager.reason };
  }
  if (packageManager.kind === "ambiguous") {
    return { kind: "package-manager-ambiguous", candidates: packageManager.candidates.map((candidate) => candidate.manager) };
  }
  if (!Object.hasOwn(nodeRuntime.scripts, "dev") && !Object.hasOwn(nodeRuntime.scripts, "start")) {
    return { kind: "no-script" };
  }

  return undefined;
}

export function planBackendStart(
  detectedProject: DetectedProject | undefined,
  configuration: StackPilotConfiguration,
  backendStartAdapters: readonly BackendStartAdapter[]
): BackendStartPlan {
  const backendService = getBackendService(detectedProject);
  if (backendService === undefined) {
    return { kind: "no-backend" };
  }

  const adapter = resolveBackendStartAdapter(detectedProject, backendStartAdapters);
  if (adapter === undefined) {
    return { kind: "unsupported-framework" };
  }

  const prerequisiteFailure = checkBackendRuntimePrerequisite(backendService);
  if (prerequisiteFailure !== undefined) {
    return prerequisiteFailure;
  }

  return {
    kind: "ready",
    command: adapter.buildStartCommand(backendService, configuration.backendHost, configuration.backendPort)
  };
}

export type FrontendStartPlan =
  | { readonly kind: "ready"; readonly command: StartProcessOptions }
  | { readonly kind: "no-frontend" }
  | { readonly kind: "package-manager-missing"; readonly reason: string }
  | { readonly kind: "package-manager-ambiguous"; readonly candidates: readonly string[] };

export function planFrontendStart(detectedProject: DetectedProject | undefined, configuration: StackPilotConfiguration): FrontendStartPlan {
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

  return {
    kind: "ready",
    command: buildFrontendDevCommand(frontendService.rootPath, packageManager.manager, configuration.frontendDevScript, configuration.frontendPort)
  };
}
