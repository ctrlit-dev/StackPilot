import * as path from "node:path";

import type { FrontendFrameworkDetection } from "../adapters/frontendFrameworkDetection";
import type { StackPilotConfiguration } from "../config/configurationModel";
import { resolveWorkspacePath, selectHighestConfidenceCandidate, uniqueStrings } from "../utils/paths";
import { checkCandidatePath, type FileSystemProbe } from "./fileSystem";
import { detectPackageManager, type PackageManagerDetection } from "./packageManagerDetector";

export interface FrontendProject {
  readonly rootPath: string;
  readonly packageJsonPath: string;
  readonly viteConfigPath?: string;
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
 * function has no knowledge of Vite or any other framework's own config
 * file. The injected `FrontendFrameworkDetection` is only ever asked to add
 * evidence to an already-qualified candidate (see
 * `adapters/viteFrontendDetection.ts`); its absence never disqualifies one -
 * see docs/ARCHITECTURE.md.
 */
export async function detectFrontendProject(
  fs: FileSystemProbe,
  workspaceRootPath: string,
  configuration: StackPilotConfiguration,
  frontendFrameworkDetection: FrontendFrameworkDetection
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

    const viteConfigPath = await frontendFrameworkDetection.findFrameworkConfigPath(fs, rootPath);
    const evidence = ["package.json"];
    if (viteConfigPath !== undefined) {
      evidence.push(path.basename(viteConfigPath));
    }

    const hasPreferredDevScript = Object.hasOwn(packageJson.scripts, configuration.frontendDevScript);
    const score = calculateFrontendScore(candidateDirectory, viteConfigPath, hasPreferredDevScript);
    candidates.push({
      rootPath,
      packageJsonPath,
      viteConfigPath,
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

function calculateFrontendScore(candidateDirectory: string, viteConfigPath: string | undefined, hasPreferredDevScript: boolean): number {
  let score = candidateDirectory === "." ? 20 : 40;
  if (viteConfigPath !== undefined) {
    score += 50;
  }
  if (hasPreferredDevScript) {
    score += 10;
  }
  return score;
}

type PackageJsonReadResult =
  | { readonly kind: "valid"; readonly scripts: Readonly<Record<string, string>> }
  | { readonly kind: "invalid"; readonly reason: string };

async function readPackageJson(fs: FileSystemProbe, packageJsonPath: string): Promise<PackageJsonReadResult> {
  try {
    const parsed = JSON.parse(await fs.readTextFile(packageJsonPath)) as unknown;
    return {
      kind: "valid",
      scripts: readScripts(parsed)
    };
  } catch (error: unknown) {
    return {
      kind: "invalid",
      reason: error instanceof Error ? error.message : "Unknown parse error"
    };
  }
}

function readScripts(packageJson: unknown): Readonly<Record<string, string>> {
  if (typeof packageJson !== "object" || packageJson === null || !("scripts" in packageJson)) {
    return {};
  }

  const scripts = packageJson.scripts;
  if (typeof scripts !== "object" || scripts === null) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(scripts).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}
