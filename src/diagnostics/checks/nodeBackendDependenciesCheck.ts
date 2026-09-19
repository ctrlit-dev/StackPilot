import * as path from "node:path";
import { getBackendService, getNodeRuntime } from "../../detection/detectedProject";
import { BACKEND_SERVICE_ID } from "../../serviceId";
import type { DiagnosticResult } from "../diagnostic";
import type { DiagnosticCheck } from "../diagnosticCheck";

/**
 * The backend-side sibling of `nodeDependenciesCheck.ts` (EXPRESS-1C) - a
 * small, separate file rather than a generalization of the existing
 * frontend check, matching this codebase's established one-file-per-
 * diagnostic-concern pattern (`pythonEnvironmentCheck.ts`/
 * `frameworkDependencyCheck.ts`/`nodeDependenciesCheck.ts`/
 * `djangoMigrationsCheck.ts` are already four separate small files, not one
 * generalized check engine).
 *
 * Unlike the frontend check, this one must explicitly gate on
 * `getNodeRuntime(backend) !== undefined` before doing anything else - a
 * frontend service is always Node (Vite is the only frontend framework
 * today), but a backend service can be Python (Django/FastAPI) or Node
 * (Express), so "a backend was detected" alone does not imply it has a
 * `node_modules` directory worth checking. `node_modules` at
 * `backend.rootPath` is checked at the backend service's own root, kept
 * fully independent of the frontend check's own root - an Express backend
 * with a nested Vite frontend must never have the two conflated (see
 * docs/EXPRESS_1C_CODE_TRUTH_AND_IMPLEMENTATION_PLAN.md §8/§12).
 *
 * Deliberately carries NO action on `node.dependencies.missing` - EXPRESS-1C
 * does not implement an "Install Backend Dependencies" command (see the plan
 * doc's own §8), so attaching one here would point at a command id that does
 * not exist. The same "diagnostic present, action deliberately omitted"
 * shape `frameworkDependencyCheck.ts` already uses for FastAPI's own
 * `fastapi.dependency.missing` today. The existing frontend
 * `nodeDependenciesCheck.ts` is untouched and keeps its own action.
 */
export const nodeBackendDependenciesCheck: DiagnosticCheck = {
  async run(context) {
    const backend = getBackendService(context.detectedProject);
    const runtime = getNodeRuntime(backend);
    if (backend === undefined || runtime === undefined) {
      return [];
    }

    const results: DiagnosticResult[] = [];
    const packageManager = runtime.packageManager;

    const nodeModulesPresent = await context.fileSystem.directoryExists(path.join(backend.rootPath, "node_modules"));
    if (!nodeModulesPresent) {
      results.push({
        code: "node.dependencies.missing",
        severity: "warning",
        message: "node_modules is missing for the detected backend.",
        serviceId: BACKEND_SERVICE_ID
      });
    }

    if (packageManager.kind === "missing") {
      results.push({
        code: "node.packageManager.blocked",
        severity: "warning",
        message: packageManager.reason,
        serviceId: BACKEND_SERVICE_ID
      });
    } else if (packageManager.kind === "ambiguous") {
      const candidateNames = packageManager.candidates.map((candidate) => candidate.manager).join(", ");
      results.push({
        code: "node.packageManager.blocked",
        severity: "warning",
        // Unlike the frontend's equivalent message, this never points at a
        // `stackPilot.backend.packageManager` setting - no such setting
        // exists (EXPRESS-1C introduces none, per the plan doc's §13).
        message: `Multiple package-manager lockfiles were found (${candidateNames}). Remove all but one lockfile to disambiguate.`,
        serviceId: BACKEND_SERVICE_ID
      });
    }

    return results;
  }
};
