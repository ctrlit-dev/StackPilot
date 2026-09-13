import type { DetectedProject } from "../detection/detectedProject";
import type { PythonEnvironment } from "../detection/pythonDetector";
import { isPathInsideOrEqual } from "../utils/paths";
import type { OneShotCommandOptions } from "./oneShotCommand";

/**
 * A Python usable to bootstrap a new venv must not itself live inside the
 * venv about to be (re)created - relevant when repairing a broken venv,
 * where the "selected" interpreter could be the very broken one. Picks the
 * first detected candidate (already priority-ordered: configured, venv,
 * PATH) that is not inside the target path. Reads the workspace-level
 * `pythonRuntime` (not a specific service's) - venv (re)creation has never
 * required a backend service to already exist.
 */
export function findBasePython(detectedProject: DetectedProject | undefined, targetVenvPath: string): PythonEnvironment | undefined {
  const candidates = detectedProject?.pythonRuntime.candidates ?? [];
  return candidates.find((candidate) => !isPathInsideOrEqual(targetVenvPath, candidate.executablePath));
}

/**
 * `<python> -m venv <path>` (spec §10) - never relies on `virtualenv` being
 * installed.
 */
export function buildCreateVenvCommand(basePython: PythonEnvironment, targetVenvPath: string, cwd: string): OneShotCommandOptions {
  return {
    executable: basePython.executablePath,
    args: ["-m", "venv", targetVenvPath],
    cwd
  };
}
