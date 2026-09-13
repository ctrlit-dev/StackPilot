import {
  getBackendService,
  getDjangoMetadata,
  getFastApiMetadata,
  getPythonEnvironment,
  type DetectedService
} from "../../detection/detectedProject";
import { isPythonPackageInstalled } from "../../detection/pythonPackageCheck";
import { COMMAND_INSTALL_PYTHON_DEPENDENCIES } from "../../constants";
import { BACKEND_SERVICE_ID } from "../../serviceId";
import type { DiagnosticResult } from "../diagnostic";
import type { DiagnosticCheck, DiagnosticContext } from "../diagnosticCheck";

const REQUIREMENTS_EVIDENCE = ["requirements.txt", "requirements/dev.txt"] as const;

/**
 * Framework-specific, never generic (DIAGNOSTICS-1A review, Correction A):
 * there is no "python.dependencies.missing" here, only the one concrete,
 * named top-level package a detected backend's own framework metadata
 * already proves is expected - reusing `isPythonPackageInstalled`, the exact
 * same site-packages probe `commands/initializationAnalysis.ts` already uses
 * for the same question at project-bootstrap time. No new dependency-
 * detection logic is introduced.
 *
 * Only runs against a `"venv"`-sourced Python environment with a real
 * `environmentPath` - a PATH- or manually configured interpreter has no
 * `site-packages` layout this probe understands, so checking it would not be
 * a reliable signal (same precondition `initializationAnalysis.ts` applies).
 */
export const frameworkDependencyCheck: DiagnosticCheck = {
  run(context) {
    const backend = getBackendService(context.detectedProject);
    if (backend === undefined) {
      return Promise.resolve([]);
    }

    const python = getPythonEnvironment(backend);
    if (python === undefined || python.source !== "venv" || python.environmentPath === undefined) {
      return Promise.resolve([]);
    }

    if (getDjangoMetadata(backend) !== undefined) {
      return checkFrameworkPackage(context, backend, python.environmentPath, {
        packageName: "django",
        code: "django.dependency.missing",
        message: "Django is not installed in the detected virtual environment.",
        // COMMAND_INSTALL_PYTHON_DEPENDENCIES resolves the backend through
        // getDjangoBackendProject() (backendOperationPlans.ts), so it is a
        // valid action here - this backend is confirmed Django.
        installCommandId: COMMAND_INSTALL_PYTHON_DEPENDENCIES
      });
    }

    if (getFastApiMetadata(backend) !== undefined) {
      return checkFrameworkPackage(context, backend, python.environmentPath, {
        packageName: "fastapi",
        code: "fastapi.dependency.missing",
        message: "FastAPI is not installed in the detected virtual environment.",
        // No action: COMMAND_INSTALL_PYTHON_DEPENDENCIES's plan
        // (backendOperationPlans.ts's requireBackendAndPython) resolves the
        // backend via getDjangoBackendProject(), which returns undefined for
        // a FastAPI service - running it here would fail with "no Django
        // project was detected", which is actively wrong. No other existing
        // command installs Python dependencies, so this result carries no
        // action in 1B rather than a misleading one.
        installCommandId: undefined
      });
    }

    return Promise.resolve([]);
  }
};

interface FrameworkPackageSpec {
  readonly packageName: string;
  readonly code: string;
  readonly message: string;
  readonly installCommandId?: string;
}

async function checkFrameworkPackage(
  context: DiagnosticContext,
  backend: DetectedService,
  environmentPath: string,
  spec: FrameworkPackageSpec
): Promise<readonly DiagnosticResult[]> {
  const installed = await isPythonPackageInstalled(context.fileSystem, environmentPath, spec.packageName);
  if (installed) {
    return [];
  }

  const installCommandId = spec.installCommandId;
  const hasRequirementsFile = REQUIREMENTS_EVIDENCE.some((file) => backend.evidence.includes(file));
  const action = installCommandId !== undefined && hasRequirementsFile ? { label: "Install Python Dependencies", commandId: installCommandId } : undefined;

  return [{ code: spec.code, severity: "warning", message: spec.message, serviceId: BACKEND_SERVICE_ID, action }];
}
