import type { BackendProject } from "../detection/backendDetector";
import type { PythonEnvironment } from "../detection/pythonDetector";
import type { OneShotCommandOptions } from "./oneShotCommand";

/**
 * `<python> <manage.py> <args...>`, run from the backend root - the shared
 * shape behind every manage.py subcommand in this file (spec §17/§21/§22:
 * "Use the detected interpreter and correct manage.py").
 */
export function buildManagePyCommand(
  python: PythonEnvironment,
  backend: BackendProject,
  args: readonly string[]
): OneShotCommandOptions {
  return {
    executable: python.executablePath,
    args: [backend.managePyPath, ...args],
    cwd: backend.rootPath
  };
}

export function buildMakeMigrationsCommand(python: PythonEnvironment, backend: BackendProject): OneShotCommandOptions {
  return buildManagePyCommand(python, backend, ["makemigrations"]);
}

export function buildMigrateCommand(python: PythonEnvironment, backend: BackendProject): OneShotCommandOptions {
  return buildManagePyCommand(python, backend, ["migrate"]);
}

export function buildShowMigrationsCommand(python: PythonEnvironment, backend: BackendProject): OneShotCommandOptions {
  return buildManagePyCommand(python, backend, ["showmigrations"]);
}

export function buildDjangoTestCommand(python: PythonEnvironment, backend: BackendProject): OneShotCommandOptions {
  return buildManagePyCommand(python, backend, ["test"]);
}

export function buildCreateAppCommand(python: PythonEnvironment, backend: BackendProject, appName: string): OneShotCommandOptions {
  return buildManagePyCommand(python, backend, ["startapp", appName]);
}

/**
 * Shell/createsuperuser are genuinely interactive (REPL input, secret
 * password entry) and must run in a real, visible terminal the user can type
 * into (spec §19/§20: "Do not use a hidden process for interactive
 * workflows"; never pass a password as a command argument). This returns the
 * shellPath/shellArgs shape for vscode.window.createTerminal, not something
 * spawned and captured like the one-shot commands above.
 */
export interface InteractiveShellInvocation {
  readonly shellPath: string;
  readonly shellArgs: readonly string[];
  readonly cwd: string;
}

export function buildDjangoShellInvocation(python: PythonEnvironment, backend: BackendProject): InteractiveShellInvocation {
  return { shellPath: python.executablePath, shellArgs: [backend.managePyPath, "shell"], cwd: backend.rootPath };
}

export function buildDbShellInvocation(python: PythonEnvironment, backend: BackendProject): InteractiveShellInvocation {
  return { shellPath: python.executablePath, shellArgs: [backend.managePyPath, "dbshell"], cwd: backend.rootPath };
}

export function buildCreateSuperuserInvocation(python: PythonEnvironment, backend: BackendProject): InteractiveShellInvocation {
  return { shellPath: python.executablePath, shellArgs: [backend.managePyPath, "createsuperuser"], cwd: backend.rootPath };
}
