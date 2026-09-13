/**
 * Opaque identifier for a development service the extension can manage as a
 * process (spec: "Development Services" - backend, frontend, and later
 * things like a database, Redis, or a worker). A plain `string` alias rather
 * than a branded/nominal type: nothing in this codebase constructs a
 * `ServiceId` through validation or parsing that a brand would protect
 * against, so a brand would add ceremony without adding safety. The named
 * alias still documents intent at every call site instead of leaving a bare
 * `string` for "this is a process kind" to be inferred from context.
 */
export type ServiceId = string;

/**
 * The set of service ids a `ProcessManager` treats as participating in bulk
 * operations (`startAll`/`stopAll`) - not a gatekeeper for individual
 * `start()`/`stop()` calls, which already work for any `ServiceId` via the
 * process manager's own state map. Kept intentionally minimal (just ids, no
 * per-service metadata) because nothing in the current architecture needs
 * more than that yet: labels, icons, and "should this auto-start" decisions
 * all still live where they always have (the UI layer and the command
 * handlers' own plan functions), not here. Add fields here only once a real
 * caller needs them.
 */
export class ServiceRegistry {
  private readonly ids: readonly ServiceId[];

  public constructor(ids: readonly ServiceId[]) {
    this.ids = [...ids];
  }

  public getServiceIds(): readonly ServiceId[] {
    return this.ids;
  }
}

export const BACKEND_SERVICE_ID: ServiceId = "backend";
export const FRONTEND_SERVICE_ID: ServiceId = "frontend";

/** Today's two managed services. A third service is added by constructing a `ServiceRegistry` with more ids, not by widening a type union. */
export const DEFAULT_SERVICE_REGISTRY = new ServiceRegistry([BACKEND_SERVICE_ID, FRONTEND_SERVICE_ID]);
