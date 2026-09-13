import type { StackPilotConfiguration } from "../config/configurationModel";
import type { DetectedProject } from "../detection/projectDetector";
import type { WorkspaceSelectionResult } from "./workspaceSelectionModel";

export interface ProjectState {
  readonly selection: WorkspaceSelectionResult;
  readonly trusted: boolean;
  readonly detectedProject?: DetectedProject;
  readonly configuration?: StackPilotConfiguration;
}

export type ProjectStateListener = (state: ProjectState) => void;

/**
 * Single owner of "what does the extension currently believe about the
 * workspace" (spec §12: "Centralize lifecycle management. Do not scatter
 * process state through UI code." - the same principle applies to detection
 * state). Command handlers and the tree view both read from here instead of
 * each re-deriving or caching their own copy.
 */
export class ProjectStateStore {
  private state: ProjectState = { selection: { kind: "none" }, trusted: false };
  private readonly listeners = new Set<ProjectStateListener>();

  public getState(): ProjectState {
    return this.state;
  }

  public setState(state: ProjectState): void {
    this.state = state;
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  public onDidChangeState(listener: ProjectStateListener): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }
}
