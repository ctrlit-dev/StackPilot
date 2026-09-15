import type { BackendCreateModule } from "./backendCreateModule";
import { djangoCreateModule } from "./django/djangoCreateModule";

/**
 * The one central registration point (plan §16/§30). Static imports only -
 * no dynamic loading, no filesystem scanning, no naming-convention
 * discovery. Adding a future backend means adding exactly one import line
 * and one array entry here, and nothing else central.
 */
export const BACKEND_CREATE_MODULES: readonly BackendCreateModule[] = [djangoCreateModule];
