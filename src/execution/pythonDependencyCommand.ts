import type { BackendProject } from "../detection/backendDetector";
import type { PythonEnvironment } from "../detection/pythonDetector";
import type { OneShotCommandOptions } from "./oneShotCommand";

/**
 * `<python> -m pip install -r requirements.txt` (spec §23) - the only
 * concrete command the spec gives. Never a bare global `pip`, always the
 * detected project interpreter's own `-m pip`. requirementsFileRelativePath
 * is resolved against `cwd` (the backend root) by the process itself.
 */
export function buildPipInstallCommand(
  python: PythonEnvironment,
  backend: BackendProject,
  requirementsFileRelativePath: string
): OneShotCommandOptions {
  return {
    executable: python.executablePath,
    args: ["-m", "pip", "install", "-r", requirementsFileRelativePath],
    cwd: backend.rootPath
  };
}
