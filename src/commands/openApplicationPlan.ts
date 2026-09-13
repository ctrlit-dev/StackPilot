import type { ManagedProcessDescriptor, ManagedProcessKind } from "../execution/processManager";

/**
 * The URL for one specific running service, or undefined if it is not
 * running or its port/URL is not yet known. Shared by the generic "Open
 * Application" command and the "offer to open after Start" prompt so both
 * agree on how a service's URL is derived.
 */
export function planServiceUrl(
  kind: ManagedProcessKind,
  descriptor: ManagedProcessDescriptor,
  frontendActualUrl: string | undefined,
  backendHost: string
): string | undefined {
  if (descriptor.state !== "running") {
    return undefined;
  }

  if (kind === "frontend") {
    return frontendActualUrl ?? (descriptor.expectedPort === undefined ? undefined : `http://127.0.0.1:${descriptor.expectedPort}/`);
  }

  return descriptor.expectedPort === undefined ? undefined : `http://${backendHost}:${descriptor.expectedPort}/`;
}

export type OpenApplicationPlan = { readonly kind: "open"; readonly url: string } | { readonly kind: "nothing-running" };

/**
 * Prefers the frontend when it is running (spec §62: "Frontend default
 * should use the detected dev server URL when available"), falling back to
 * the backend. Never opens anything when nothing is running - the command
 * layer explains that instead (spec §71 in spirit: never claim something is
 * running that is not).
 */
export function planOpenApplication(
  backend: ManagedProcessDescriptor,
  frontend: ManagedProcessDescriptor,
  frontendActualUrl: string | undefined,
  backendHost: string
): OpenApplicationPlan {
  const frontendUrl = planServiceUrl("frontend", frontend, frontendActualUrl, backendHost);
  if (frontendUrl !== undefined) {
    return { kind: "open", url: frontendUrl };
  }

  const backendUrl = planServiceUrl("backend", backend, frontendActualUrl, backendHost);
  if (backendUrl !== undefined) {
    return { kind: "open", url: backendUrl };
  }

  return { kind: "nothing-running" };
}
