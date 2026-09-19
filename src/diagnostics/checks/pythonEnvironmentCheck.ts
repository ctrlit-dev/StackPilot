import { getBackendService, getPythonEnvironment } from "../../detection/detectedProject";
import { BACKEND_SERVICE_ID } from "../../serviceId";
import type { DiagnosticResult } from "../diagnostic";
import type { DiagnosticCheck } from "../diagnosticCheck";

/**
 * Reports a missing Python interpreter, but only for a project that actually
 * has a Python-relevant context - a detected backend service (Django or
 * FastAPI). A pure Node/Vite project has no backend service at all, so it is
 * never told about a (nonexistent) Python interpreter: `getBackendService`
 * returning undefined short-circuits before any interpreter check runs.
 *
 * Severity is "error", not "warning": without an interpreter, every
 * backend-related operation (start, migrate, install dependencies, shell)
 * is blocked outright, not just one specific capability - the same
 * "nothing can work" bar the Dashboard's own Help/FAQ text already treats
 * this as ("No Python interpreter found" is its first Common Issue).
 */
export const pythonEnvironmentCheck: DiagnosticCheck = {
  run(context) {
    const backend = getBackendService(context.detectedProject);
    if (backend === undefined) {
      return Promise.resolve([]);
    }

    // EXPRESS-1C: this check is about a *Python* backend's interpreter, not
    // "any backend that happens to have no PythonEnvironment resolved" - a
    // Node-runtime backend (Express) never has one, by design, and that is
    // not a missing-interpreter problem. Positive check: only a backend
    // whose own runtime is actually Python is in scope here.
    if (backend.runtime?.kind !== "python") {
      return Promise.resolve([]);
    }

    if (getPythonEnvironment(backend) !== undefined) {
      return Promise.resolve([]);
    }

    const result: DiagnosticResult = {
      code: "python.interpreter.missing",
      severity: "error",
      message: "No Python interpreter was found for the detected backend. Set stackPilot.python.interpreter, or create a virtual environment.",
      serviceId: BACKEND_SERVICE_ID
    };
    return Promise.resolve([result]);
  }
};
