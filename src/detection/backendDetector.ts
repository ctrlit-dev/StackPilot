import * as path from "node:path";

import type { StackPilotConfiguration } from "../config/configurationModel";
import { resolveWorkspacePath, selectHighestConfidenceCandidate, uniqueStrings } from "../utils/paths";
import { checkCandidatePath, type FileSystemProbe } from "./fileSystem";

export interface BackendProject {
  readonly rootPath: string;
  readonly managePyPath: string;
  readonly score: number;
  readonly evidence: readonly string[];
}

export interface BackendDetectionResult {
  readonly selected?: BackendProject;
  readonly candidates: readonly BackendProject[];
  readonly diagnostics: readonly string[];
}

const MANAGE_PY_CANDIDATES = ["manage.py", "backend/manage.py", "server/manage.py", "api/manage.py"] as const;
const BACKEND_EVIDENCE_FILES = ["pyproject.toml", "requirements.txt", "Pipfile", "poetry.lock", "uv.lock"] as const;

export async function detectBackendProject(
  fs: FileSystemProbe,
  workspaceRootPath: string,
  configuration: StackPilotConfiguration
): Promise<BackendDetectionResult> {
  const diagnostics: string[] = [];
  const candidates: BackendProject[] = [];
  const managePyCandidates = uniqueStrings([configuration.backendManagePy, ...MANAGE_PY_CANDIDATES]);

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

    const rootPath = path.dirname(managePyPath);
    const evidence = await collectBackendEvidence(fs, rootPath);
    candidates.push({
      rootPath,
      managePyPath,
      evidence: ["manage.py", ...evidence],
      score: calculateBackendScore(workspaceRootPath, rootPath, evidence.length)
    });
  }

  return {
    selected: selectHighestConfidenceCandidate(candidates),
    candidates,
    diagnostics
  };
}

function calculateBackendScore(workspaceRootPath: string, backendRootPath: string, evidenceCount: number): number {
  const isWorkspaceRoot = path.resolve(workspaceRootPath) === path.resolve(backendRootPath);
  return (isWorkspaceRoot ? 60 : 80) + evidenceCount * 5;
}

async function collectBackendEvidence(fs: FileSystemProbe, backendRootPath: string): Promise<string[]> {
  const evidence: string[] = [];
  for (const fileName of BACKEND_EVIDENCE_FILES) {
    if (await fs.fileExists(path.join(backendRootPath, fileName))) {
      evidence.push(fileName);
    }
  }

  if (await fs.fileExists(path.join(backendRootPath, "requirements", "dev.txt"))) {
    evidence.push("requirements/dev.txt");
  }

  return evidence;
}
