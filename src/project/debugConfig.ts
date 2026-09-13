import * as path from "node:path";

import type { StackPilotConfiguration } from "../config/configurationModel";
import {
  getBackendService,
  getDjangoBackendProject,
  getFrontendService,
  getPythonEnvironment,
  type DetectedProject
} from "../detection/detectedProject";

export const DEBUG_CONFIG_NAME_BACKEND = "StackPilot: Debug Django Server";
export const DEBUG_CONFIG_NAME_FRONTEND = "StackPilot: Debug Frontend in Chrome";
export const DEBUG_COMPOUND_NAME_FULL_STACK = "StackPilot: Debug Full Stack";

export type LaunchConfigurationEntry = Record<string, unknown> & { readonly name: string };

export interface LaunchConfigPlan {
  readonly configurations: readonly LaunchConfigurationEntry[];
  readonly compounds: readonly LaunchConfigurationEntry[];
}

export interface LaunchConfigInput {
  readonly workspaceRootPath: string;
  readonly detectedProject?: DetectedProject;
  readonly configuration?: StackPilotConfiguration;
}

/**
 * Builds launch.json entries so the servers this extension detects can be
 * run under VS Code's own debugger (breakpoints, step-through) instead of
 * only as a plain child process. Kept vscode-free and pure - the command
 * layer merges these into .vscode/launch.json via the `launch` configuration
 * API rather than hand-editing JSON.
 */
export function buildLaunchConfigurations(input: LaunchConfigInput): LaunchConfigPlan {
  const configurations: LaunchConfigurationEntry[] = [];

  const backendService = getBackendService(input.detectedProject);
  const backend = getDjangoBackendProject(backendService);
  const python = getPythonEnvironment(backendService);
  if (backend !== undefined && python !== undefined && input.configuration !== undefined) {
    configurations.push({
      name: DEBUG_CONFIG_NAME_BACKEND,
      type: "debugpy",
      request: "launch",
      program: toWorkspaceRelative(input.workspaceRootPath, backend.frameworkEntryPath),
      // --noreload: Django's auto-reloader forks a child process debugpy
      // never attaches to, silently defeating breakpoints.
      args: ["runserver", "--noreload", `${input.configuration.backendHost}:${input.configuration.backendPort}`],
      django: true,
      justMyCode: true,
      python: python.executablePath
    });
  }

  const frontend = getFrontendService(input.detectedProject);
  if (frontend !== undefined && input.configuration !== undefined) {
    configurations.push({
      name: DEBUG_CONFIG_NAME_FRONTEND,
      type: "chrome",
      request: "launch",
      url: `http://localhost:${input.configuration.frontendPort}`,
      webRoot: toWorkspaceRelative(input.workspaceRootPath, frontend.rootPath)
    });
  }

  const compounds: LaunchConfigurationEntry[] =
    configurations.length === 2
      ? [
          {
            name: DEBUG_COMPOUND_NAME_FULL_STACK,
            configurations: [DEBUG_CONFIG_NAME_BACKEND, DEBUG_CONFIG_NAME_FRONTEND]
          }
        ]
      : [];

  return { configurations, compounds };
}

/**
 * Replaces entries that share a `name` with an incoming entry and keeps
 * everything else untouched, so re-running the generator (or a user's own
 * hand-written configurations) never gets silently clobbered.
 */
export function mergeLaunchEntriesByName(
  existing: readonly LaunchConfigurationEntry[],
  incoming: readonly LaunchConfigurationEntry[]
): LaunchConfigurationEntry[] {
  const incomingNames = new Set(incoming.map((entry) => entry.name));
  return [...existing.filter((entry) => !incomingNames.has(entry.name)), ...incoming];
}

function toWorkspaceRelative(workspaceRootPath: string, absolutePath: string): string {
  const relative = path.relative(workspaceRootPath, absolutePath).replaceAll("\\", "/");
  return `\${workspaceFolder}/${relative}`;
}
