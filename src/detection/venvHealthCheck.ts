import type { FileSystemProbe } from "./fileSystem";
import { getVirtualEnvironmentInterpreterPaths } from "./pythonDetector";

export type VenvHealth =
  | { readonly kind: "missing" }
  | { readonly kind: "healthy"; readonly interpreterPath: string }
  | { readonly kind: "broken" };

/**
 * Distinguishes "no venv here" from "a partially created/broken venv" (spec
 * §10: "Detect partially created/broken environments"), which plain Python
 * detection cannot do - detectPythonEnvironment only ever reports candidates
 * whose interpreter file actually exists, so a venv directory with a missing
 * interpreter is otherwise invisible.
 */
export async function checkVenvHealth(fs: FileSystemProbe, venvPath: string): Promise<VenvHealth> {
  if (!(await fs.directoryExists(venvPath))) {
    return { kind: "missing" };
  }

  for (const interpreterPath of getVirtualEnvironmentInterpreterPaths(venvPath)) {
    if (await fs.fileExists(interpreterPath)) {
      return { kind: "healthy", interpreterPath };
    }
  }

  return { kind: "broken" };
}
