import type { ProjectFileWriter } from "./projectFileWriter";

export type DestinationCheckResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Spec §30: "Never create a new project destructively inside a non-empty
 * directory... ensure destination does not exist, or ensure it is empty."
 * No "overwrite everything" option is offered - callers get a clear reason
 * and must pick a different destination or cancel.
 */
export async function checkDestination(writer: ProjectFileWriter, projectRoot: string): Promise<DestinationCheckResult> {
  const exists = await writer.pathExists(projectRoot);
  if (!exists) {
    return { ok: true };
  }

  const empty = await writer.isDirectoryEmpty(projectRoot);
  if (!empty) {
    return { ok: false, reason: "The folder already contains files." };
  }

  return { ok: true };
}

/**
 * Removes exactly the paths a failed/cancelled scaffold run created (spec
 * §30: "offer safe cleanup only for files/directories created by this
 * failed operation... Never delete pre-existing files during rollback").
 * Callers are responsible for obtaining explicit user confirmation first.
 */
export async function cleanupCreatedPaths(writer: ProjectFileWriter, createdPaths: readonly string[]): Promise<void> {
  for (const createdPath of createdPaths) {
    await writer.removePath(createdPath);
  }
}
