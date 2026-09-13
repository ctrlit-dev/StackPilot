import * as path from "node:path";
import { checkCandidatePath } from "../detection/fileSystem";
import { resolveWorkspacePath, uniqueStrings } from "../utils/paths";
import type { BackendFrameworkDetection, BackendFrameworkDetectionResult, BackendFrameworkEntryPointCandidate } from "./backendFrameworkDetection";

/**
 * Bounded, known-layout candidates (spec §47), the same approach
 * `frontendDetector.ts`'s own directory list already uses - not a general
 * recursive scan. Moved verbatim from the pre-2B.4 `backendDetector.ts`,
 * behavior byte-for-byte unchanged.
 */
const MANAGE_PY_CANDIDATES = ["manage.py", "backend/manage.py", "server/manage.py", "api/manage.py"] as const;

export const djangoBackendDetection: BackendFrameworkDetection = {
  frameworkId: "django",

  async detect(fs, workspaceRootPath, configuredEntryPointOverride) {
    const diagnostics: string[] = [];
    const candidates: BackendFrameworkEntryPointCandidate[] = [];
    const managePyCandidates = uniqueStrings([configuredEntryPointOverride, ...MANAGE_PY_CANDIDATES]);

    for (const managePyCandidate of managePyCandidates) {
      const managePyPath = resolveWorkspacePath(workspaceRootPath, managePyCandidate);
      const check = await checkCandidatePath(fs, workspaceRootPath, managePyPath, "manage.py candidate");
      if (check.kind === "not-found") {
        continue;
      }
      if (check.kind === "unsafe") {
        diagnostics.push(check.diagnostic);
        continue;
      }

      candidates.push({
        rootPath: path.dirname(managePyPath),
        frameworkEntryPath: managePyPath,
        evidence: "manage.py"
      });
    }

    const result: BackendFrameworkDetectionResult = { candidates, diagnostics };
    return result;
  }
};
