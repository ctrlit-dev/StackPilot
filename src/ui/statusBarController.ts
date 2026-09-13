import * as vscode from "vscode";
import { COMMAND_TOGGLE_BACKEND, COMMAND_TOGGLE_FRONTEND } from "../constants";
import type { ManagedProcessDescriptor, ManagedProcessState, ProcessManager } from "../execution/processManager";
import type { ProjectStateStore } from "../state/projectState";
import { describeServerState, serverStateIcon } from "./serverStatus";

const TOGGLEABLE_STATES: readonly ManagedProcessState[] = ["running", "starting"];

/**
 * At-a-glance server status without opening the sidebar (spec-consistent
 * with the tree view - same status text/icon logic from ./serverStatus,
 * just rendered as "$(icon) Label" status bar text instead of a
 * vscode.ThemeIcon). Clicking either item starts or stops that server.
 */
export class ServerStatusBarController implements vscode.Disposable {
  private readonly backendItem: vscode.StatusBarItem;
  private readonly frontendItem: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];

  public constructor(
    private readonly projectState: ProjectStateStore,
    private readonly processManager: ProcessManager
  ) {
    this.backendItem = vscode.window.createStatusBarItem("stackPilot.backendStatus", vscode.StatusBarAlignment.Left, 100);
    this.backendItem.name = "StackPilot: Django Server";
    this.backendItem.command = COMMAND_TOGGLE_BACKEND;

    this.frontendItem = vscode.window.createStatusBarItem("stackPilot.frontendStatus", vscode.StatusBarAlignment.Left, 99);
    this.frontendItem.name = "StackPilot: Frontend Server";
    this.frontendItem.command = COMMAND_TOGGLE_FRONTEND;

    this.disposables.push(
      this.backendItem,
      this.frontendItem,
      projectState.onDidChangeState(() => this.refresh()),
      processManager.onDidChangeState(() => this.refresh())
    );

    this.refresh();
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private refresh(): void {
    const state = this.projectState.getState();
    this.updateItem(
      this.backendItem,
      "Django",
      state.detectedProject?.backend.selected !== undefined,
      this.processManager.getState("backend"),
      state.configuration?.backendHost
    );
    this.updateItem(
      this.frontendItem,
      "Frontend",
      state.detectedProject?.frontend.selected !== undefined,
      this.processManager.getState("frontend"),
      undefined
    );
  }

  private updateItem(
    item: vscode.StatusBarItem,
    label: string,
    detected: boolean,
    descriptor: ManagedProcessDescriptor,
    host: string | undefined
  ): void {
    if (!detected) {
      item.hide();
      return;
    }

    const icon = serverStateIcon(descriptor.state);
    const action = TOGGLEABLE_STATES.includes(descriptor.state) ? "stop" : "start";
    item.text = `$(${icon.id}) ${label}`;
    item.color = icon.color === undefined ? undefined : new vscode.ThemeColor(icon.color);
    item.tooltip = `${label}: ${describeServerState(descriptor, host)}${
      descriptor.lastError === undefined ? "" : `\n${descriptor.lastError}`
    }\nClick to ${action}.`;
    item.show();
  }
}
