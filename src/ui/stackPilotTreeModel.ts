import type { StackPilotConfiguration } from "../config/configurationModel";
import type { DjangoApp } from "../detection/djangoAppDetector";
import {
  getBackendService,
  getDjangoMetadata,
  getFrontendService,
  getNodeRuntime,
  type DetectedProject,
  type DetectedService
} from "../detection/detectedProject";
import type { PackageManagerDetection } from "../detection/packageManagerDetector";
import type { DiagnosticResult, DiagnosticSeverity } from "../diagnostics/diagnostic";
import type { ManagedProcessDescriptor } from "../execution/processManager";
import { describeServerState, ICON_BLOCKED, ICON_FAILED, ICON_NOT_DETECTED, serverStateIcon, type StatusIcon } from "./serverStatus";
import {
  COMMAND_BUILD_FRONTEND,
  COMMAND_CREATE_DJANGO_APP,
  COMMAND_CREATE_SUPERUSER,
  COMMAND_CREATE_PROJECT,
  COMMAND_CREATE_VIRTUAL_ENVIRONMENT,
  COMMAND_GENERATE_DEBUG_CONFIG,
  COMMAND_INITIALIZE_PROJECT,
  COMMAND_INSTALL_FRONTEND_DEPENDENCIES,
  COMMAND_INSTALL_PYTHON_DEPENDENCIES,
  COMMAND_MAKE_MIGRATIONS,
  COMMAND_MIGRATE,
  COMMAND_OPEN_BACKEND_ENV_FILE,
  COMMAND_OPEN_DASHBOARD,
  COMMAND_OPEN_DB_SHELL,
  COMMAND_OPEN_DEV_TOOLS,
  COMMAND_OPEN_DJANGO_SHELL,
  COMMAND_OPEN_FRONTEND_ENV_FILE,
  COMMAND_OPEN_LOGS,
  COMMAND_OPEN_SETTINGS,
  COMMAND_REFRESH,
  COMMAND_RUN_DJANGO_TESTS,
  COMMAND_RUN_FRONTEND_SCRIPT,
  COMMAND_RUN_FRONTEND_TESTS,
  COMMAND_RUN_MANAGEMENT_COMMAND,
  COMMAND_SHOW_MIGRATIONS
} from "../constants";

/**
 * Plain, vscode-free tree model (spec §3: "Tree items should represent
 * meaningful resources or state", not a raw command list). A thin
 * TreeDataProvider adapter maps this to vscode.TreeItem so the actual
 * decision logic stays unit-testable without the Extension Host.
 */
export interface TreeNode {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly tooltip?: string;
  readonly contextValue?: string;
  readonly commandId?: string;
  readonly icon?: TreeNodeIcon;
  readonly children?: readonly TreeNode[];
}

/** Re-exported under this file's own naming; the shape itself lives in ./serverStatus so the status bar can share it. */
export type TreeNodeIcon = StatusIcon;

export interface TreeModelInput {
  readonly detectedProject?: DetectedProject;
  readonly configuration?: StackPilotConfiguration;
  readonly backend: ManagedProcessDescriptor;
  readonly frontend: ManagedProcessDescriptor;
  /** Already-computed results from DiagnosticsController - this model never runs a check itself. */
  readonly diagnostics: readonly DiagnosticResult[];
}

export function buildStackPilotTree(input: TreeModelInput): TreeNode[] {
  return [
    buildBackendSection(input),
    buildFrontendSection(input),
    ...buildEnvironmentSection(input),
    ...buildDiagnosticsSection(input),
    buildToolsSection()
  ];
}

function buildBackendSection(input: TreeModelInput): TreeNode {
  const backend = getBackendService(input.detectedProject);

  if (backend === undefined) {
    return {
      id: "backend",
      label: "Backend",
      description: "Not detected",
      contextValue: "backendServer.notDetected",
      icon: ICON_NOT_DETECTED
    };
  }

  return {
    id: "backend",
    label: "Backend",
    description: describeServerState(input.backend, input.configuration?.backendHost),
    tooltip: input.backend.lastError,
    contextValue: `backendServer.${input.backend.state}`,
    icon: serverStateIcon(input.backend.state),
    children: buildBackendOperationRows(backend)
  };
}

