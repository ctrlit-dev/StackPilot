import type { BackendFrameworkAdapter } from "./backendFrameworkAdapter";

/**
 * Builds the argv for Django's dev server:
 * `<detected-python> <manage.py> runserver <host>:<port>`. Never binds to
 * 0.0.0.0 unless the caller explicitly configured that host. This is the one
 * place Django's start-command shape is known; everything upstream
 * (`startPlans.ts`, `backendCommands.ts`) works only in terms of
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
  }
};
