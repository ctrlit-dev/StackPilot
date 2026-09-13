/**
 * Opaque identifier for a development service the extension can manage as a
 * process (spec: "Development Services" - backend, frontend, and later
 * things like a database, Redis, or a worker). A plain `string` alias rather
 * than a branded/nominal type: nothing in this codebase constructs a
 * `ServiceId` through validation or parsing that a brand would protect
 * against, so a brand would add ceremony without adding safety.
 *
 * Lives at the project root (not under `execution/` or `detection/`)
 * because both layers need it: `execution/processManager.ts` tracks a
 * process per `ServiceId`, and `detection/`'s project model
 * (`detection/detectedProject.ts`) identifies a detected service by the
 * same id - `detection/` must not import from `execution/` (see
 * docs/ARCHITECTURE.md), so this shared vocabulary type sits below both,
 * the same treatment `adapters/frameworkAdapterId.ts` already gets for the
 * same reason.
 */
export type ServiceId = string;

/** Today's two real services. A third id is just another string - see `execution/serviceRegistry.ts`'s `ServiceRegistry`. */
export const BACKEND_SERVICE_ID: ServiceId = "backend";
export const FRONTEND_SERVICE_ID: ServiceId = "frontend";