/**
 * These operation rows (migrations, shell, superuser, ...) are all
 * manage.py-shaped Django operations - showing them for a detected backend
 * whose framework is not actually Django (e.g. FastAPI) would be
 * objectively false ("Django Shell" for a project with no Django at all).
 * Omitted entirely, rather than shown-but-erroring, for any non-Django
 * backend - this phase adds no FastAPI-specific operation rows.
 */
function buildBackendOperationRows(backend: DetectedService): TreeNode[] | undefined {
  const djangoMetadata = getDjangoMetadata(backend);
  if (djangoMetadata === undefined) {
    return undefined;
  }

  return [
    { id: "backend.makeMigrations", label: "Make Migrations", commandId: COMMAND_MAKE_MIGRATIONS, icon: { id: "diff-added" } },
    { id: "backend.migrate", label: "Migrate", commandId: COMMAND_MIGRATE, icon: { id: "arrow-up" } },
    { id: "backend.showMigrations", label: "Show Migrations", commandId: COMMAND_SHOW_MIGRATIONS, icon: { id: "list-tree" } },
    { id: "backend.shell", label: "Django Shell", commandId: COMMAND_OPEN_DJANGO_SHELL, icon: { id: "terminal" } },
    { id: "backend.dbShell", label: "Database Shell", commandId: COMMAND_OPEN_DB_SHELL, icon: { id: "database" } },
    { id: "backend.superuser", label: "Superuser", commandId: COMMAND_CREATE_SUPERUSER, icon: { id: "person-add" } },
    { id: "backend.createApp", label: "Create App", commandId: COMMAND_CREATE_DJANGO_APP, icon: { id: "new-folder" } },
    ...buildDjangoAppsSection(djangoMetadata.apps),
    { id: "backend.test", label: "Tests", commandId: COMMAND_RUN_DJANGO_TESTS, icon: { id: "beaker" } },
    {
      id: "backend.installDependencies",
      label: "Install Dependencies",
      commandId: COMMAND_INSTALL_PYTHON_DEPENDENCIES,
      icon: { id: "package" }
    },
    {
      id: "backend.envFile",
      label: "Environment Variables (.env)",
      tooltip: "Opens backend/.env, creating it from a .env.example/.env.sample/.env.template if one exists and .env does not yet.",
      commandId: COMMAND_OPEN_BACKEND_ENV_FILE,
      icon: { id: "key" }
    },
    {
      id: "backend.runManagementCommand",
      label: "Run Management Command…",
      commandId: COMMAND_RUN_MANAGEMENT_COMMAND,
      icon: { id: "run" }
    }
  ];
}

/**
 * One leaf row per detected Django app (right-click for per-app actions -
 * see djangoAppCommands.ts). Omitted entirely when none were found, rather
 * than showing an empty "Apps" node.
 */
function buildDjangoAppsSection(apps: readonly DjangoApp[]): TreeNode[] {
  if (apps.length === 0) {
    return [];
  }

  return [
    {
      id: "backend.apps",
      label: "Apps",
      icon: { id: "folder-library" },
      children: apps.map((app) => ({
        id: `backend.apps.${app.name}`,
        label: app.name,
        tooltip: app.path,
        contextValue: "djangoApp",
        icon: { id: "symbol-namespace" }
      }))
    }
  ];
}

