import * as path from "node:path";

import type { BackendFrameworkDetection } from "../adapters/backendFrameworkDetection";
import type { StackPilotConfiguration } from "../config/configurationModel";
import { selectHighestConfidenceCandidate } from "../utils/paths";
import type { FileSystemProbe } from "./fileSystem";

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

const BACKEND_EVIDENCE_FILES = ["pyproject.toml", "requirements.txt", "Pipfile", "poetry.lock", "uv.lock"] as const;

/**
 * Orchestrates backend detection generically: asks the injected
 * `BackendFrameworkDetection` where this framework's entry point candidates
 * are (spec §47: bounded, known-layout lookup, not a general recursive
 * scan - see `adapters/djangoBackendDetection.ts`), then scores each
 * candidate using framework-neutral evidence (do common Python packaging
 * files exist nearby?) and picks the strongest one. This function has no
 * knowledge of "manage.py" or any other framework-specific marker - see
 * docs/ARCHITECTURE.md.
 */
export async function detectBackendProject(
  fs: FileSystemProbe,
  workspaceRootPath: string,
  configuration: StackPilotConfiguration,
  backendFrameworkDetection: BackendFrameworkDetection
): Promise<BackendDetectionResult> {
  const frameworkDetection = await backendFrameworkDetection.detect(fs, workspaceRootPath, configuration.backendManagePy);
  const candidates: BackendProject[] = [];

  for (const entryPointCandidate of frameworkDetection.candidates) {
    const evidence = await collectBackendEvidence(fs, entryPointCandidate.rootPath);
    candidates.push({
      rootPath: entryPointCandidate.rootPath,
      managePyPath: entryPointCandidate.frameworkEntryPath,
      evidence: [entryPointCandidate.evidence, ...evidence],
      score: calculateBackendScore(workspaceRootPath, entryPointCandidate.rootPath, evidence.length)
    });
  }

  return {
    selected: selectHighestConfidenceCandidate(candidates),
    candidates,
    diagnostics: frameworkDetection.diagnostics
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
