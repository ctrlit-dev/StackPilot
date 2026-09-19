import * as path from "node:path";

import type { BackendFrameworkDetection } from "../adapters/backendFrameworkDetection";
import { deriveFastApiAppImport } from "../adapters/fastApiBackendDetection";
import type { FrameworkAdapterId } from "../adapters/frameworkAdapterId";
import type { FrontendFrameworkDetection } from "../adapters/frontendFrameworkDetection";
import type { StackPilotConfiguration } from "../config/configurationModel";
import { BACKEND_SERVICE_ID, FRONTEND_SERVICE_ID } from "../serviceId";
import { detectBackendProject, type BackendDetectionResult, type BackendProject } from "./backendDetector";
import type { DetectedProject, DetectedService, FrameworkMetadata, RuntimeReference } from "./detectedProject";
import { detectDjangoApps, type DjangoApp } from "./djangoAppDetector";
import type { FileSystemProbe } from "./fileSystem";
import { detectFrontendProject } from "./frontendDetector";
import { readPackageJson } from "./packageJson";
import { detectPackageManager } from "./packageManagerDetector";
import { detectPythonEnvironment, type PythonDetectionResult, type PythonVersionProbe } from "./pythonDetector";

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
      runtime: await buildBackendRuntime(fs, backend.frameworkId, backend.result.selected.rootPath, python),
      frameworkMetadata: buildBackendFrameworkMetadata(backend.frameworkId, backend.result.selected, djangoApps),
      score: backend.result.selected.score,
      evidence: backend.result.selected.evidence
    });
  }

  if (frontend.selected !== undefined && !isBackendsOwnPackageJson(frontend.selected, backend.result.selected)) {
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
 * EXPRESS-1B discovery: `frontendDetector.ts`'s own `"."` candidate
 * directory means *any* workspace root with a `package.json` already
 * qualifies as a frontend candidate - true for every plain Node backend at
 * the workspace root, which was never exercised before EXPRESS-1B because
 * Django/FastAPI have no root `package.json` of their own. Left
 * unguarded, a flat Express backend's own `package.json` would
 * independently re-qualify as a second, spurious "frontend" service at the
 * exact same `rootPath` - not a Vite-detection false positive (Vite's own
 * marker is still absent, so `frameworkId` would be `undefined`), but a
 * duplicate `DetectedService` entry that would confuse Start/Stop/Toggle
 * ("Start Frontend" would re-run the same Express dev server a second time
 * from the same directory). This is a one-line suppression at the one
 * assembly point that already knows both results, not a change to either
 * detector: only ever fires when the "frontend" candidate is literally the
 * backend's own root with no independent Vite evidence - a real nested Vite
 * frontend (its own directory, or a `vite.config.*` confirming intent even
 * at the workspace root) is never suppressed.
 */
function isBackendsOwnPackageJson(
  frontendSelected: { readonly rootPath: string; readonly viteConfigPath?: string },
  backendSelected: BackendProject | undefined
): boolean {
  return (
    backendSelected !== undefined &&
    frontendSelected.viteConfigPath === undefined &&
    path.resolve(frontendSelected.rootPath) === path.resolve(backendSelected.rootPath)
  );
}

/**
 * EXPRESS-1B: a backend's `RuntimeReference` is no longer unconditionally
 * Python - the one small, explicit selection point (same shape as
 * `buildBackendFrameworkMetadata` immediately below) that fixes the
 * pre-EXPRESS-1B assumption `backend => Python runtime`. Django and FastAPI
 * are Python-runtime frameworks (unchanged); Express is a Node-runtime
 * framework. No configurable package-manager preference for the backend in
 * this phase (spec: no settings surface until a real caller needs one) -
 * `"auto"` (lockfile-based detection) matches how `frontendDetector.ts`
 * already behaves whenever no override is configured, and is a sufficient,
 * already-proven default for this phase's Create-less, detection-only proof.
 */
async function buildBackendRuntime(
  fs: FileSystemProbe,
  frameworkId: FrameworkAdapterId,
  backendRootPath: string,
  python: PythonDetectionResult
): Promise<RuntimeReference> {
  if (frameworkId !== "express") {
    return { kind: "python", detection: python };
  }

  const packageJsonPath = path.join(backendRootPath, "package.json");
  const packageJson = await readPackageJson(fs, packageJsonPath);
  return {
    kind: "node",
    packageManager: await detectPackageManager(fs, backendRootPath, "auto"),
    packageJsonPath,
    scripts: packageJson.kind === "valid" ? packageJson.scripts : {}
  };
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