function buildFrontendSection(input: TreeModelInput): TreeNode {
  const frontend = getFrontendService(input.detectedProject);

  if (frontend === undefined) {
    return {
      id: "frontend",
      label: "Frontend",
      description: "Not detected",
      contextValue: "frontendServer.notDetected",
      icon: ICON_NOT_DETECTED
    };
  }

  const runtime = getNodeRuntime(frontend);
  const packageManager = runtime?.packageManager;
  const blocked = input.frontend.state === "stopped" && packageManager?.kind !== "detected";

  const description = blocked
    ? packageManager?.kind === "missing"
      ? "Package manager not found"
      : "Ambiguous package manager"
    : describeServerState(input.frontend);
  const tooltip = blocked
    ? packageManager?.kind === "missing"
      ? packageManager.reason
      : `Multiple lockfiles found: ${packageManager?.kind === "ambiguous" ? packageManager.candidates.map((candidate) => candidate.manager).join(", ") : ""}`
    : input.frontend.lastError;
  const contextValue = blocked ? "frontendServer.blocked" : `frontendServer.${input.frontend.state}`;
  const icon = blocked ? ICON_BLOCKED : serverStateIcon(input.frontend.state);

  const children: TreeNode[] = [];
  if (packageManager?.kind === "detected" && runtime !== undefined) {
    children.push({
      id: "frontend.installDependencies",
      label: "Install Dependencies",
      commandId: COMMAND_INSTALL_FRONTEND_DEPENDENCIES,
      icon: { id: "package" }
    });
    if (input.configuration !== undefined && Object.hasOwn(runtime.scripts, input.configuration.frontendBuildScript)) {
      children.push({ id: "frontend.build", label: "Build", commandId: COMMAND_BUILD_FRONTEND, icon: { id: "tools" } });
    }
    if (input.configuration !== undefined && Object.hasOwn(runtime.scripts, input.configuration.frontendTestScript)) {
      children.push({ id: "frontend.test", label: "Tests", commandId: COMMAND_RUN_FRONTEND_TESTS, icon: { id: "beaker" } });
    }
    children.push({
      id: "frontend.envFile",
      label: "Environment Variables (.env)",
      tooltip: "Opens frontend/.env, creating it from a .env.example/.env.sample/.env.template if one exists and .env does not yet.",
      commandId: COMMAND_OPEN_FRONTEND_ENV_FILE,
      icon: { id: "key" }
    });
    children.push({ id: "frontend.runScript", label: "Run Script…", commandId: COMMAND_RUN_FRONTEND_SCRIPT, icon: { id: "run" } });
  }

  return {
    id: "frontend",
    label: "Frontend",
    description,
    tooltip,
    contextValue,
    icon,
    children: children.length === 0 ? undefined : children
  };
}

function buildEnvironmentSection(input: TreeModelInput): TreeNode[] {
  if (input.detectedProject === undefined) {
    return [];
  }

  const python = input.detectedProject.pythonRuntime.selected;
  const frontend = getFrontendService(input.detectedProject);
  const frontendPackageManager = getNodeRuntime(frontend)?.packageManager;

  const children: TreeNode[] = [
    {
      id: "environment.python",
      label: "Python",
      description: python === undefined ? "Not detected" : describePython(python.version, python.executablePath),
      tooltip: python?.executablePath,
      icon: python === undefined ? ICON_NOT_DETECTED : { id: "circuit-board" }
    }
  ];

  // EXPRESS-1C: only a Python-runtime backend (Django/FastAPI) can ever use
  // a virtual environment - a Node-runtime backend (Express) must never see
  // this row, regardless of whether the workspace has no venv-sourced
  // Python at all. This row is built independently of the
  // `stackPilot.hasPythonBackend` context key (it is plain TypeScript, not
  // a `package.json` `when`/`enablement` clause), so it needs its own guard.
  const backend = getBackendService(input.detectedProject);
  if (backend !== undefined && backend.runtime?.kind === "python" && python?.source !== "venv") {
    children.push({
      id: "environment.createVenv",
      label: "Create Virtual Environment",
      commandId: COMMAND_CREATE_VIRTUAL_ENVIRONMENT,
      icon: { id: "add" }
    });
  }

  if (frontend !== undefined && frontendPackageManager !== undefined) {
    children.push({
      id: "environment.packageManager",
      label: "Package Manager",
      description: describePackageManager(frontendPackageManager),
      icon: frontendPackageManager.kind === "detected" ? { id: "package" } : ICON_BLOCKED
    });
  }

  return [
    {
      id: "environment",
      label: "Environment",
      icon: { id: "server-environment" },
      children
    }
  ];
}

/**
 * Pure consumer of already-computed results - runs no check, no filesystem
 * probe, no process spawn (spec: "Tree führt keine Checks aus"). Omitted
 * entirely before a project is detected at all, mirroring
 * buildEnvironmentSection()'s own precedent, rather than showing a premature
 * "healthy" section for an unselected workspace.
 */
