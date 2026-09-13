import type { BackendProject } from "../detection/backendDetector";
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
    args: [backend.managePyPath, ...args],
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

  buildStartCommand(python, backend, host, port) {
    return {
      executable: python.executablePath,
      args: [backend.managePyPath, "runserver", `${host}:${port}`],
      cwd: backend.rootPath,
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
    return { shellPath: python.executablePath, shellArgs: [backend.managePyPath, "shell"], cwd: backend.rootPath };
  },

  buildDatabaseShellInvocation(python, backend) {
    return { shellPath: python.executablePath, shellArgs: [backend.managePyPath, "dbshell"], cwd: backend.rootPath };
  },

  buildCreateSuperuserInvocation(python, backend) {
    return { shellPath: python.executablePath, shellArgs: [backend.managePyPath, "createsuperuser"], cwd: backend.rootPath };
  }
};
