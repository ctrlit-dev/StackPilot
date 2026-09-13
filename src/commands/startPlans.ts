import type { DetectedProject } from "../detection/projectDetector";
import type { StackPilotConfiguration } from "../config/configurationModel";
import { buildDjangoRunServerCommand } from "../execution/backendCommand";
import { buildFrontendDevCommand } from "../execution/frontendCommand";
import type { StartProcessOptions } from "../execution/processManager";

/**
 * Pure decision logic for "what should Start Backend/Frontend actually do
 * given the current detection results". Kept separate from the vscode
 * command handlers so the branching (spec §44 error taxonomy: no backend, no
 * python, missing/ambiguous package manager) is unit-testable without the
 * Extension Host.
 */
export type BackendStartPlan =
  | { readonly kind: "ready"; readonly command: StartProcessOptions }
  | { readonly kind: "no-backend" }
  | { readonly kind: "no-python" };

export function planBackendStart(
  detectedProject: DetectedProject | undefined,
  configuration: StackPilotConfiguration
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
    command: buildDjangoRunServerCommand(python, backend, configuration.backendHost, configuration.backendPort)
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
