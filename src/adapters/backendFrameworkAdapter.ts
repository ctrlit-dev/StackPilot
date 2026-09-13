import type { BackendProject } from "../detection/backendDetector";
import type { PythonEnvironment } from "../detection/pythonDetector";
import type { StartProcessOptions } from "../execution/processManager";

/**
 * Identifies a backend framework implementation (e.g. "django") - never a
 * `ServiceId`. A `ServiceId` ("backend", "api", "worker", ...) names a
 * *running process slot* `ProcessManager` tracks; a `FrameworkAdapterId`
 * names *which framework's rules* built that process's start command. A
 * service's id is chosen independently of which adapter builds its command -
 * two services could someday use the same framework adapter ("api" and
 * "admin" both Django), or a service id could be renamed without the
 * framework changing. These two ids must never be compared, unioned, or used
 * interchangeably.
 */
export type FrameworkAdapterId = string;

/**
 * Framework-specific knowledge needed to start a backend dev server, and
 * nothing else - see docs/ARCHITECTURE.md. An adapter only builds a
 * structured execution descriptor (`StartProcessOptions`); it does not spawn
 * processes, check port availability, check Workspace Trust, show terminals
 * or notifications, manage state, read configuration globally, or write
 * files. Those all remain the caller's (command layer's) responsibility,
 * unchanged from before this extraction.
 */
export interface BackendFrameworkAdapter {
  readonly id: FrameworkAdapterId;

  buildStartCommand(python: PythonEnvironment, backend: BackendProject, host: string, port: number): StartProcessOptions;
}
