export interface WorkspaceTrustSnapshot {
  readonly isTrusted: boolean;
  readonly canInspectWorkspace: boolean;
  readonly canExecuteWorkspaceCode: boolean;
}

export function getWorkspaceTrustSnapshot(isTrusted: boolean): WorkspaceTrustSnapshot {
  return {
    isTrusted,
    canInspectWorkspace: true,
    canExecuteWorkspaceCode: isTrusted
  };
}
