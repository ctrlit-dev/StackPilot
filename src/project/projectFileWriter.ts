/**
 * Mutating filesystem operations for project scaffolding, deliberately kept
 * separate from detection's read-only FileSystemProbe (spec §61: detection
 * must not mutate the workspace) - this interface exists specifically for
 * the one part of the extension that is allowed to create files: the New
 * Project wizard.
 */
export interface ProjectFileWriter {
  pathExists(targetPath: string): Promise<boolean>;
  /** True also when the directory does not exist at all (spec §30: "ensure destination does not exist, or ensure it is empty"). */
  isDirectoryEmpty(directoryPath: string): Promise<boolean>;
  createDirectory(directoryPath: string): Promise<void>;
  /** Never overwrites an existing file unless `overwrite` is set (spec §27/§33: never clobber an existing .gitignore or settings.json). */
  writeTextFile(filePath: string, content: string, options?: { readonly overwrite?: boolean }): Promise<{ readonly written: boolean }>;
  /** Recursive, permanent delete - used only for cleanup of paths this extension itself just created (spec §30), never for pre-existing files. */
  removePath(targetPath: string): Promise<void>;
}
