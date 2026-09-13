import * as path from "node:path";

import type { StackPilotConfiguration } from "../config/configurationModel";
import { resolveWorkspacePath, uniqueStrings } from "../utils/paths";
import type { FileSystemProbe } from "./fileSystem";

export type PythonEnvironmentSource = "configured" | "venv" | "path";

export interface PythonEnvironment {
  readonly executablePath: string;
  readonly version?: string;
  readonly source: PythonEnvironmentSource;
  readonly environmentPath?: string;
  readonly validation: "exists" | "version-probed" | "broken";
}

export interface PythonVersionProbe {
  getVersion(executablePath: string): Promise<string | undefined>;
}

export interface PythonDetectionResult {
  readonly selected?: PythonEnvironment;
  readonly candidates: readonly PythonEnvironment[];
  readonly diagnostics: readonly string[];
}

const VENV_DIRECTORIES = ["backend/.venv", "backend/venv", "backend/env", ".venv", "venv", "env"] as const;

const PATH_EXECUTABLE_NAMES = ["python.exe", "python3.exe", "python3", "python"] as const;

export async function detectPythonEnvironment(
  fs: FileSystemProbe,
  workspaceRootPath: string,
  backendRootPath: string | undefined,
  configuration: StackPilotConfiguration,
  versionProbe?: PythonVersionProbe,
  pathEnvironmentVariable: string = process.env.PATH ?? ""
): Promise<PythonDetectionResult> {
  const diagnostics: string[] = [];
  const candidates: PythonEnvironment[] = [];

  if (configuration.pythonInterpreter.trim().length > 0) {
    const configuredPath = resolveWorkspacePath(workspaceRootPath, configuration.pythonInterpreter);
    if (await fs.fileExists(configuredPath)) {
      candidates.push(await createEnvironment(configuredPath, "configured", undefined, versionProbe));
    } else {
      diagnostics.push(`Configured Python interpreter was not found: ${configuredPath}`);
    }
  }

  const venvRoots = uniqueStrings([
    configuration.pythonVenvDirectory,
    ...(backendRootPath === undefined ? [] : relativeBackendVenvs(workspaceRootPath, backendRootPath)),
    ...VENV_DIRECTORIES
  ]);

  for (const venvDirectory of venvRoots) {
    const environmentPath = resolveWorkspacePath(workspaceRootPath, venvDirectory);
    for (const interpreterPath of getVirtualEnvironmentInterpreterPaths(environmentPath)) {
      if (await fs.fileExists(interpreterPath)) {
        candidates.push(await createEnvironment(interpreterPath, "venv", environmentPath, versionProbe));
        break;
      }
    }
  }

  for (const directory of splitPathEnvironment(pathEnvironmentVariable)) {
    for (const executableName of PATH_EXECUTABLE_NAMES) {
      const executablePath = path.join(directory, executableName);
      if (await fs.fileExists(executablePath)) {
        candidates.push(await createEnvironment(executablePath, "path", undefined, versionProbe));
      }
    }
  }

  return {
    selected: candidates[0],
    candidates,
    diagnostics
  };
}

function splitPathEnvironment(pathEnvironmentVariable: string): string[] {
  return uniqueStrings(
    pathEnvironmentVariable
      .split(path.delimiter)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  );
}

export function getVirtualEnvironmentInterpreterPaths(environmentPath: string): string[] {
  return [
    path.join(environmentPath, "Scripts", "python.exe"),
    path.join(environmentPath, "bin", "python")
  ];
}

async function createEnvironment(
  executablePath: string,
  source: PythonEnvironmentSource,
  environmentPath: string | undefined,
  versionProbe: PythonVersionProbe | undefined
): Promise<PythonEnvironment> {
  const version = versionProbe === undefined ? undefined : await versionProbe.getVersion(executablePath);
  return {
    executablePath,
    version,
    source,
    environmentPath,
    validation: version === undefined ? "exists" : "version-probed"
  };
}

function relativeBackendVenvs(workspaceRootPath: string, backendRootPath: string): string[] {
  const backendRelativePath = path.relative(workspaceRootPath, backendRootPath);
  if (backendRelativePath === "") {
    return [".venv", "venv", "env"];
  }

  return [".venv", "venv", "env"].map((venvName) => path.join(backendRelativePath, venvName));
}
