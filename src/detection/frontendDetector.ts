import * as path from "node:path";

import type { FrameworkAdapterId } from "../adapters/frameworkAdapterId";
import type { FrontendFrameworkDetection } from "../adapters/frontendFrameworkDetection";
import type { StackPilotConfiguration } from "../config/configurationModel";
import { resolveWorkspacePath, selectHighestConfidenceCandidate, uniqueStrings } from "../utils/paths";
import { checkCandidatePath, type FileSystemProbe } from "./fileSystem";
import { detectPackageManager, type PackageManagerDetection } from "./packageManagerDetector";
import { readPackageJson } from "./packageJson";

export interface FrontendProject {
  readonly rootPath: string;
  readonly packageJsonPath: string;
  readonly frameworkId?: FrameworkAdapterId;
  readonly frameworkConfigPath?: string;
  readonly scripts: Readonly<Record<string, string>>;
  readonly packageManager: PackageManagerDetection;
  readonly score: number;
  readonly evidence: readonly string[];
}

export interface FrontendDetectionResult {
  readonly selected?: FrontendProject;
  readonly candidates: readonly FrontendProject[];
  readonly diagnostics: readonly string[];
}

const FRONTEND_CANDIDATE_DIRECTORIES = ["frontend", "client", "web", "."] as const;

/**
 * Orchestrates frontend detection generically: any workspace-relative
 * directory (configured, or one of the known candidate names) with a
 * `package.json` already qualifies as a frontend project candidate - this
 * function has no knowledge of Vite, Next.js, or any other framework's own
 * config file. The injected `FrontendFrameworkDetection`s are only ever
 * asked to add evidence to an already-qualified candidate (see
 * `adapters/viteFrontendDetection.ts`/`adapters/nextFrontendDetection.ts`);
 * none of their absence ever disqualifies one - see docs/ARCHITECTURE.md.
 *
 * NEXTJS-1B: plural, not a single injected detection - StackPilot's first
 * second frontend framework. Every registered detection is tried, in
 * order, against the SAME already-qualified candidate root (see
 * `matchFrontendFramework` below) - a different generalization shape than
 * the backend's own array, where each framework detection produces its own
 * independent candidate list. Registration order is inconsequential for
 * correctness given each framework's own evidence sets are disjoint in
 * practice, and is not relied on to resolve any real ambiguity.
 */
export async function detectFrontendProject(
  fs: FileSystemProbe,
  workspaceRootPath: string,
  configuration: StackPilotConfiguration,
  frontendFrameworkDetections: readonly FrontendFrameworkDetection[]
): Promise<FrontendDetectionResult> {
  const diagnostics: string[] = [];
  const candidateDirectories = uniqueStrings([configuration.frontendDirectory, ...FRONTEND_CANDIDATE_DIRECTORIES]);
  const candidates: FrontendProject[] = [];

  for (const candidateDirectory of candidateDirectories) {
    const rootPath = resolveWorkspacePath(workspaceRootPath, candidateDirectory);
    const packageJsonPath = path.join(rootPath, "package.json");
    const check = await checkCandidatePath(fs, workspaceRootPath, packageJsonPath, "frontend candidate");
    if (check.kind === "not-found") {
      continue;
    }
    if (check.kind === "unsafe") {
      diagnostics.push(check.diagnostic);
      continue;
    }

    const packageJson = await readPackageJson(fs, packageJsonPath);
    if (packageJson.kind === "invalid") {
      diagnostics.push(`Invalid package.json at ${packageJsonPath}: ${packageJson.reason}`);
      continue;
    }

    const framework = await matchFrontendFramework(fs, rootPath, frontendFrameworkDetections);
    const evidence = ["package.json"];
    if (framework !== undefined) {
      evidence.push(path.basename(framework.configPath));
    }

    const hasPreferredDevScript = Object.hasOwn(packageJson.scripts, configuration.frontendDevScript);
    const score = calculateFrontendScore(candidateDirectory, framework?.configPath, hasPreferredDevScript);
    candidates.push({
      rootPath,
      packageJsonPath,
      frameworkId: framework?.frameworkId,
      frameworkConfigPath: framework?.configPath,
      scripts: packageJson.scripts,
      packageManager: await detectPackageManager(fs, rootPath, configuration.frontendPackageManager),
      score,
      evidence
    });
  }

  return {
    selected: selectHighestConfidenceCandidate(candidates),
    candidates,
    diagnostics
  };
}

/**
 * Tries each registered frontend framework detection, in order, against
 * this already-qualified candidate root - the first one whose own
 * `findFrameworkConfigPath()` returns evidence wins. Every candidate is
 * offered to every detection (candidacy was already decided above), so
 * this only ever needs to pick which framework's evidence, if any, applies.
 */
async function matchFrontendFramework(
  fs: FileSystemProbe,
  rootPath: string,
  frontendFrameworkDetections: readonly FrontendFrameworkDetection[]
): Promise<{ readonly frameworkId: FrameworkAdapterId; readonly configPath: string } | undefined> {
  for (const detection of frontendFrameworkDetections) {
    const configPath = await detection.findFrameworkConfigPath(fs, rootPath);
    if (configPath !== undefined) {
      return { frameworkId: detection.frameworkId, configPath };
    }
  }

  return undefined;
}

function calculateFrontendScore(candidateDirectory: string, frameworkConfigPath: string | undefined, hasPreferredDevScript: boolean): number {
  let score = candidateDirectory === "." ? 20 : 40;
  if (frameworkConfigPath !== undefined) {
    score += 50;
  }
  if (hasPreferredDevScript) {
    score += 10;
  }
  return score;
}
