import * as path from "node:path";
import { getFrontendService, getNodeRuntime } from "../../detection/detectedProject";
import { COMMAND_INSTALL_FRONTEND_DEPENDENCIES } from "../../constants";
import { FRONTEND_SERVICE_ID } from "../../serviceId";
import type { DiagnosticResult } from "../diagnostic";
import type { DiagnosticCheck } from "../diagnosticCheck";

/**
 * Both results here are about the same detected frontend service's Node
 * runtime, so they live in one check rather than two near-identical files.
 * `node_modules` is checked at the frontend service's own `rootPath` (e.g.
 * "frontend/"), never at the workspace root - the two need not be the same
 * directory, and only the service's own root is where its dependencies
 * would actually be installed.
 */
export const nodeDependenciesCheck: DiagnosticCheck = {
  async run(context) {
    const frontend = getFrontendService(context.detectedProject);
    if (frontend === undefined) {
      return [];
    }

    const results: DiagnosticResult[] = [];
    const packageManager = getNodeRuntime(frontend)?.packageManager;

    const nodeModulesPresent = await context.fileSystem.directoryExists(path.join(frontend.rootPath, "node_modules"));
    if (!nodeModulesPresent) {
      results.push({
        code: "node.dependencies.missing",
        severity: "warning",
        message: "node_modules is missing for the detected frontend.",
        serviceId: FRONTEND_SERVICE_ID,
        // Only offered when the install command would actually succeed -
        // otherwise the accompanying node.packageManager.blocked result
        // already explains why, and this action would just fail immediately.
        action:
          packageManager?.kind === "detected"
            ? { label: "Install Frontend Dependencies", commandId: COMMAND_INSTALL_FRONTEND_DEPENDENCIES }
            : undefined
      });
    }

    if (packageManager?.kind === "missing") {
      // Reuses the exact reason string packageManagerDetector.ts already
      // produces, rather than inventing new wording for the same fact.
      results.push({
        code: "node.packageManager.blocked",
        severity: "warning",
        message: packageManager.reason,
        serviceId: FRONTEND_SERVICE_ID
      });
    } else if (packageManager?.kind === "ambiguous") {
      const candidateNames = packageManager.candidates.map((candidate) => candidate.manager).join(", ");
      results.push({
        code: "node.packageManager.blocked",
        severity: "warning",
        message: `Multiple package-manager lockfiles were found (${candidateNames}). Set stackPilot.frontend.packageManager to choose one.`,
        serviceId: FRONTEND_SERVICE_ID
      });
    }

    return results;
  }
};
