import type { BackendStartAdapter } from "../adapters/backendFrameworkAdapter";
import type { StackPilotConfiguration } from "../config/configurationModel";
import {
  getBackendService,
  getFrontendService,
  getNodeRuntime,
  getPythonEnvironment,
  type DetectedProject
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
 */
export type BackendStartPlan =
  | { readonly kind: "ready"; readonly command: StartProcessOptions }
  | { readonly kind: "no-backend" }
  | { readonly kind: "no-python" }
  | { readonly kind: "unsupported-framework" };

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

  const python = getPythonEnvironment(backendService);
  if (python === undefined) {
    return { kind: "no-python" };
  }

  return {
    kind: "ready",
    command: adapter.buildStartCommand(python, backendService, configuration.backendHost, configuration.backendPort)
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
