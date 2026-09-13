import type { StackPilotConfiguration } from "../config/configurationModel";
import { detectBackendProject, type BackendDetectionResult } from "./backendDetector";
import { detectDjangoApps, type DjangoApp } from "./djangoAppDetector";
import type { FileSystemProbe } from "./fileSystem";
import { detectFrontendProject, type FrontendDetectionResult } from "./frontendDetector";
import { detectPythonEnvironment, type PythonDetectionResult, type PythonVersionProbe } from "./pythonDetector";

export interface DetectedProject {
  readonly workspaceRootPath: string;
  readonly backend: BackendDetectionResult;
  readonly frontend: FrontendDetectionResult;
  readonly python: PythonDetectionResult;
  /** Optional so every existing test helper that builds a DetectedProject literal keeps compiling; detectProject() always sets it. */
  readonly djangoApps?: readonly DjangoApp[];
  readonly diagnostics: readonly string[];
}

export async function detectProject(
  fs: FileSystemProbe,
  workspaceRootPath: string,
  configuration: StackPilotConfiguration,
  pythonVersionProbe?: PythonVersionProbe
): Promise<DetectedProject> {
  const backend = await detectBackendProject(fs, workspaceRootPath, configuration);
  const frontend = await detectFrontendProject(fs, workspaceRootPath, configuration);
  const python = await detectPythonEnvironment(fs, workspaceRootPath, backend.selected?.rootPath, configuration, pythonVersionProbe);
  const djangoApps = backend.selected === undefined ? [] : await detectDjangoApps(fs, backend.selected.rootPath);

  return {
    workspaceRootPath,
    backend,
    frontend,
    python,
    djangoApps,
    diagnostics: [...backend.diagnostics, ...frontend.diagnostics, ...python.diagnostics]
  };
}
