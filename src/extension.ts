import * as vscode from "vscode";
import { djangoBackendAdapter } from "./adapters/djangoBackendAdapter";
import { djangoBackendDetection } from "./adapters/djangoBackendDetection";
import { expressBackendAdapter } from "./adapters/expressBackendAdapter";
import { expressBackendDetection } from "./adapters/expressBackendDetection";
import { fastApiBackendAdapter } from "./adapters/fastApiBackendAdapter";
import { fastApiBackendDetection } from "./adapters/fastApiBackendDetection";
import { viteFrontendAdapter } from "./adapters/viteFrontendAdapter";
import { viteFrontendDetection } from "./adapters/viteFrontendDetection";
import { registerCommands } from "./commands/registerCommands";
import { readStackPilotConfiguration } from "./config/configuration";
import {
  COMMAND_OPEN_DASHBOARD,
  COMMAND_OPEN_DEV_TOOLS,
  COMMAND_REFRESH,
  COMMAND_SELECT_WORKSPACE,
  DASHBOARD_PANEL_VIEW_TYPE,
  OUTPUT_CHANNEL_NAME,
  VIEW_ID
} from "./constants";
import { getBackendService, getFrontendService } from "./detection/detectedProject";
import { NodeFileSystemProbe } from "./detection/nodeFileSystem";
import { detectProject } from "./detection/projectDetector";
import { createDjangoMigrationsCheck } from "./diagnostics/checks/djangoMigrationsCheck";
import { frameworkDependencyCheck } from "./diagnostics/checks/frameworkDependencyCheck";
import { nodeDependenciesCheck } from "./diagnostics/checks/nodeDependenciesCheck";
import { pythonEnvironmentCheck } from "./diagnostics/checks/pythonEnvironmentCheck";
import { DiagnosticsController } from "./diagnostics/diagnosticsController";
import { RatingPromptController } from "./engagement/ratingPromptController";
import { AutoRestartController } from "./execution/autoRestartController";
import { CrashNotificationController } from "./execution/crashNotificationController";
import { FrontendUrlTracker } from "./execution/frontendUrlTracker";
import { InteractiveTerminalManager } from "./execution/interactiveTerminalManager";
import { MigrationStatusController } from "./execution/migrationStatusController";
import { NodeProcessSpawner } from "./execution/nodeProcessSpawner";
import { OperationTerminal } from "./execution/operationTerminal";
import { NodePortChecker } from "./execution/portAvailability";
import { ProcessManager } from "./execution/processManager";
import { createDefaultServiceLifecyclePolicyProvider } from "./execution/serviceLifecyclePolicy";
import { DEFAULT_SERVICE_REGISTRY } from "./execution/serviceRegistry";
import { ServerTerminalManager } from "./execution/terminalManager";
import { NodeProjectFileWriter } from "./project/nodeProjectFileWriter";
import { WorkspaceTrustService } from "./security/workspaceTrust";
import { ActivityLog } from "./state/activityLog";
import { updateProcessContextKeys, updateWorkspaceContextKeys } from "./state/contextKeys";
import { ProjectStateStore } from "./state/projectState";
import { WorkspaceSelectionService } from "./state/workspaceSelection";
import { TestSuiteController } from "./testing/testSuiteController";
import { backendTestSuitePlan, frontendTestSuitePlan } from "./testing/testSuitePlan";
import { DashboardPanelController } from "./ui/dashboardPanelController";
import { StackPilotTreeProvider } from "./ui/stackPilotTreeProvider";
import { ServerStatusBarController } from "./ui/statusBarController";

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  const workspaceSelection = new WorkspaceSelectionService(context.workspaceState);
  const workspaceTrust = new WorkspaceTrustService();
  const fileSystem = new NodeFileSystemProbe();
  const projectFileWriter = new NodeProjectFileWriter();
  const spawner = new NodeProcessSpawner();
  const processManager = new ProcessManager(spawner, DEFAULT_SERVICE_REGISTRY);
  const portChecker = new NodePortChecker();
  const terminalManager = new ServerTerminalManager(processManager);
  const frontendUrlTracker = new FrontendUrlTracker(viteFrontendAdapter);
  const operationTerminal = new OperationTerminal();
  const interactiveTerminals = new InteractiveTerminalManager();
  const projectState = new ProjectStateStore();
  const activityLog = new ActivityLog();

  outputChannel.appendLine("StackPilot activated.");

  const refreshState = async (): Promise<void> => {
    const selection = workspaceSelection.getCurrentSelection();

    if (selection.kind !== "selected") {
      projectState.setState({ selection, trusted: workspaceTrust.getSnapshot().isTrusted });
      await updateWorkspaceContextKeys(selection, workspaceTrust.getSnapshot().isTrusted);
      return;
    }

    const selectedWorkspaceUri = vscode.Uri.parse(selection.folder.uri);
    const configuration = readStackPilotConfiguration(selectedWorkspaceUri);
    for (const diagnostic of configuration.diagnostics) {
      outputChannel.appendLine(`Configuration warning (${diagnostic.setting}): ${diagnostic.message}`);
    }

    const detectedProject = await detectProject(
      fileSystem,
      selectedWorkspaceUri.fsPath,
      configuration.value,
      [djangoBackendDetection, fastApiBackendDetection, expressBackendDetection],
      viteFrontendDetection
    );
    for (const diagnostic of detectedProject.diagnostics) {
      outputChannel.appendLine(`Detection warning: ${diagnostic}`);
    }
    outputChannel.appendLine(`Detection summary: ${summarizeDetection(detectedProject)}`);

    projectState.setState({
      selection,
      trusted: workspaceTrust.getSnapshot().isTrusted,
      detectedProject,
      configuration: configuration.value
    });
    await updateWorkspaceContextKeys(selection, workspaceTrust.getSnapshot().isTrusted, detectedProject);
  };

  const migrationStatusController = new MigrationStatusController(spawner, projectState, djangoBackendAdapter);

  // Consumed by DashboardPanelController's Project Health section and by
  // StackPilotTreeProvider's Diagnostics section below. Refreshes only on
  // events that can actually change a result; deliberately not subscribed
  // to processManager.onDidChangeState.
  const diagnosticsController = new DiagnosticsController(
    [pythonEnvironmentCheck, frameworkDependencyCheck, nodeDependenciesCheck, createDjangoMigrationsCheck(migrationStatusController)],
    projectState,
    fileSystem,
    migrationStatusController,
    (message) => outputChannel.appendLine(`[Diagnostics] ${message}`)
  );

  const treeProvider = new StackPilotTreeProvider(projectState, processManager, diagnosticsController);
  const treeView = vscode.window.createTreeView(VIEW_ID, { treeDataProvider: treeProvider });
  const statusBar = new ServerStatusBarController(projectState, processManager);
  const dashboardController = new DashboardPanelController(
    projectState,
    processManager,
    context.extensionUri,
    activityLog,
    diagnosticsController,
    context.extension
  );
  const openDashboardCommand = vscode.commands.registerCommand(COMMAND_OPEN_DASHBOARD, () => dashboardController.open());
  const openDevToolsCommand = vscode.commands.registerCommand(COMMAND_OPEN_DEV_TOOLS, () => dashboardController.open("devtools"));
  const dashboardSerializer = vscode.window.registerWebviewPanelSerializer(DASHBOARD_PANEL_VIEW_TYPE, {
    deserializeWebviewPanel: (panel) => {
      dashboardController.attach(panel);
      return Promise.resolve();
    }
  });
  const serviceLifecyclePolicyProvider = createDefaultServiceLifecyclePolicyProvider(projectState);
  const autoRestartController = new AutoRestartController(processManager, serviceLifecyclePolicyProvider, outputChannel);
  const crashNotificationController = new CrashNotificationController(processManager, serviceLifecyclePolicyProvider, terminalManager);
  const ratingPromptController = new RatingPromptController(context.globalState, context.extension, processManager);

  const djangoTestController = new TestSuiteController(
    "stackPilotDjangoTests",
    "Django Tests",
    spawner,
    projectState,
    workspaceTrust,
    (state) => backendTestSuitePlan(state.detectedProject, djangoBackendAdapter)
  );
  const frontendTestController = new TestSuiteController(
    "stackPilotFrontendTests",
    "Frontend Tests",
    spawner,
    projectState,
    workspaceTrust,
    (state) => frontendTestSuitePlan(state.detectedProject, state.configuration?.frontendTestScript ?? "test")
  );

  const updateRunningBadge = (): void => {
    const runningCount = (["backend", "frontend"] as const).filter(
      (kind) => processManager.getState(kind).state === "running"
    ).length;
    treeView.badge =
      runningCount === 0 ? undefined : { value: runningCount, tooltip: `${runningCount} server${runningCount === 1 ? "" : "s"} running` };
  };
  updateRunningBadge();

  const refreshCommand = vscode.commands.registerCommand(COMMAND_REFRESH, async () => {
    await refreshState();
    outputChannel.appendLine("Refresh requested.");
    void vscode.window.showInformationMessage("StackPilot: detection refreshed. See the output channel for details.");
  });

  const selectWorkspaceCommand = vscode.commands.registerCommand(COMMAND_SELECT_WORKSPACE, async () => {
    const selection = await workspaceSelection.selectWorkspaceFolder();
    await updateWorkspaceContextKeys(selection, workspaceTrust.getSnapshot().isTrusted);
    outputChannel.appendLine(`Workspace selection state: ${selection.kind}.`);
    await refreshState();
  });

  const otherCommands = registerCommands({
    outputChannel,
    fileSystem,
    projectFileWriter,
    projectState,
    processManager,
    backendAdapter: djangoBackendAdapter,
    backendStartAdapters: [djangoBackendAdapter, fastApiBackendAdapter, expressBackendAdapter],
    spawner,
    portChecker,
    terminalManager,
    frontendUrlTracker,
    operationTerminal,
    interactiveTerminals,
    workspaceTrust,
    activityLog
  });

  context.subscriptions.push(
    outputChannel,
    treeView,
    treeProvider,
    statusBar,
    dashboardController,
    openDashboardCommand,
    openDevToolsCommand,
    dashboardSerializer,
    migrationStatusController,
    diagnosticsController,
    autoRestartController,
    crashNotificationController,
    ratingPromptController,
    djangoTestController,
    frontendTestController,
    terminalManager,
    operationTerminal,
    interactiveTerminals,
    refreshCommand,
    selectWorkspaceCommand,
    ...otherCommands,
    processManager.onDidChangeState((descriptor) => {
      void updateProcessContextKeys(processManager.getState("backend"), processManager.getState("frontend"));
      updateRunningBadge();
      if (descriptor.kind === "frontend" && descriptor.state === "starting") {
        frontendUrlTracker.reset();
      }
      outputChannel.appendLine(
        `${descriptor.kind} ${descriptor.state}${descriptor.lastError === undefined ? "" : `: ${descriptor.lastError}`}`
      );
      const label = serviceLifecyclePolicyProvider.getPolicy(descriptor.kind).displayName;
      if (descriptor.state === "running") {
        activityLog.record(`${label} started`, "success");
      } else if (descriptor.state === "stopped") {
        activityLog.record(`${label} stopped`, "info");
      } else if (descriptor.state === "failed") {
        activityLog.record(`${label} crashed`, "failure");
      }
    }),
    processManager.onDidReceiveOutput((kind, chunk) => {
      if (kind === "frontend") {
        frontendUrlTracker.feed(chunk);
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void refreshState();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("stackPilot")) {
        void refreshState();
      }
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      void refreshState();
    })
  );

  void updateProcessContextKeys(processManager.getState("backend"), processManager.getState("frontend"));
  void refreshState();

  activeProcessManager = processManager;
  context.subscriptions.push({
    dispose: () => {
      if (activeProcessManager === processManager) {
        activeProcessManager = undefined;
      }
    }
  });
}

// Extension-owned dev servers are stopped on deactivation (spec §49): VS Code
// does not await async work from deactivate() reliably in all shutdown paths,
// but a best-effort stop still avoids leaving orphan processes on a normal
// disable/reload.
let activeProcessManager: ProcessManager | undefined;

export function deactivate(): Thenable<unknown> | undefined {
  return activeProcessManager?.stopAll();
}

function summarizeDetection(project: Awaited<ReturnType<typeof detectProject>>): string {
  const backendService = getBackendService(project);
  const frontendService = getFrontendService(project);
  const backend = backendService === undefined ? "backend not detected" : `backend at ${backendService.rootPath}`;
  const frontend = frontendService === undefined ? "frontend not detected" : `frontend at ${frontendService.rootPath}`;
  const python = project.pythonRuntime.selected === undefined ? "python not detected" : `python at ${project.pythonRuntime.selected.executablePath}`;
  return `${backend}; ${frontend}; ${python}.`;
}
