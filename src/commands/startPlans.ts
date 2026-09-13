import type { BackendFrameworkAdapter } from "../adapters/backendFrameworkAdapter";
import type { DetectedProject } from "../detection/projectDetector";
import type { StackPilotConfiguration } from "../config/configurationModel";
import { buildFrontendDevCommand } from "../execution/frontendCommand";
import type { StartProcessOptions } from "../execution/processManager";

/**
 * Pure decision logic for "what should Start Backend/Frontend actually do
 * given the current detection results". Kept separate from the vscode
 * command handlers so the branching (spec §44 error taxonomy: no backend, no
 * python, missing/ambiguous package manager) is unit-testable without the
 * Extension Host. `planBackendStart` itself has no knowledge of Django (or
 * any other framework)'s command shape - that is the injected adapter's job;
 * this function only decides whether a start is possible at all.
 */
export type BackendStartPlan =
  | { readonly kind: "ready"; readonly command: StartProcessOptions }
  | { readonly kind: "no-backend" }
  | { readonly kind: "no-python" };

export function planBackendStart(
  detectedProject: DetectedProject | undefined,
  configuration: StackPilotConfiguration,
  backendAdapter: BackendFrameworkAdapter
): BackendStartPlan {
  const backend = detectedProject?.backend.selected;
  if (backend === undefined) {
    return { kind: "no-backend" };
  }

  const python = detectedProject?.python.selected;
  if (python === undefined) {
    return { kind: "no-python" };
  }

  return {
    kind: "ready",
    command: backendAdapter.buildStartCommand(python, backend, configuration.backendHost, configuration.backendPort)
  };
}

export type FrontendStartPlan =
  | { readonly kind: "ready"; readonly command: StartProcessOptions }
  | { readonly kind: "no-frontend" }
  | { readonly kind: "package-manager-missing"; readonly reason: string }
  | { readonly kind: "package-manager-ambiguous"; readonly candidates: readonly string[] };

export function planFrontendStart(
  detectedProject: DetectedProject | undefined,
  configuration: StackPilotConfiguration
): FrontendStartPlan {
  const frontend = detectedProject?.frontend.selected;
  if (frontend === undefined) {
    return { kind: "no-frontend" };
  }

  const packageManager = frontend.packageManager;
  if (packageManager.kind === "missing") {
    return { kind: "package-manager-missing", reason: packageManager.reason };
  }
  if (packageManager.kind === "ambiguous") {
    return { kind: "package-manager-ambiguous", candidates: packageManager.candidates.map((candidate) => candidate.manager) };
  }

  return {
    kind: "ready",
    command: buildFrontendDevCommand(frontend, packageManager.manager, configuration.frontendDevScript, configuration.frontendPort)
  };
}
