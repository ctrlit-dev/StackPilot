import type { BackendProject } from "../detection/backendDetector";
import type { DetectedService } from "../detection/detectedProject";
import type { PythonEnvironment } from "../detection/pythonDetector";
import type { InteractiveShellInvocation } from "../execution/interactiveTerminalManager";
import type { OneShotCommandOptions } from "../execution/oneShotCommand";
import type { StartProcessOptions } from "../execution/processManager";
import type { FrameworkAdapterId } from "./frameworkAdapterId";

export type IdentifierValidationResult = { readonly valid: true } | { readonly valid: false; readonly reason: string };

/**
 * The one capability every backend framework has: start a dev server.
 * Deliberately the smallest possible contract - proven necessary, not
 * speculative, by trying to write a FastAPI adapter against the old,
 * single, Django-shaped `BackendFrameworkAdapter` and hitting nine methods
 * (migrate, makemigrations, shell, createsuperuser, ...) that mean nothing
 * for FastAPI. Forcing a second implementation to stub those out (throwing,
 * or silently doing nothing) would have been the real architecture smell;
 * splitting the one universally-needed method out instead is not.
 *
 * Takes the whole `DetectedService`, not a framework-shaped project type
 * like `BackendProject` (a detection-internal DTO that only ever carries a
 * generic entry path - never Django's app list, FastAPI's own structured
 * facts, or a future framework's) - each concrete adapter reads whatever it
 * needs from `service.frameworkMetadata`/`service.runtime` via its own
 * type-safe helper (`getDjangoMetadata`/`getFastApiMetadata`/
 * `getPythonEnvironment`/`getNodeRuntime`), not a cast.
 *
 * Deliberately does NOT take a `PythonEnvironment` parameter (EXPRESS-1B):
 * that would force every implementation to receive a runtime fact only
 * Python-family frameworks (Django, FastAPI) actually have - a Node-runtime
 * framework (Express) has no `PythonEnvironment` to pass. Each concrete
 * adapter resolves whatever runtime it needs from `service` itself
 * (`getPythonEnvironment(service)` for Django/FastAPI,
 * `getNodeRuntime(service)` for Express), exactly the same way it already
 * resolves its own framework metadata from `service` rather than a
 * separately-passed parameter.
 */
export interface BackendStartAdapter {
  readonly id: FrameworkAdapterId;

  buildStartCommand(service: DetectedService, host: string, port: number): StartProcessOptions;
}

/**
 * Framework-specific knowledge needed to operate a backend dev server
 * beyond just starting it, and nothing else - see docs/ARCHITECTURE.md. An
 * adapter only builds structured, typed descriptors (`OneShotCommandOptions`,
 * `InteractiveShellInvocation`) or validates a piece of user input that is
 * about to become part of one; it does not spawn processes, check port
 * availability, check Workspace Trust, show terminals or notifications,
 * manage state, read configuration globally, or write files. Those all
 * remain the caller's (command layer's) responsibility.
 *
 * Extends `BackendStartAdapter` rather than duplicating `id`/`buildStartCommand` -
 * every framework that has operations beyond starting can start, but not
 * every framework that can start necessarily has StackPilot-modeled
 * operations yet (FastAPI, today - see `adapters/fastApiBackendAdapter.ts`,
 * which implements only `BackendStartAdapter`). Commands specific to one
 * operation set (Django's migrate/shell/etc.) are injected with this wider
 * interface directly, still statically wired to `djangoBackendAdapter` at
 * the composition root - they are Django-only commands by design, not
 * expected to work for any backend framework.
 *
 * Deliberately not a single generic "run this operation" method: Django's
 * operations have genuinely different shapes (one-shot vs. interactive vs.
 * one that validates untrusted input before it reaches argv), and collapsing
 * them into one data-driven dispatch would either lose that typing or push
 * the distinction into a runtime check every caller has to repeat. Each
 * method here mirrors a capability a real caller already needs.
 */
export interface BackendFrameworkAdapter extends BackendStartAdapter {
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
