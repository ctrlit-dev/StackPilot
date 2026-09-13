import type { BackendProject } from "../detection/backendDetector";
import type { PythonEnvironment } from "../detection/pythonDetector";
import type { StartProcessOptions } from "./processManager";

/**
 * Builds the argv for Django's dev server (spec §13):
 * `<detected-python> <manage.py> runserver <host>:<port>`.
 * Never binds to 0.0.0.0 unless the caller explicitly configured that host.
 */
export function buildDjangoRunServerCommand(
  python: PythonEnvironment,
  backend: BackendProject,
  host: string,
  port: number
): StartProcessOptions {
  return {
    executable: python.executablePath,
    args: [backend.managePyPath, "runserver", `${host}:${port}`],
    cwd: backend.rootPath,
    expectedPort: port
  };
}
