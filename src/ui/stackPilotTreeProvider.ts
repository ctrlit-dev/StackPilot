import * as vscode from "vscode";
import type { DiagnosticsController } from "../diagnostics/diagnosticsController";
import type { ManagedProcessDescriptor, ProcessManager } from "../execution/processManager";
import type { ProjectStateStore } from "../state/projectState";
import { buildStackPilotTree, type TreeNode } from "./stackPilotTreeModel";

/**
 * Thin vscode.TreeDataProvider adapter over the pure tree model - all
 * decision logic (what to show, which contextValue enables which inline
 * action) lives in stackPilotTreeModel.ts and is unit-tested there. This
 * class only translates that plain data into vscode.TreeItem and refreshes
 * on state changes.
 */
export class StackPilotTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<TreeNode | undefined>();
  public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private readonly disposables: vscode.Disposable[] = [];
  private backend: ManagedProcessDescriptor = { kind: "backend", state: "stopped" };
  private frontend: ManagedProcessDescriptor = { kind: "frontend", state: "stopped" };

  public constructor(
    private readonly projectState: ProjectStateStore,
    processManager: ProcessManager,
    private readonly diagnosticsController: DiagnosticsController
  ) {
    this.backend = processManager.getState("backend");
    this.frontend = processManager.getState("frontend");

    this.disposables.push(
      projectState.onDidChangeState(() => this.refresh()),
      processManager.onDidChangeState((descriptor) => {
        this.setDescriptor(descriptor);
        this.refresh();
      }),
      // Rebuilds the VS Code tree representation from cached results only -
      // never calls diagnosticsController.refresh() itself (that would create
      // a refresh -> tree-change -> refresh loop).
      this.diagnosticsController.onDidChangeDiagnostics(() => this.refresh())
    );
  }

  public getTreeItem(node: TreeNode): vscode.TreeItem {
    const collapsibleState =
      node.children === undefined ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Expanded;
    const item = new vscode.TreeItem(node.label, collapsibleState);
    item.id = node.id;
    item.description = node.description;
    item.tooltip = node.tooltip;
    item.contextValue = node.contextValue;
    if (node.icon !== undefined) {
      item.iconPath = new vscode.ThemeIcon(node.icon.id, node.icon.color === undefined ? undefined : new vscode.ThemeColor(node.icon.color));
    }
    if (node.commandId !== undefined) {
      item.command = { command: node.commandId, title: node.label };
    }
    return item;
  }

  public getChildren(node?: TreeNode): TreeNode[] {
    if (node !== undefined) {
      return [...(node.children ?? [])];
    }

    const state = this.projectState.getState();
    return buildStackPilotTree({
      detectedProject: state.detectedProject,
      configuration: state.configuration,
      backend: this.backend,
      frontend: this.frontend,
      diagnostics: this.diagnosticsController.getResults()
    });
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.onDidChangeTreeDataEmitter.dispose();
  }

  private setDescriptor(descriptor: ManagedProcessDescriptor): void {
    if (descriptor.kind === "backend") {
      this.backend = descriptor;
    } else {
      this.frontend = descriptor;
    }
  }

  private refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }
}
