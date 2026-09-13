import * as path from "node:path";

export function normalizeRelativePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/+$/, "");
}

export function resolveWorkspacePath(workspaceRootPath: string, configuredPath: string): string {
  if (isAbsolutePath(configuredPath)) {
    return path.normalize(configuredPath);
  }

  const normalized = normalizeRelativePath(configuredPath);
  if (normalized.length === 0) {
    return workspaceRootPath;
  }

  return path.resolve(workspaceRootPath, ...normalized.split("/"));
}

export function isPathInsideOrEqual(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** Picks the highest-`score` candidate detection produces, or undefined when none were found. */
export function selectHighestConfidenceCandidate<T extends { readonly score: number }>(candidates: readonly T[]): T | undefined {
  if (candidates.length === 0) {
    return undefined;
  }

  return [...candidates].sort((a, b) => b.score - a.score)[0];
}

function isAbsolutePath(value: string): boolean {
  return path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}
