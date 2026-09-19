import * as vscode from "vscode";
import {
  CONTEXT_BACKEND_RUNNING,
  CONTEXT_FRONTEND_RUNNING,
  CONTEXT_HAS_BACKEND,
  CONTEXT_HAS_DJANGO_BACKEND,
  CONTEXT_HAS_FRONTEND,
  CONTEXT_HAS_PYTHON,
  CONTEXT_HAS_PYTHON_BACKEND,
  CONTEXT_HAS_SELECTED_WORKSPACE,
  CONTEXT_HAS_WORKSPACE,
  CONTEXT_WORKSPACE_AMBIGUOUS,
  CONTEXT_WORKSPACE_TRUSTED
} from "../constants";
import { getBackendService, getDjangoMetadata, getFrontendService, type DetectedProject } from "../detection/detectedProject";
import type { ManagedProcessDescriptor } from "../execution/processManager";
import type { WorkspaceSelectionResult } from "./workspaceSelectionModel";

export async function updateWorkspaceContextKeys(
  selection: WorkspaceSelectionResult,
  workspaceTrusted: boolean,
  detectedProject?: DetectedProject
): Promise<void> {
  const backend = getBackendService(detectedProject);

  await Promise.all([
    vscode.commands.executeCommand("setContext", CONTEXT_HAS_WORKSPACE, selection.kind !== "none"),
    vscode.commands.executeCommand("setContext", CONTEXT_HAS_SELECTED_WORKSPACE, selection.kind === "selected"),
    vscode.commands.executeCommand("setContext", CONTEXT_WORKSPACE_AMBIGUOUS, selection.kind === "ambiguous"),
    vscode.commands.executeCommand("setContext", CONTEXT_WORKSPACE_TRUSTED, workspaceTrusted),
    vscode.commands.executeCommand("setContext", CONTEXT_HAS_BACKEND, backend !== undefined),
    vscode.commands.executeCommand("setContext", CONTEXT_HAS_DJANGO_BACKEND, getDjangoMetadata(backend) !== undefined),
    // EXPRESS-1C: "the detected backend service itself carries a Python
    // runtime" - never "some Python interpreter happens to be resolved"
    // (that would make this key false for a Django project that has no venv
    // yet, defeating the exact "Create Virtual Environment" action it
    // gates) and never "workspace-wide Python was found anywhere" (that is
    // CONTEXT_HAS_PYTHON, a separate, pre-existing, unrelated key).
    vscode.commands.executeCommand("setContext", CONTEXT_HAS_PYTHON_BACKEND, backend !== undefined && backend.runtime?.kind === "python"),
    vscode.commands.executeCommand("setContext", CONTEXT_HAS_FRONTEND, getFrontendService(detectedProject) !== undefined),
    vscode.commands.executeCommand("setContext", CONTEXT_HAS_PYTHON, detectedProject?.pythonRuntime.selected !== undefined)
  ]);
}

export async function updateProcessContextKeys(backend: ManagedProcessDescriptor, frontend: ManagedProcessDescriptor): Promise<void> {
  await Promise.all([
    vscode.commands.executeCommand("setContext", CONTEXT_BACKEND_RUNNING, backend.state === "running"),
    vscode.commands.executeCommand("setContext", CONTEXT_FRONTEND_RUNNING, frontend.state === "running")
  ]);
}
