import type { BackendFrameworkDetection } from "../adapters/backendFrameworkDetection";
import type { FrontendFrameworkDetection } from "../adapters/frontendFrameworkDetection";
import type { StackPilotConfiguration } from "../config/configurationModel";
import { BACKEND_SERVICE_ID, FRONTEND_SERVICE_ID } from "../serviceId";
import { detectBackendProject } from "./backendDetector";
import type { DetectedProject, DetectedService } from "./detectedProject";
import { detectDjangoApps } from "./djangoAppDetector";
import type { FileSystemProbe } from "./fileSystem";
import { detectFrontendProject } from "./frontendDetector";
import { detectPythonEnvironment, type PythonVersionProbe } from "./pythonDetector";

export type { DetectedProject, DetectedService } from "./detectedProject";

/**
 * Runs the (framework-neutral) backend/frontend/Python detectors, unchanged,
 * then shapes their results into the generalized `DetectedProject` -
 * `services` plus workspace-level Python detection - instead of returning
 * their raw candidate objects directly. Detection itself
 * (`backendDetector.ts`/`frontendDetector.ts`/`pythonDetector.ts`) is not
 * touched by this generalization; only how their results are assembled here
 * changed.
 */
export async function detectProject(
  fs: FileSystemProbe,
  workspaceRootPath: string,
  configuration: StackPilotConfiguration,
  backendFrameworkDetection: BackendFrameworkDetection,
  frontendFrameworkDetection: FrontendFrameworkDetection,
  pythonVersionProbe?: PythonVersionProbe
): Promise<DetectedProject> {
  const backend = await detectBackendProject(fs, workspaceRootPath, configuration, backendFrameworkDetection);
  const frontend = await detectFrontendProject(fs, workspaceRootPath, configuration, frontendFrameworkDetection);
  const python = await detectPythonEnvironment(fs, workspaceRootPath, backend.selected?.rootPath, configuration, pythonVersionProbe);
  const djangoApps = backend.selected === undefined ? [] : await detectDjangoApps(fs, backend.selected.rootPath);

  const services: DetectedService[] = [];

  if (backend.selected !== undefined) {
    services.push({
      id: BACKEND_SERVICE_ID,
      rootPath: backend.selected.rootPath,
      frameworkId: backendFrameworkDetection.frameworkId,
      runtime: { kind: "python", detection: python },
      frameworkMetadata: { kind: "django", managePyPath: backend.selected.managePyPath, apps: djangoApps },
      score: backend.selected.score,
      evidence: backend.selected.evidence
    });
  }

  if (frontend.selected !== undefined) {
    services.push({
      id: FRONTEND_SERVICE_ID,
      rootPath: frontend.selected.rootPath,
      // Vite detection is evidence, not a gate (any package.json-having root already qualifies as a frontend
      // candidate - detection/frontendDetector.ts), so a confirmed frameworkId only when Vite was actually found.
      frameworkId: frontend.selected.viteConfigPath === undefined ? undefined : frontendFrameworkDetection.frameworkId,
      runtime: {
        kind: "node",
        packageManager: frontend.selected.packageManager,
        packageJsonPath: frontend.selected.packageJsonPath,
        scripts: frontend.selected.scripts
      },
      score: frontend.selected.score,
      evidence: frontend.selected.evidence
    });
  }

  return {
    workspaceRootPath,
    services,
    pythonRuntime: python,
    diagnostics: [...backend.diagnostics, ...frontend.diagnostics, ...python.diagnostics]
  };
}
