import * as vscode from "vscode";
import { getWorkspaceTrustSnapshot, type WorkspaceTrustSnapshot } from "./workspaceTrustModel";

export class WorkspaceTrustService {
  public getSnapshot(): WorkspaceTrustSnapshot {
    return getWorkspaceTrustSnapshot(vscode.workspace.isTrusted);
  }

  public async ensureTrustedForExecution(operationLabel: string): Promise<boolean> {
    if (vscode.workspace.isTrusted) {
      return true;
    }

    await vscode.window.showWarningMessage(
      `${operationLabel} requires Workspace Trust because it may execute project code or workspace-configured tools.`
    );
    return false;
  }
}
