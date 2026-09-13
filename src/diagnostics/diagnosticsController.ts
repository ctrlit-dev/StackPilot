import type { FileSystemProbe } from "../detection/fileSystem";
import type { ProjectStateStore } from "../state/projectState";
import type { MigrationStatusReader } from "./checks/djangoMigrationsCheck";
import type { DiagnosticResult } from "./diagnostic";
import type { DiagnosticCheck, DiagnosticContext } from "./diagnosticCheck";

/**
 * Collects `DiagnosticResult`s from an explicit, composition-root-wired list
 * of checks (extension.ts) - no registry, provider, or plugin loader. Plain
 * TypeScript with no `vscode` import at all, matching the same
 * plain-callback listener pattern `ProjectStateStore`/`ActivityLog`/
 * `ProcessManager` already use, so it stays fully unit-testable outside the
 * Extension Host.
 *
 * Refreshes only on the two events that can actually change a 1B result:
 * project re-detection (`ProjectStateStore`) and migration status changes.
 * Deliberately NOT subscribed to `ProcessManager.onDidChangeState` - no 1B
 * check depends on process state (DIAGNOSTICS-1A review, Correction B); that
 * subscription is left for a later package that actually needs it.
 *
 * Responsible for: running checks, aggregating results, holding the latest
 * set, firing a change event, isolating a failing check, and discarding a
 * stale (superseded) refresh. Not responsible for: UI, framework detection,
 * process execution, command execution, port checks, or health checks.
 */
export class DiagnosticsController {
  private results: readonly DiagnosticResult[] = [];
  private generation = 0;
  private readonly listeners = new Set<() => void>();
  private readonly disposables: Array<{ dispose(): void }> = [];

  public constructor(
    private readonly checks: readonly DiagnosticCheck[],
    private readonly projectState: ProjectStateStore,
    private readonly fileSystem: FileSystemProbe,
    migrationStatusReader: MigrationStatusReader,
    private readonly logCheckFailure: (message: string) => void
  ) {
    this.disposables.push(
      projectState.onDidChangeState(() => void this.refresh()),
      migrationStatusReader.onDidChangeStatus(() => void this.refresh())
    );
    void this.refresh();
  }

  public getResults(): readonly DiagnosticResult[] {
    return this.results;
  }

  public onDidChangeDiagnostics(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  /**
   * Runs every check against a freshly read snapshot of the current state,
   * tagged with a generation number. If a later refresh() call starts and
   * finishes before this one's checks resolve, this call's results are
   * discarded on arrival instead of overwriting the newer ones - the
   * smallest correct fix for the classic "slow refresh #1 finishes after
   * fast refresh #2" race, without an AbortController/queue/mutex.
   *
   * Fires the change event on every refresh that actually commits (is not
   * discarded as stale) - including when the new result set is identical to
   * the previous one. No result-diffing: a check that only detects "did the
   * output change" would need to compare `DiagnosticResult[]` deeply for no
   * consumer that exists yet (DIAGNOSTICS-1A review).
   */
  public async refresh(): Promise<void> {
    const generation = ++this.generation;
    const context: DiagnosticContext = {
      detectedProject: this.projectState.getState().detectedProject,
      fileSystem: this.fileSystem
    };

    const outcomes = await Promise.all(this.checks.map((check) => this.runSafely(check, context)));

    if (generation !== this.generation) {
      return;
    }

    this.results = outcomes.flat();
    for (const listener of this.listeners) {
      listener();
    }
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  /**
   * A throwing check is a technical/engine failure, not a user-facing
   * finding - it is logged and contributes no results, but never stops the
   * other checks in the same refresh from contributing theirs.
   */
  private async runSafely(check: DiagnosticCheck, context: DiagnosticContext): Promise<readonly DiagnosticResult[]> {
    try {
      return await check.run(context);
    } catch (error: unknown) {
      this.logCheckFailure(`Diagnostic check failed: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }
}
