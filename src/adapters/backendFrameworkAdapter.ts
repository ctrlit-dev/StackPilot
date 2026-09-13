import type { BackendProject } from "../detection/backendDetector";
import type { PythonEnvironment } from "../detection/pythonDetector";
import type { InteractiveShellInvocation } from "../execution/interactiveTerminalManager";
import type { OneShotCommandOptions } from "../execution/oneShotCommand";
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

export type IdentifierValidationResult = { readonly valid: true } | { readonly valid: false; readonly reason: string };

/**
 * Framework-specific knowledge needed to start and operate a backend dev
 * server, and nothing else - see docs/ARCHITECTURE.md. An adapter only
 * builds structured, typed descriptors (`StartProcessOptions`,
 * `OneShotCommandOptions`, `InteractiveShellInvocation`) or validates a
 * piece of user input that is about to become part of one; it does not spawn
 * processes, check port availability, check Workspace Trust, show terminals
 * or notifications, manage state, read configuration globally, or write
 * files. Those all remain the caller's (command layer's) responsibility.
 *
 * Deliberately not a single generic "run this operation" method: Django's
 * operations have genuinely different shapes (one-shot vs. interactive vs.
 * one that validates untrusted input before it reaches argv), and collapsing
 * them into one data-driven dispatch would either lose that typing or push
 * the distinction into a runtime check every caller has to repeat. Each
 * method here mirrors a capability a real caller already needs.
 */
export interface BackendFrameworkAdapter {
  readonly id: FrameworkAdapterId;

  buildStartCommand(python: PythonEnvironment, backend: BackendProject, host: string, port: number): StartProcessOptions;

  buildMigrateCommand(python: PythonEnvironment, backend: BackendProject): OneShotCommandOptions;
  buildMakeMigrationsCommand(python: PythonEnvironment, backend: BackendProject): OneShotCommandOptions;
  buildShowMigrationsCommand(python: PythonEnvironment, backend: BackendProject): OneShotCommandOptions;
  buildTestCommand(python: PythonEnvironment, backend: BackendProject): OneShotCommandOptions;

  /**
   * The escape hatch behind "Run Management Command..." and the passive
   * migration-status poll: any manage.py subcommand and arguments, verbatim.
   * Pre-existing capability, not new genericity - both callers already
   * passed arbitrary args through the equivalent free function this method
   * replaces.
   */
  buildManagementCommand(python: PythonEnvironment, backend: BackendProject, args: readonly string[]): OneShotCommandOptions;

  /**
   * Must run before `buildStartAppCommand` - `appName` becomes an argv
   * element, so it is validated against a strict identifier allowlist first
   * rather than ever being interpolated unchecked.
   */
  validateAppName(name: string): IdentifierValidationResult;
  buildStartAppCommand(python: PythonEnvironment, backend: BackendProject, appName: string): OneShotCommandOptions;

  /**
   * Interactive operations need real stdin (a REPL, a password prompt), so
   * they return an `InteractiveShellInvocation` (shellPath/shellArgs/cwd for
   * `vscode.window.createTerminal`) instead of an `OneShotCommandOptions` a
   * captured/one-shot runner would silently swallow input for.
   */
  buildShellInvocation(python: PythonEnvironment, backend: BackendProject): InteractiveShellInvocation;
  buildDatabaseShellInvocation(python: PythonEnvironment, backend: BackendProject): InteractiveShellInvocation;
  buildCreateSuperuserInvocation(python: PythonEnvironment, backend: BackendProject): InteractiveShellInvocation;
}
