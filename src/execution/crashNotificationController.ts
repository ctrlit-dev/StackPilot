import * as vscode from "vscode";
import type { ManagedProcessDescriptor, ProcessManager } from "./processManager";
import type { ServiceLifecyclePolicyProvider } from "./serviceLifecyclePolicy";
import type { ServerTerminalManager } from "./terminalManager";

/**
 * An active toast for an unexpected crash. AutoRestartController already
 * handles the crash itself when auto-restart is enabled for that service
 * (with its own "gave up after N attempts" notification) - this covers the
 * common case where auto-restart is off, where a crash would otherwise only
 * show up as a color change in the tree/dashboard/status bar that someone
 * might not be looking at. The service's display label and whether it
 * offers a "Restart" action both come from the injected
 * `ServiceLifecyclePolicyProvider` - this controller has no knowledge of
 * which services exist or what to call them.
 */
export class CrashNotificationController implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];

  public constructor(
    processManager: ProcessManager,
    private readonly policyProvider: ServiceLifecyclePolicyProvider,
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
    if (descriptor.state !== "failed" || this.policyProvider.getPolicy(descriptor.kind).autoRestartEnabled) {
      return;
    }
    void this.notify(descriptor);
  }

  private async notify(descriptor: ManagedProcessDescriptor): Promise<void> {
    const policy = this.policyProvider.getPolicy(descriptor.kind);
    const actions = policy.restartCommandId === undefined ? ["Show Output"] : ["Restart", "Show Output"];

    const choice = await vscode.window.showErrorMessage(
      `StackPilot: ${policy.displayName} crashed${descriptor.lastError === undefined ? "." : `: ${descriptor.lastError}`}`,
      ...actions
    );

    if (choice === "Restart" && policy.restartCommandId !== undefined) {
      await vscode.commands.executeCommand(policy.restartCommandId);
    } else if (choice === "Show Output") {
      this.terminalManager.reveal(descriptor.kind);
    }
  }
}
