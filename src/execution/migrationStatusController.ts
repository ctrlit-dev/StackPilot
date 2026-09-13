import * as vscode from "vscode";
import type { BackendFrameworkAdapter } from "../adapters/backendFrameworkAdapter";
import type { ProjectStateStore } from "../state/projectState";
import { runOneShotCommand } from "./oneShotCommand";
import type { ProcessSpawner } from "./processSpawner";

export type MigrationStatus = "unknown" | "checking" | "up-to-date" | "pending" | "unavailable";

/**
 * Backed entirely by `manage.py migrate --check`'s documented exit-code
 * contract (0 = up to date, 1 = unapplied migrations exist) - no output
 * parsing to guess a migration count, which Django's own flag does not
 * report anyway. The one wrinkle: a genuine failure (e.g. the database is
 * unreachable) also exits non-zero, but - unlike the clean "pending"
 * case - populates stderr with a traceback; checking for that keeps
 * "unavailable" from being misreported as "pending".
 */
export class MigrationStatusController implements vscode.Disposable {
  private status: MigrationStatus = "unknown";
  private checking = false;
  private readonly listeners = new Set<() => void>();
  private readonly disposables: vscode.Disposable[] = [];

  public constructor(
    private readonly spawner: ProcessSpawner,
    private readonly projectState: ProjectStateStore,
    private readonly backendAdapter: BackendFrameworkAdapter
  ) {
    this.disposables.push(projectState.onDidChangeState(() => void this.refresh()));
    void this.refresh();
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  public getStatus(): MigrationStatus {
    return this.status;
  }

  public onDidChangeStatus(listener: () => void): vscode.Disposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  private async refresh(): Promise<void> {
    if (this.checking) {
      return;
    }

    const state = this.projectState.getState();
    const backend = state.detectedProject?.backend.selected;
    const python = state.detectedProject?.python.selected;
    // Passive/automatic, so this only ever runs once the workspace is
    // already trusted - never prompts for trust on its own (spec-consistent
    // with detection itself never prompting).
    if (backend === undefined || python === undefined || !vscode.workspace.isTrusted) {
      this.setStatus("unknown");
      return;
    }

    this.checking = true;
    this.setStatus("checking");
    const result = await runOneShotCommand(this.spawner, this.backendAdapter.buildManagementCommand(python, backend, ["migrate", "--check"]));
    this.checking = false;

    if (result.outcome === "spawn-failed") {
      this.setStatus("unavailable");
      return;
    }
    if (result.exitCode === 0) {
      this.setStatus("up-to-date");
    } else if (result.exitCode === 1 && result.stderr.trim().length === 0) {
      this.setStatus("pending");
    } else {
      this.setStatus("unavailable");
    }
  }

  private setStatus(status: MigrationStatus): void {
    this.status = status;
    for (const listener of this.listeners) {
      listener();
    }
  }
}
