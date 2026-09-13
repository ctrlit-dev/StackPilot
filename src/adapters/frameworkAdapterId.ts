/**
 * Identifies a framework implementation (e.g. "django", "vite") - never a
 * `ServiceId`. A `ServiceId` ("backend", "frontend", "worker", ...) names a
 * *running process slot* `ProcessManager` tracks; a `FrameworkAdapterId`
 * names *which framework's rules* built that process's commands or parsed
 * its output. A service's id is chosen independently of which adapter
 * backs it - two services could someday use the same framework adapter, or
 * a service id could be renamed without the framework changing. These two
 * ids must never be compared, unioned, or used interchangeably.
 *
 * Shared by every framework adapter kind (`BackendFrameworkAdapter`,
 * `FrontendFrameworkAdapter`, ...) - the id concept itself is the same
 * regardless of what capabilities a given adapter kind exposes.
 */
export type FrameworkAdapterId = string;
