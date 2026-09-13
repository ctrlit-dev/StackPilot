import { isPathInsideOrEqual } from "../utils/paths";

export interface FileSystemProbe {
  fileExists(filePath: string): Promise<boolean>;
  directoryExists(directoryPath: string): Promise<boolean>;
  readTextFile(filePath: string): Promise<string>;

  /**
   * Resolves a path through any symlinks and returns its canonical form.
   * Returns undefined when the path does not exist.
   */
  realPath(targetPath: string): Promise<string | undefined>;

  /**
   * Lists the immediate child names of a directory (not recursive). Returns
   * an empty array if the directory does not exist. Used only where a
   * concrete, bounded need exists (e.g. finding the `pythonX.Y` folder name
   * under a POSIX venv's `lib/`, which cannot be predicted without listing
   * it) - not a general-purpose recursive scan (spec §47).
   */
  listDirectoryNames(directoryPath: string): Promise<string[]>;
}

/**
 * Confirms a candidate stays inside the workspace after symlinks are resolved.
 * A lexical check alone (see isPathInsideOrEqual) cannot catch a candidate that
 * is itself a symlink pointing outside the workspace.
 */
export async function isRealPathInsideWorkspace(
  fs: FileSystemProbe,
  workspaceRootPath: string,
  candidatePath: string
): Promise<boolean> {
  const workspaceRealPath = await fs.realPath(workspaceRootPath);
  const candidateRealPath = await fs.realPath(candidatePath);
  if (workspaceRealPath === undefined || candidateRealPath === undefined) {
    return false;
  }

  return isPathInsideOrEqual(workspaceRealPath, candidateRealPath);
}

export type CandidatePathCheck =
  | { readonly kind: "ok" }
  | { readonly kind: "not-found" }
  | { readonly kind: "unsafe"; readonly diagnostic: string };

/**
 * The safety/existence gate every detector candidate must pass before it is trusted:
 * lexically inside the workspace, actually exists, and - once symlinks are resolved -
 * still inside the workspace. Shared by backendDetector and frontendDetector, which
 * otherwise duplicated this exact three-step sequence with only the diagnostic wording
 * differing.
 */
export async function checkCandidatePath(
  fs: FileSystemProbe,
  workspaceRootPath: string,
  candidatePath: string,
  candidateNoun: string
): Promise<CandidatePathCheck> {
  if (!isPathInsideOrEqual(workspaceRootPath, candidatePath)) {
    return { kind: "unsafe", diagnostic: `Ignoring ${candidateNoun} outside the workspace: ${candidatePath}` };
  }

  if (!(await fs.fileExists(candidatePath))) {
    return { kind: "not-found" };
  }

  if (!(await isRealPathInsideWorkspace(fs, workspaceRootPath, candidatePath))) {
    return { kind: "unsafe", diagnostic: `Ignoring ${candidateNoun} that escapes the workspace through a symlink: ${candidatePath}` };
  }

  return { kind: "ok" };
}
