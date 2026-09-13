import { BACKEND_SERVICE_ID, FRONTEND_SERVICE_ID, type ServiceId } from "../serviceId";

export type { ServiceId } from "../serviceId";
export { BACKEND_SERVICE_ID, FRONTEND_SERVICE_ID } from "../serviceId";

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

/** Today's two managed services. A third service is added by constructing a `ServiceRegistry` with more ids, not by widening a type union. */
export const DEFAULT_SERVICE_REGISTRY = new ServiceRegistry([BACKEND_SERVICE_ID, FRONTEND_SERVICE_ID]);
