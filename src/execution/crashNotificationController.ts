import * as vscode from "vscode";
import { COMMAND_START_BACKEND, COMMAND_START_FRONTEND } from "../constants";
import type { ProjectStateStore } from "../state/projectState";
import type { ManagedProcessDescriptor, ManagedProcessKind, ProcessManager } from "./processManager";
import type { ServerTerminalManager } from "./terminalManager";

/**
 * An active toast for an unexpected crash. AutoRestartController already
 * handles the crash itself when auto-restart is enabled for that server
 * (with its own "gave up after N attempts" notification) - this covers the
 * common case where auto-restart is off, where a crash would otherwise only
 * show up as a color change in the tree/dashboard/status bar that someone
 * might not be looking at.
 */
export class CrashNotificationController implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];

  public constructor(
    processManager: ProcessManager,
    private readonly projectState: ProjectStateStore,
    private readonly terminalManager: ServerTerminalManager
  ) {
    this.disposables.push(processManager.onDidChangeState((descriptor) => this.onStateChanged(descriptor)));
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private onStateChanged(descriptor: ManagedProcessDescriptor): void {
    if (descriptor.state !== "failed" || this.isAutoRestartEnabled(descriptor.kind)) {
      return;
    }
    void this.notify(descriptor);
  }

  private isAutoRestartEnabled(kind: ManagedProcessKind): boolean {
    const configuration = this.projectState.getState().configuration;
    if (configuration === undefined) {
      return false;
    }
    return kind === "backend" ? configuration.backendAutoRestart : configuration.frontendAutoRestart;
  }

  private async notify(descriptor: ManagedProcessDescriptor): Promise<void> {
    const label = descriptor.kind === "backend" ? "Backend" : "Frontend";
    const choice = await vscode.window.showErrorMessage(
      `StackPilot: ${label} crashed${descriptor.lastError === undefined ? "." : `: ${descriptor.lastError}`}`,
      "Restart",
      "Show Output"
    );

    if (choice === "Restart") {
      await vscode.commands.executeCommand(descriptor.kind === "backend" ? COMMAND_START_BACKEND : COMMAND_START_FRONTEND);
    } else if (choice === "Show Output") {
      this.terminalManager.reveal(descriptor.kind);
    }
  }
}
