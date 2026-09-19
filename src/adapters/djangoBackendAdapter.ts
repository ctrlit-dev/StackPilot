import * as path from "node:path";
import type { BackendProject } from "../detection/backendDetector";
import { getDjangoMetadata, getPythonEnvironment } from "../detection/detectedProject";
import type { PythonEnvironment } from "../detection/pythonDetector";
import type { OneShotCommandOptions } from "../execution/oneShotCommand";
import type { BackendFrameworkAdapter } from "./backendFrameworkAdapter";
import { validateDjangoAppName } from "./djangoIdentifierValidation";

/**
 * `<python> <manage.py> <args...>`, run from the backend root - the shared
 * shape behind every manage.py subcommand below (spec §17/§21/§22: "Use the
 * detected interpreter and correct manage.py").
 */
function buildManagePyCommand(python: PythonEnvironment, backend: BackendProject, args: readonly string[]): OneShotCommandOptions {
  return {
    executable: python.executablePath,
    args: [backend.frameworkEntryPath, ...args],
    cwd: backend.rootPath
  };
}

/**
 * Builds Django's start command and every Django-specific operation
 * (migrations, shell, createsuperuser, startapp, ...) this extension offers.
 * This is the one place Django's command shape is known; everything
 * upstream (`startPlans.ts`, `backendOperationPlans.ts`,
 * `migrationStatusController.ts`) works only in terms of
 * `BackendFrameworkAdapter`.
 */
export const djangoBackendAdapter: BackendFrameworkAdapter = {
  id: "django",

  /**
   * Takes the whole `DetectedService` (`BackendStartAdapter`'s contract,
   * shared with FastAPI's and Express's start adapters), not a
   * `BackendProject` directly - `managePyPath` is read via
   * `getDjangoMetadata()`, with a defensive `<rootPath>/manage.py` fallback
   * that is structurally unreachable in practice (this adapter is only ever
   * selected for a service whose `frameworkId` is `"django"`, which
   * `detection/projectDetector.ts` only ever sets alongside Django
   * metadata) but keeps this function total without a non-null assertion.
   *
   * Resolves its own `PythonEnvironment` from `service` via
   * `getPythonEnvironment()` (EXPRESS-1B: `buildStartCommand` no longer
   * receives one as a separate parameter - see `BackendStartAdapter`'s own
   * doc comment) rather than trusting an externally-passed one; the bare
   * `"python"` fallback below is, like `managePyPath`'s, structurally
   * unreachable through `commands/startPlans.ts#planBackendStart`, which
   * already confirms a `PythonEnvironment` exists before ever calling this
   * adapter.
   */
  buildStartCommand(service, host, port) {
    const managePyPath = getDjangoMetadata(service)?.managePyPath ?? path.join(service.rootPath, "manage.py");
    const python = getPythonEnvironment(service);
    return {
      executable: python?.executablePath ?? "python",
      args: [managePyPath, "runserver", `${host}:${port}`],
      cwd: service.rootPath,
      expectedPort: port
    };
  },

  buildMigrateCommand(python, backend) {
    return buildManagePyCommand(python, backend, ["migrate"]);
  },

  buildMakeMigrationsCommand(python, backend) {
    return buildManagePyCommand(python, backend, ["makemigrations"]);
  },

  buildShowMigrationsCommand(python, backend) {
    return buildManagePyCommand(python, backend, ["showmigrations"]);
  },

  buildTestCommand(python, backend) {
    return buildManagePyCommand(python, backend, ["test"]);
  },

  buildManagementCommand(python, backend, args) {
    return buildManagePyCommand(python, backend, args);
  },

  validateAppName(name) {
    return validateDjangoAppName(name);
  },

  buildStartAppCommand(python, backend, appName) {
    return buildManagePyCommand(python, backend, ["startapp", appName]);
  },

  /**
   * Shell/createsuperuser are genuinely interactive (REPL input, secret
   * password entry) and must run in a real, visible terminal the user can
   * type into (spec §19/§20: "Do not use a hidden process for interactive
   * workflows"; never pass a password as a command argument) - hence
   * `InteractiveShellInvocation`, not `OneShotCommandOptions`.
   */
  buildShellInvocation(python, backend) {
    return { shellPath: python.executablePath, shellArgs: [backend.frameworkEntryPath, "shell"], cwd: backend.rootPath };
  },

  buildDatabaseShellInvocation(python, backend) {
    return { shellPath: python.executablePath, shellArgs: [backend.frameworkEntryPath, "dbshell"], cwd: backend.rootPath };
  },

  buildCreateSuperuserInvocation(python, backend) {
    return { shellPath: python.executablePath, shellArgs: [backend.frameworkEntryPath, "createsuperuser"], cwd: backend.rootPath };
  }
};
