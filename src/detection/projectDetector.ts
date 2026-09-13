import type { BackendFrameworkDetection } from "../adapters/backendFrameworkDetection";
import { deriveFastApiAppImport } from "../adapters/fastApiBackendDetection";
import type { FrameworkAdapterId } from "../adapters/frameworkAdapterId";
import type { FrontendFrameworkDetection } from "../adapters/frontendFrameworkDetection";
import type { StackPilotConfiguration } from "../config/configurationModel";
import { BACKEND_SERVICE_ID, FRONTEND_SERVICE_ID } from "../serviceId";
import { detectBackendProject, type BackendDetectionResult, type BackendProject } from "./backendDetector";
import type { DetectedProject, DetectedService, FrameworkMetadata } from "./detectedProject";
import { detectDjangoApps, type DjangoApp } from "./djangoAppDetector";
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
  backendFrameworkDetections: readonly BackendFrameworkDetection[],
  frontendFrameworkDetection: FrontendFrameworkDetection,
  pythonVersionProbe?: PythonVersionProbe
): Promise<DetectedProject> {
  const backend = await detectBackendFramework(fs, workspaceRootPath, configuration, backendFrameworkDetections);
  const frontend = await detectFrontendProject(fs, workspaceRootPath, configuration, frontendFrameworkDetection);
  const python = await detectPythonEnvironment(fs, workspaceRootPath, backend.result.selected?.rootPath, configuration, pythonVersionProbe);

  const services: DetectedService[] = [];

  if (backend.result.selected !== undefined && backend.frameworkId !== undefined) {
    const djangoApps = backend.frameworkId === "django" ? await detectDjangoApps(fs, backend.result.selected.rootPath) : [];
    services.push({
      id: BACKEND_SERVICE_ID,
      rootPath: backend.result.selected.rootPath,
      frameworkId: backend.frameworkId,
      runtime: { kind: "python", detection: python },
      frameworkMetadata: buildBackendFrameworkMetadata(backend.frameworkId, backend.result.selected, djangoApps),
      score: backend.result.selected.score,
      evidence: backend.result.selected.evidence
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
    diagnostics: [...backend.result.diagnostics, ...frontend.diagnostics, ...python.diagnostics]
  };
}

/**
 * The one backend-framework selection boundary (spec: "genau eine Selection
 * Boundary"). Tries each detection in order and stops at the first one that
 * finds a candidate - deterministic precedence, not a scoring engine: no
 * cross-framework score comparison, so an existing Django project's
 * detection can never be weakened by a later-registered framework
 * (`extension.ts` registers Django before FastAPI). If a workspace somehow
 * has evidence for both, Django wins - the same "first match in an ordered
 * list wins" rule `MANAGE_PY_CANDIDATES` itself already uses one level
 * down. Every detection that IS tried still contributes its diagnostics.
 */
async function detectBackendFramework(
  fs: FileSystemProbe,
  workspaceRootPath: string,
  configuration: StackPilotConfiguration,
  backendFrameworkDetections: readonly BackendFrameworkDetection[]
): Promise<{ readonly result: BackendDetectionResult; readonly frameworkId?: FrameworkAdapterId }> {
  const diagnostics: string[] = [];

  for (const detection of backendFrameworkDetections) {
    const result = await detectBackendProject(fs, workspaceRootPath, configuration, detection);
    diagnostics.push(...result.diagnostics);
    if (result.selected !== undefined) {
      return { result: { ...result, diagnostics }, frameworkId: detection.frameworkId };
    }
  }

  return { result: { selected: undefined, candidates: [], diagnostics } };
}

/**
 * The other small, explicit selection point this phase's second backend
 * framework required (spec §17/§18: acceptable for exactly two backend
 * frameworks, as long as it stays in this one place). Not a capability
 * registry - just "which metadata shape does this framework's service get".
 */
function buildBackendFrameworkMetadata(
  frameworkId: FrameworkAdapterId,
  backend: BackendProject,
  djangoApps: readonly DjangoApp[]
): FrameworkMetadata | undefined {
  if (frameworkId === "django") {
    return { kind: "django", managePyPath: backend.frameworkEntryPath, apps: djangoApps };
  }
  if (frameworkId === "fastapi") {
    return { kind: "fastapi", appImport: deriveFastApiAppImport(backend.rootPath, backend.frameworkEntryPath) };
  }
  return undefined;
}
