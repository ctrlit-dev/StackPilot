import { getFastApiMetadata } from "../detection/detectedProject";
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
 */
export const fastApiBackendAdapter: BackendStartAdapter = {
  id: "fastapi",

  buildStartCommand(python, service, host, port) {
    const appImport = getFastApiMetadata(service)?.appImport ?? "main:app";
    return {
      executable: python.executablePath,
      args: ["-m", "uvicorn", appImport, "--host", host, "--port", String(port)],
      cwd: service.rootPath,
      expectedPort: port
    };
  }
};
