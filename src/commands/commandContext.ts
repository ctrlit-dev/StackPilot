import type * as vscode from "vscode";
import type { BackendFrameworkAdapter } from "../adapters/backendFrameworkAdapter";
import type { FileSystemProbe } from "../detection/fileSystem";
import type { FrontendUrlTracker } from "../execution/frontendUrlTracker";
import type { InteractiveTerminalManager } from "../execution/interactiveTerminalManager";
import type { OperationTerminal } from "../execution/operationTerminal";
import type { PortChecker } from "../execution/portAvailability";
import type { ProcessManager } from "../execution/processManager";
import type { ProcessSpawner } from "../execution/processSpawner";
import type { ServerTerminalManager } from "../execution/terminalManager";
import type { ProjectFileWriter } from "../project/projectFileWriter";
import type { WorkspaceTrustService } from "../security/workspaceTrust";
import type { ActivityLog } from "../state/activityLog";
import type { ProjectStateStore } from "../state/projectState";

export interface CommandContext {
  readonly outputChannel: vscode.OutputChannel;
  readonly fileSystem: FileSystemProbe;
  readonly projectFileWriter: ProjectFileWriter;
  readonly projectState: ProjectStateStore;
  readonly processManager: ProcessManager;
  readonly backendAdapter: BackendFrameworkAdapter;
  readonly spawner: ProcessSpawner;
  readonly portChecker: PortChecker;
  readonly terminalManager: ServerTerminalManager;
  readonly frontendUrlTracker: FrontendUrlTracker;
  readonly operationTerminal: OperationTerminal;
  readonly interactiveTerminals: InteractiveTerminalManager;
  readonly workspaceTrust: WorkspaceTrustService;
  readonly activityLog: ActivityLog;
}
