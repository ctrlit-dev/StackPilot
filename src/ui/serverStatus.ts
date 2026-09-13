import type { ManagedProcessDescriptor, ManagedProcessState } from "../execution/processManager";

/**
 * A codicon id (e.g. "play", "sync~spin") plus an optional theme color token
 * (e.g. "charts.green"). Kept as plain data so both the tree view and the
 * status bar controller can turn it into their own vscode type
 * (ThemeIcon/ThemeColor vs. a "$(id)" text prefix + item.color) without this
 * shared module ever importing vscode itself.
 */
export interface StatusIcon {
  readonly id: string;
  readonly color?: string;
}

export const ICON_RUNNING: StatusIcon = { id: "pass-filled", color: "charts.green" };
export const ICON_STARTING: StatusIcon = { id: "sync~spin", color: "charts.yellow" };
export const ICON_STOPPING: StatusIcon = { id: "sync~spin", color: "charts.yellow" };
export const ICON_FAILED: StatusIcon = { id: "error", color: "charts.red" };
export const ICON_STOPPED: StatusIcon = { id: "circle-large-outline", color: "disabledForeground" };
export const ICON_UNKNOWN: StatusIcon = { id: "question", color: "disabledForeground" };
export const ICON_NOT_DETECTED: StatusIcon = { id: "circle-slash", color: "disabledForeground" };
export const ICON_BLOCKED: StatusIcon = { id: "warning", color: "charts.yellow" };

export function serverStateIcon(state: ManagedProcessState): StatusIcon {
  switch (state) {
    case "running":
      return ICON_RUNNING;
    case "starting":
      return ICON_STARTING;
    case "stopping":
      return ICON_STOPPING;
    case "failed":
      return ICON_FAILED;
    case "stopped":
      return ICON_STOPPED;
    case "unknown":
      return ICON_UNKNOWN;
  }
}

export function describeServerState(descriptor: ManagedProcessDescriptor, host?: string): string {
  const state: ManagedProcessState = descriptor.state;
  switch (state) {
    case "running":
      return descriptor.expectedPort === undefined ? "Running" : `Running · ${host ?? "127.0.0.1"}:${descriptor.expectedPort}`;
    case "starting":
      return "Starting…";
    case "stopping":
      return "Stopping…";
    case "failed":
      return "Failed";
    case "stopped":
      return "Stopped";
    case "unknown":
      return "Unknown";
  }
}
