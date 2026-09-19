import { getFastApiMetadata, getPythonEnvironment } from "../detection/detectedProject";
import type { BackendStartAdapter } from "./backendFrameworkAdapter";

/**
 * Starts FastAPI via `<python> -m uvicorn <appImport> --host <host> --port
 * <port>` - a structured argv array like every other spawn in this codebase
 * (`shell: false`, no command-string composition). `appImport` comes only
 * from `getFastApiMetadata()` (spec §37: "Der erkannte appImport darf nur
 * aus einer kontrollierten, validierten Detection-Regel entstehen") -
 * `adapters/fastApiBackendDetection.ts`'s own evidence rule, never
 * arbitrary file text. No install, no reload flag, no production server
 * (gunicorn/workers) - this is the minimal architecture-proof start
 * descriptor, not a FastAPI feature set (spec §36).
 *
 * Resolves its own `PythonEnvironment` from `service` via
 * `getPythonEnvironment()` (EXPRESS-1B: `buildStartCommand` no longer
 * receives one as a separate parameter - see `BackendStartAdapter`'s own
 * doc comment); the bare `"python"` fallback below is structurally
 * unreachable through `commands/startPlans.ts#planBackendStart`, which
 * already confirms a `PythonEnvironment` exists before ever calling this
 * adapter.
 */
export const fastApiBackendAdapter: BackendStartAdapter = {
  id: "fastapi",

  buildStartCommand(service, host, port) {
    const appImport = getFastApiMetadata(service)?.appImport ?? "main:app";
    const python = getPythonEnvironment(service);
    return {
      executable: python?.executablePath ?? "python",
      args: ["-m", "uvicorn", appImport, "--host", host, "--port", String(port)],
      cwd: service.rootPath,
      expectedPort: port
    };
  }
};
