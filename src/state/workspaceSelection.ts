import * as vscode from "vscode";
import { resolveWorkspaceSelection, type WorkspaceFolderReference, type WorkspaceSelectionResult } from "./workspaceSelectionModel";

const SELECTED_WORKSPACE_URI_KEY = "stackPilot.selectedWorkspaceFolderUri";

export class WorkspaceSelectionService {
  public constructor(private readonly workspaceState: vscode.Memento) {}

  public getCurrentSelection(): WorkspaceSelectionResult {
    return resolveWorkspaceSelection(getWorkspaceFolderReferences(), this.workspaceState.get<string>(SELECTED_WORKSPACE_URI_KEY));
  }

  public async selectWorkspaceFolder(): Promise<WorkspaceSelectionResult> {
    const folders = getWorkspaceFolderReferences();
    if (folders.length === 0) {
      await vscode.window.showInformationMessage("StackPilot: open a workspace folder before selecting a project root.");
      return { kind: "none" };
    }

    if (folders.length === 1) {
      await this.workspaceState.update(SELECTED_WORKSPACE_URI_KEY, undefined);
      return {
        kind: "selected",
        folder: folders[0],
        source: "single-folder"
      };
    }

    const selected = await vscode.window.showQuickPick(
      folders.map((folder) => ({
        label: folder.name,
        description: folder.uri,
        folder
      })),
      {
        title: "StackPilot: Select Workspace Folder",
        placeHolder: "Choose the workspace folder StackPilot should manage"
      }
    );

    if (selected === undefined) {
      return this.getCurrentSelection();
    }

    await this.workspaceState.update(SELECTED_WORKSPACE_URI_KEY, selected.folder.uri);
    return {
      kind: "selected",
      folder: selected.folder,
      source: "user"
    };
  }
}

function getWorkspaceFolderReferences(): WorkspaceFolderReference[] {
  return (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
    uri: folder.uri.toString(),
    name: folder.name,
    index: folder.index
  }));
}
