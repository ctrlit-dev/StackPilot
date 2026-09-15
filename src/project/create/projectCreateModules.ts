import type { ProjectCreateModule } from "./projectCreateModule";
import { djangoCreateModule } from "./django/djangoCreateModule";
import { fastApiCreateModule } from "./fastapi/fastApiCreateModule";

/**
 * The one central registration point (plan §16/§30). Static imports only -
 * no dynamic loading, no filesystem scanning, no naming-convention
 * discovery. Adding a future module means adding exactly one import line
 * and one array entry here, and nothing else central.
 */
export const PROJECT_CREATE_MODULES: readonly ProjectCreateModule[] = [djangoCreateModule, fastApiCreateModule];