function buildDiagnosticsSection(input: TreeModelInput): TreeNode[] {
  if (input.detectedProject === undefined) {
    return [];
  }

  const diagnostics = input.diagnostics;

  if (diagnostics.length === 0) {
    return [
      {
        id: "diagnostics",
        label: "Diagnostics",
        icon: { id: "pass-filled", color: "charts.green" },
        // Presentation only - never a synthetic "success" DiagnosticResult.
        children: [{ id: "diagnostics.healthy", label: "No issues detected", icon: { id: "check", color: "charts.green" } }]
      }
    ];
  }

  return [
    {
      id: "diagnostics",
      label: "Diagnostics",
      description: `${diagnostics.length} issue${diagnostics.length === 1 ? "" : "s"}`,
      icon: worstDiagnosticSeverityIcon(diagnostics),
      // Same order DiagnosticsController produced them in - no second severity sort, so Tree and Dashboard stay consistent.
      children: diagnostics.map((diagnostic) => buildDiagnosticNode(diagnostic))
    }
  ];
}

/** One row per DiagnosticResult, rendered generically - no code-specific text, no action inferred beyond `diagnostic.action` itself. */
function buildDiagnosticNode(diagnostic: DiagnosticResult): TreeNode {
  return {
    id: `diagnostics.${diagnostic.code}`,
    label: diagnostic.message,
    description: diagnostic.action?.label,
    tooltip: describeSeverity(diagnostic.severity),
    icon: diagnosticSeverityIcon(diagnostic.severity),
    commandId: diagnostic.action?.commandId
  };
}

function worstDiagnosticSeverityIcon(diagnostics: readonly DiagnosticResult[]): TreeNodeIcon {
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return diagnosticSeverityIcon("error");
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === "warning")) {
    return diagnosticSeverityIcon("warning");
  }
  return diagnosticSeverityIcon("info");
}

/**
 * Distinct icon shape per severity, not just color. Duplicated in miniature
 * from dashboardPanelController.ts's own equivalent (deliberately - see
 * DIAGNOSTICS-1D report) rather than sharing it from there, to keep the
 * Dashboard file itself untouched.
 */
function diagnosticSeverityIcon(severity: DiagnosticSeverity): TreeNodeIcon {
  switch (severity) {
    case "error":
      return ICON_FAILED;
    case "warning":
      return ICON_BLOCKED;
    case "info":
      return { id: "info", color: "charts.blue" };
  }
}

function describeSeverity(severity: DiagnosticSeverity): string {
  switch (severity) {
    case "error":
      return "Error";
    case "warning":
      return "Warning";
    case "info":
      return "Info";
  }
}

function describePython(version: string | undefined, executablePath: string): string {
  return version === undefined ? executablePath : `${version} · ${executablePath}`;
}

function describePackageManager(packageManager: PackageManagerDetection): string {
  switch (packageManager.kind) {
    case "detected":
      return packageManager.manager;
    case "missing":
      return "Not detected";
    case "ambiguous":
      return `Ambiguous (${packageManager.candidates.map((candidate) => candidate.manager).join(", ")})`;
  }
}

function buildToolsSection(): TreeNode {
  return {
    id: "tools",
    label: "Tools",
    icon: { id: "tools" },
    children: [
      { id: "tools.newProject", label: "New Project", commandId: COMMAND_CREATE_PROJECT, icon: { id: "new-folder" } },
      { id: "tools.initializeProject", label: "Initialize Project", commandId: COMMAND_INITIALIZE_PROJECT, icon: { id: "rocket" } },
      { id: "tools.openDashboard", label: "Open Dashboard", commandId: COMMAND_OPEN_DASHBOARD, icon: { id: "open-preview" } },
      { id: "tools.devTools", label: "Dev Tools", commandId: COMMAND_OPEN_DEV_TOOLS, icon: { id: "wrench" } },
      {
        id: "tools.generateDebugConfig",
        label: "Generate Debug Configuration",
        commandId: COMMAND_GENERATE_DEBUG_CONFIG,
        icon: { id: "debug" }
      },
      { id: "tools.refresh", label: "Refresh Detection", commandId: COMMAND_REFRESH, icon: { id: "refresh" } },
      { id: "tools.openLogs", label: "Open Logs", commandId: COMMAND_OPEN_LOGS, icon: { id: "output" } },
      { id: "tools.openSettings", label: "Open Settings", commandId: COMMAND_OPEN_SETTINGS, icon: { id: "gear" } }
    ]
  };
}
