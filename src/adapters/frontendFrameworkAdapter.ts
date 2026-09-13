import type { FrameworkAdapterId } from "./frameworkAdapterId";

/**
 * Framework-specific knowledge needed to observe a frontend dev server, and
 * nothing else - see docs/ARCHITECTURE.md. Deliberately much smaller than
 * `BackendFrameworkAdapter`: almost everything about running a frontend
 * (which package manager, which script, install/build/test/run-script) is
 * already generic Node/package-manager logic that stays outside any adapter
 * (`execution/frontendCommand.ts`, `commands/frontendOperationPlans.ts`).
 * The one thing that is genuinely framework-specific is reading the dev
 * server's *actual* bound URL from its own process output, because every
 * dev server prints that differently (or not at all).
 */
export interface FrontendFrameworkAdapter {
  readonly id: FrameworkAdapterId;

  /**
   * Looks for this framework's dev-server-ready line in a chunk of raw
   * process output (which may be only part of a line, and may contain ANSI
   * escape codes) and returns the URL if found, or `undefined` otherwise.
   * Untrusted process output in, a plain string out - never executed,
   * never treated as anything but a URL/state value by callers.
   */
  parseDevServerUrl(outputChunk: string): string | undefined;
}
