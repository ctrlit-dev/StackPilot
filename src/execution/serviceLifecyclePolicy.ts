import { COMMAND_START_BACKEND, COMMAND_START_FRONTEND } from "../constants";
import type { ProjectStateStore } from "../state/projectState";
import { BACKEND_SERVICE_ID, FRONTEND_SERVICE_ID, type ServiceId } from "./serviceRegistry";

/**
 * How a service behaves when it crashes or is manually restarted - the
 * generalized replacement for the `kind === "backend" ? ... : ...` ternaries
 * `AutoRestartController` and `CrashNotificationController` used to carry
 * directly. Keyed by `ServiceId`, never `FrameworkAdapterId` - see
 * docs/ARCHITECTURE.md. Only the fields those two controllers actually read;
 * `restartCommandId` is optional because a service need not support a
 * user-initiated "Restart" action at all (see `fallbackServiceLifecyclePolicy`).
 */
export interface ServiceLifecyclePolicy {
  readonly autoRestartEnabled: boolean;
  readonly displayName: string;
  readonly restartCommandId?: string;
}

/**
 * Resolves the current lifecycle policy for a service. Deliberately a
 * lookup method, not a `Record<ServiceId, ServiceLifecyclePolicy>` or a
 * pre-computed `Map` snapshot: `ServiceId` is an open string (spec: Phase 1),
 * so a `Record`/`Map` would either suggest false completeness or need a
 * fallback check at every call site anyway, and `backendAutoRestart`/
 * `frontendAutoRestart` must reflect the *current* configuration at crash
 * time (they can change at runtime via `onDidChangeConfiguration`), not a
 * value captured once at construction.
 */
export interface ServiceLifecyclePolicyProvider {
  getPolicy(serviceId: ServiceId): ServiceLifecyclePolicy;
}

/**
 * The safe default for any `ServiceId` this provider does not specifically
 * recognize: auto-restart off, no restart command (so `CrashNotificationController`
 * simply does not offer a "Restart" action rather than guessing one), and the
 * raw id itself as a display label - never silently inheriting another
 * service's policy (backend's or frontend's).
 */
export function fallbackServiceLifecyclePolicy(serviceId: ServiceId): ServiceLifecyclePolicy {
  return { autoRestartEnabled: false, displayName: serviceId };
}

/**
 * Today's two real services, backed by the pre-existing
 * `stackPilot.backend.autoRestartOnCrash`/`stackPilot.frontend.autoRestartOnCrash`
 * settings (unrenamed - spec: backward compatibility over a breaking config
 * migration). Reads `projectState.getState()` on every call rather than a
 * value captured at construction, preserving the pre-existing dynamic-config
 * behavior both controllers already relied on.
 */
export function createDefaultServiceLifecyclePolicyProvider(projectState: ProjectStateStore): ServiceLifecyclePolicyProvider {
  return {
    getPolicy(serviceId: ServiceId): ServiceLifecyclePolicy {
      const configuration = projectState.getState().configuration;

      if (serviceId === BACKEND_SERVICE_ID) {
        return {
          autoRestartEnabled: configuration?.backendAutoRestart ?? false,
          displayName: "Backend",
          restartCommandId: COMMAND_START_BACKEND
        };
      }

      if (serviceId === FRONTEND_SERVICE_ID) {
        return {
          autoRestartEnabled: configuration?.frontendAutoRestart ?? false,
          displayName: "Frontend",
          restartCommandId: COMMAND_START_FRONTEND
        };
      }

      return fallbackServiceLifecyclePolicy(serviceId);
    }
  };
}
