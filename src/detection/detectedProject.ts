import type { FrameworkAdapterId } from "../adapters/frameworkAdapterId";
import { BACKEND_SERVICE_ID, FRONTEND_SERVICE_ID, type ServiceId } from "../serviceId";
import type { BackendProject } from "./backendDetector";
import type { DjangoApp } from "./djangoAppDetector";
import type { PackageManagerDetection } from "./packageManagerDetector";
import type { PythonDetectionResult, PythonEnvironment } from "./pythonDetector";

/**
 * Django-specific facts about a detected service, attached only to a
 * service whose framework is actually Django. Not merged into
 * `DetectedService` itself - `managePyPath` and `apps` mean nothing for a
 * Vite (or future FastAPI) service, and a service without them simply has
 * `frameworkMetadata: undefined` rather than those fields being present-but-
 * meaningless everywhere.
 */
export interface DjangoServiceMetadata {
  readonly kind: "django";
  readonly managePyPath: string;
  readonly apps: readonly DjangoApp[];
}

/**
 * FastAPI-specific facts about a detected service - proof that
 * `FrameworkMetadata` was actually designed to grow (see below), not just
 * documented as if it would. `appImport` is the uvicorn `module:attr`
 * reference (e.g. `"main:app"`, `"app.main:app"`), already resolved from the
 * detected entry file's location relative to the service's `rootPath` - see
 * `adapters/fastApiBackendDetection.ts`'s `deriveFastApiAppImport()`.
 */
export interface FastApiServiceMetadata {
  readonly kind: "fastapi";
  readonly appImport: string;
}

/**
 * A union that has now genuinely grown by one member (Django → Django |
 * FastAPI), confirming the original design intent: adding a framework whose
 * services carry their own structured facts means adding one more variant
 * here, not redesigning this type or `DetectedService`. Discriminated by its
 * own `kind`, not by `FrameworkAdapterId` - `FrameworkAdapterId` is an
 * intentionally open `string` (any adapter can register with any id), so
 * narrowing on it could never give TypeScript a closed, checkable
 * discriminant the way this union's own `kind` field can. `service.frameworkId`
 * and `service.frameworkMetadata?.kind` are expected to agree in practice
 * (detection only ever attaches a framework's metadata alongside its own
 * `frameworkId`), but that agreement is an invariant this codebase's
 * detection code maintains, not something the type system enforces across
 * the two fields - see `getDjangoMetadata()`/`getFastApiMetadata()` below,
 * which narrow on `.kind`, never on `frameworkId`.
 */
export type FrameworkMetadata = DjangoServiceMetadata | FastApiServiceMetadata;

/** A service's Python interpreter/venv, plus the full detection result (`candidates`/`diagnostics`) a caller like `findBasePython` still needs. */
export interface PythonRuntimeReference {
  readonly kind: "python";
  readonly detection: PythonDetectionResult;
}

/** A service's package manager - `scripts`/`packageJsonPath` are generic `package.json` facts every Node-based service has, not framework-specific. */
export interface NodeRuntimeReference {
  readonly kind: "node";
  readonly packageManager: PackageManagerDetection;
  readonly packageJsonPath: string;
  readonly scripts: Readonly<Record<string, string>>;
}

export type RuntimeReference = PythonRuntimeReference | NodeRuntimeReference;

/**
 * A single detected development service - the generalized replacement for
 * `DetectedProject`'s old separate `backend`/`frontend` fields. `id` is a
 * `ServiceId` ("backend", "frontend", later perhaps "worker"), never a
 * `FrameworkAdapterId` - which framework backs a service (`frameworkId`)
 * and which runtime it uses (`runtime`) are separate, optional facts about
 * it, not the service's identity. A service can exist with neither (a
 * detected root StackPilot has no specific framework opinion about yet).
 */
export interface DetectedService {
  readonly id: ServiceId;
  readonly rootPath: string;
  readonly frameworkId?: FrameworkAdapterId;
  readonly runtime?: RuntimeReference;
  readonly frameworkMetadata?: FrameworkMetadata;
  readonly score: number;
  readonly evidence: readonly string[];
}

export interface DetectedProject {
  readonly workspaceRootPath: string;
  readonly services: readonly DetectedService[];
  /**
   * Workspace-level Python detection, kept alongside (not instead of) the
   * backend service's own `runtime` - existing UI (the tree's Environment
   * section) shows Python status independent of whether a backend service
   * was found at all (a bare venv/script with no Django project still shows
   * "Python: <version>"), and `findBasePython` (venv (re)creation) has never
   * required a backend to exist either. Not a second source of truth for
   * the same data: when a backend service exists, its `runtime` points at
   * this exact same `PythonDetectionResult` object, not a copy of it.
   */
  readonly pythonRuntime: PythonDetectionResult;
  readonly diagnostics: readonly string[];
}

export function findService(project: DetectedProject | undefined, id: ServiceId): DetectedService | undefined {
  return project?.services.find((service) => service.id === id);
}

export function getBackendService(project: DetectedProject | undefined): DetectedService | undefined {
  return findService(project, BACKEND_SERVICE_ID);
}

export function getFrontendService(project: DetectedProject | undefined): DetectedService | undefined {
  return findService(project, FRONTEND_SERVICE_ID);
}

/** Narrows on `frameworkMetadata.kind`, not `frameworkId` - see the `FrameworkMetadata` doc comment above for why. */
export function getDjangoMetadata(service: DetectedService | undefined): DjangoServiceMetadata | undefined {
  return service?.frameworkMetadata?.kind === "django" ? service.frameworkMetadata : undefined;
}

/** Same pattern as `getDjangoMetadata()` - narrows on `.kind`, never on `frameworkId`. */
export function getFastApiMetadata(service: DetectedService | undefined): FastApiServiceMetadata | undefined {
  return service?.frameworkMetadata?.kind === "fastapi" ? service.frameworkMetadata : undefined;
}

/**
 * Reconstructs the `BackendProject` shape `BackendFrameworkAdapter`/
 * `djangoBackendAdapter` methods take, from the generalized service model -
 * the one central, type-safe place that does this, instead of every Django
 * command/plan casting `service.frameworkMetadata` itself (spec: "Bevorzuge
 * zentralen sicheren Django Helper/Guard").
 */
export function getDjangoBackendProject(service: DetectedService | undefined): BackendProject | undefined {
  const metadata = getDjangoMetadata(service);
  if (service === undefined || metadata === undefined) {
    return undefined;
  }
  return { rootPath: service.rootPath, managePyPath: metadata.managePyPath, score: service.score, evidence: service.evidence };
}

export function getPythonEnvironment(service: DetectedService | undefined): PythonEnvironment | undefined {
  return service?.runtime?.kind === "python" ? service.runtime.detection.selected : undefined;
}

export function getNodeRuntime(service: DetectedService | undefined): NodeRuntimeReference | undefined {
  return service?.runtime?.kind === "node" ? service.runtime : undefined;
}
