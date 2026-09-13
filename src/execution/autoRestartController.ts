import * as vscode from "vscode";
import type { ProjectStateStore } from "../state/projectState";
import { DEFAULT_CRASH_LOOP_POLICY, nextRestartDelayMs } from "./crashLoopPolicy";
import type { ManagedProcessDescriptor, ManagedProcessKind, ProcessManager } from "./processManager";

/** How long a server must stay running before a later crash counts as a fresh streak rather than a continuation. */
const STABILITY_WINDOW_MS = 10_000;

/**
 * Watches for a server exiting unexpectedly (ProcessManager's "failed" state,
 * as opposed to "stopped" from a deliberate user stop) and, when the user has
 * opted in via `stackPilot.backend/frontend.autoRestartOnCrash`, restarts
 * it with the exact command it was already running - no re-planning, no port-
 * conflict prompt, since this only ever repeats a start the user (or a prior
 * auto-restart) already approved for that session. Bounded by
 * DEFAULT_CRASH_LOOP_POLICY so a server that cannot start at all does not
 * loop forever.
 */
export class AutoRestartController implements vscode.Disposable {
  private readonly consecutiveFailures = new Map<ManagedProcessKind, number>();
  private readonly stabilityTimers = new Map<ManagedProcessKind, ReturnType<typeof setTimeout>>();
  private readonly disposables: vscode.Disposable[] = [];

  public constructor(
    private readonly processManager: ProcessManager,
    private readonly projectState: ProjectStateStore,
    private readonly outputChannel: vscode.OutputChannel
  ) {
    this.disposables.push(processManager.onDidChangeState((descriptor) => this.onStateChanged(descriptor)));
  }

  public dispose(): void {
    for (const timer of this.stabilityTimers.values()) {
      clearTimeout(timer);
    }
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private onStateChanged(descriptor: ManagedProcessDescriptor): void {
    if (descriptor.state === "running") {
      this.armStabilityTimer(descriptor.kind);
      return;
    }

    if (descriptor.state === "stopped") {
      // A deliberate stop, not a crash - forget the streak so a later crash starts fresh.
      this.clearStabilityTimer(descriptor.kind);
      this.consecutiveFailures.delete(descriptor.kind);
      return;
    }

    if (descriptor.state !== "failed") {
      return;
    }

    this.clearStabilityTimer(descriptor.kind);
    this.handleCrash(descriptor);
  }

  private handleCrash(descriptor: ManagedProcessDescriptor): void {
    if (!this.isAutoRestartEnabled(descriptor.kind)) {
      return;
    }
    if (descriptor.executable === undefined || descriptor.args === undefined || descriptor.cwd === undefined) {
      return;
    }

    const attempt = (this.consecutiveFailures.get(descriptor.kind) ?? 0) + 1;
    this.consecutiveFailures.set(descriptor.kind, attempt);

    const delay = nextRestartDelayMs(DEFAULT_CRASH_LOOP_POLICY, attempt);
    if (delay === undefined) {
      this.outputChannel.appendLine(
        `${descriptor.kind}: gave up auto-restarting after ${DEFAULT_CRASH_LOOP_POLICY.maxConsecutiveRestarts} consecutive crashes.`
      );
      void vscode.window.showErrorMessage(
        `StackPilot: the ${descriptor.kind} server keeps crashing and was not restarted automatically after ${DEFAULT_CRASH_LOOP_POLICY.maxConsecutiveRestarts} attempts. Fix the underlying error, then start it again manually.`
      );
      return;
    }

    this.outputChannel.appendLine(`${descriptor.kind}: crashed, auto-restarting in ${delay}ms (attempt ${attempt}).`);
    const { kind, executable, args, cwd, expectedPort } = descriptor;
    setTimeout(() => {
      void this.processManager.start(kind, { executable, args, cwd, expectedPort });
    }, delay);
  }

  private isAutoRestartEnabled(kind: ManagedProcessKind): boolean {
    const configuration = this.projectState.getState().configuration;
    if (configuration === undefined) {
      return false;
    }
    return kind === "backend" ? configuration.backendAutoRestart : configuration.frontendAutoRestart;
  }

  private armStabilityTimer(kind: ManagedProcessKind): void {
    this.clearStabilityTimer(kind);
    const timer = setTimeout(() => {
      this.consecutiveFailures.delete(kind);
    }, STABILITY_WINDOW_MS);
    this.stabilityTimers.set(kind, timer);
  }

  private clearStabilityTimer(kind: ManagedProcessKind): void {
    const timer = this.stabilityTimers.get(kind);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.stabilityTimers.delete(kind);
    }
  }
}
