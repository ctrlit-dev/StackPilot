import type { BackendFrameworkAdapter } from "../adapters/backendFrameworkAdapter";
import type { BackendProject } from "../detection/backendDetector";
import type { DetectedProject } from "../detection/projectDetector";
import type { PythonEnvironment } from "../detection/pythonDetector";
import type { InteractiveShellInvocation } from "../execution/interactiveTerminalManager";
import type { OneShotCommandOptions } from "../execution/oneShotCommand";
import { buildPipInstallCommand } from "../execution/pythonDependencyCommand";

type BackendPrerequisites = { readonly backend: BackendProject; readonly python: PythonEnvironment } | { readonly kind: "no-backend" } | { readonly kind: "no-python" };

function requireBackendAndPython(detectedProject: DetectedProject | undefined): BackendPrerequisites {
  const backend = detectedProject?.backend.selected;
  if (backend === undefined) {
    return { kind: "no-backend" };
  }
  const python = detectedProject?.python.selected;
  if (python === undefined) {
    return { kind: "no-python" };
  }
  return { backend, python };
}

export type BackendOperationPlan =
  | { readonly kind: "ready"; readonly command: OneShotCommandOptions }
  | { readonly kind: "no-backend" }
  | { readonly kind: "no-python" };

function planManagePyOperation(
  detectedProject: DetectedProject | undefined,
  build: (python: PythonEnvironment, backend: BackendProject) => OneShotCommandOptions
): BackendOperationPlan {
  const prerequisites = requireBackendAndPython(detectedProject);
  if ("kind" in prerequisites) {
    return prerequisites;
  }
  return { kind: "ready", command: build(prerequisites.python, prerequisites.backend) };
}

export function planMakeMigrations(detectedProject: DetectedProject | undefined, backendAdapter: BackendFrameworkAdapter): BackendOperationPlan {
  return planManagePyOperation(detectedProject, (python, backend) => backendAdapter.buildMakeMigrationsCommand(python, backend));
}

export function planMigrate(detectedProject: DetectedProject | undefined, backendAdapter: BackendFrameworkAdapter): BackendOperationPlan {
  return planManagePyOperation(detectedProject, (python, backend) => backendAdapter.buildMigrateCommand(python, backend));
}

export function planShowMigrations(detectedProject: DetectedProject | undefined, backendAdapter: BackendFrameworkAdapter): BackendOperationPlan {
  return planManagePyOperation(detectedProject, (python, backend) => backendAdapter.buildShowMigrationsCommand(python, backend));
}

export function planDjangoTest(detectedProject: DetectedProject | undefined, backendAdapter: BackendFrameworkAdapter): BackendOperationPlan {
  return planManagePyOperation(detectedProject, (python, backend) => backendAdapter.buildTestCommand(python, backend));
}

/**
 * The escape hatch for anything without a dedicated menu entry (e.g.
 * `makemessages -l de`, `dumpdata myapp.Model`) - runs whatever args the
 * user typed via the exact same <python> manage.py <args> shape as every
 * other operation above.
 */
export function planManagementCommand(
  detectedProject: DetectedProject | undefined,
  args: readonly string[],
  backendAdapter: BackendFrameworkAdapter
): BackendOperationPlan {
  return planManagePyOperation(detectedProject, (python, backend) => backendAdapter.buildManagementCommand(python, backend, args));
}

export type CreateAppPlan =
  | { readonly kind: "ready"; readonly command: OneShotCommandOptions }
  | { readonly kind: "no-backend" }
  | { readonly kind: "no-python" }
  | { readonly kind: "invalid-name"; readonly reason: string };

export function planCreateApp(detectedProject: DetectedProject | undefined, appName: string, backendAdapter: BackendFrameworkAdapter): CreateAppPlan {
  const validation = backendAdapter.validateAppName(appName);
  if (!validation.valid) {
    return { kind: "invalid-name", reason: validation.reason };
  }
  return planManagePyOperation(detectedProject, (python, backend) => backendAdapter.buildStartAppCommand(python, backend, appName));
}

export type InteractiveBackendPlan =
  | { readonly kind: "ready"; readonly invocation: InteractiveShellInvocation }
  | { readonly kind: "no-backend" }
  | { readonly kind: "no-python" };

export function planDjangoShell(detectedProject: DetectedProject | undefined, backendAdapter: BackendFrameworkAdapter): InteractiveBackendPlan {
  const prerequisites = requireBackendAndPython(detectedProject);
  if ("kind" in prerequisites) {
    return prerequisites;
  }
  return { kind: "ready", invocation: backendAdapter.buildShellInvocation(prerequisites.python, prerequisites.backend) };
}

export function planDbShell(detectedProject: DetectedProject | undefined, backendAdapter: BackendFrameworkAdapter): InteractiveBackendPlan {
  const prerequisites = requireBackendAndPython(detectedProject);
  if ("kind" in prerequisites) {
    return prerequisites;
  }
  return { kind: "ready", invocation: backendAdapter.buildDatabaseShellInvocation(prerequisites.python, prerequisites.backend) };
}

export function planCreateSuperuser(detectedProject: DetectedProject | undefined, backendAdapter: BackendFrameworkAdapter): InteractiveBackendPlan {
  const prerequisites = requireBackendAndPython(detectedProject);
  if ("kind" in prerequisites) {
    return prerequisites;
  }
  return { kind: "ready", invocation: backendAdapter.buildCreateSuperuserInvocation(prerequisites.python, prerequisites.backend) };
}

const REQUIREMENTS_CANDIDATES = ["requirements.txt", "requirements/dev.txt"] as const;
const OTHER_DEPENDENCY_MANAGER_EVIDENCE = ["pyproject.toml", "uv.lock", "poetry.lock", "Pipfile"] as const;

export type InstallPythonDependenciesPlan =
  | { readonly kind: "ready"; readonly command: OneShotCommandOptions }
  | { readonly kind: "no-backend" }
  | { readonly kind: "no-python" }
  | { readonly kind: "no-requirements-file" }
  | { readonly kind: "unsupported-dependency-manager"; readonly detected: string };

/**
 * Only implements the one concrete command the spec gives (`pip install -r
 * requirements.txt`, §23). If the project clearly uses another environment
 * manager (pyproject.toml/uv.lock/poetry.lock/Pipfile), this deliberately
 * refuses rather than guessing an equivalent `poetry install`/`uv sync`
 * command that was never specified ("if the project clearly uses one
 * environment manager, respect it" - respecting it here means not
 * overriding it with an assumed pip command). Not part of the Django
 * framework adapter: installing dependencies via pip is a Python/venv
 * concern, not a manage.py operation.
 */
export function planInstallPythonDependencies(detectedProject: DetectedProject | undefined): InstallPythonDependenciesPlan {
  const prerequisites = requireBackendAndPython(detectedProject);
  if ("kind" in prerequisites) {
    return prerequisites;
  }

  const requirementsFile = REQUIREMENTS_CANDIDATES.find((candidate) => prerequisites.backend.evidence.includes(candidate));
  if (requirementsFile !== undefined) {
    return { kind: "ready", command: buildPipInstallCommand(prerequisites.python, prerequisites.backend, requirementsFile) };
  }

  const otherManagerEvidence = OTHER_DEPENDENCY_MANAGER_EVIDENCE.find((candidate) => prerequisites.backend.evidence.includes(candidate));
  if (otherManagerEvidence !== undefined) {
    return { kind: "unsupported-dependency-manager", detected: otherManagerEvidence };
  }

  return { kind: "no-requirements-file" };
}
