import * as vscode from "vscode";
import {
  CONTEXT_BACKEND_RUNNING,
  CONTEXT_FRONTEND_RUNNING,
  CONTEXT_HAS_BACKEND,
  CONTEXT_HAS_FRONTEND,
  CONTEXT_HAS_PYTHON,
  CONTEXT_HAS_SELECTED_WORKSPACE,
  CONTEXT_HAS_WORKSPACE,
  CONTEXT_WORKSPACE_AMBIGUOUS,
  CONTEXT_WORKSPACE_TRUSTED
} from "../constants";
import type { DetectedProject } from "../detection/projectDetector";
import type { ManagedProcessDescriptor } from "../execution/processManager";
import type { WorkspaceSelectionResult } from "./workspaceSelectionModel";

export async function updateWorkspaceContextKeys(
  selection: WorkspaceSelectionResult,
  workspaceTrusted: boolean,
  detectedProject?: DetectedProject
): Promise<void> {
  await Promise.all([
    vscode.commands.executeCommand("setContext", CONTEXT_HAS_WORKSPACE, selection.kind !== "none"),
    vscode.commands.executeCommand("setContext", CONTEXT_HAS_SELECTED_WORKSPACE, selection.kind === "selected"),
    vscode.commands.executeCommand("setContext", CONTEXT_WORKSPACE_AMBIGUOUS, selection.kind === "ambiguous"),
    vscode.commands.executeCommand("setContext", CONTEXT_WORKSPACE_TRUSTED, workspaceTrusted),
    vscode.commands.executeCommand("setContext", CONTEXT_HAS_BACKEND, detectedProject?.backend.selected !== undefined),
    vscode.commands.executeCommand("setContext", CONTEXT_HAS_FRONTEND, detectedProject?.frontend.selected !== undefined),
    vscode.commands.executeCommand("setContext", CONTEXT_HAS_PYTHON, detectedProject?.python.selected !== undefined)
  ]);
}

export async function updateProcessContextKeys(backend: ManagedProcessDescriptor, frontend: ManagedProcessDescriptor): Promise<void> {
  await Promise.all([
    vscode.commands.executeCommand("setContext", CONTEXT_BACKEND_RUNNING, backend.state === "running"),
    vscode.commands.executeCommand("setContext", CONTEXT_FRONTEND_RUNNING, frontend.state === "running")
  ]);
}
