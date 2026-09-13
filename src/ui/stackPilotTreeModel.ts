import type { StackPilotConfiguration } from "../config/configurationModel";
import type { DjangoApp } from "../detection/djangoAppDetector";
import type { DetectedProject } from "../detection/projectDetector";
import type { ManagedProcessDescriptor } from "../execution/processManager";
import { describeServerState, ICON_BLOCKED, ICON_NOT_DETECTED, serverStateIcon, type StatusIcon } from "./serverStatus";
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
}

export function buildStackPilotTree(input: TreeModelInput): TreeNode[] {
  return [buildBackendSection(input), buildFrontendSection(input), ...buildEnvironmentSection(input), buildToolsSection()];
}

function buildBackendSection(input: TreeModelInput): TreeNode {
  const backend = input.detectedProject?.backend.selected;

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
    children: [
      { id: "backend.makeMigrations", label: "Make Migrations", commandId: COMMAND_MAKE_MIGRATIONS, icon: { id: "diff-added" } },
      { id: "backend.migrate", label: "Migrate", commandId: COMMAND_MIGRATE, icon: { id: "arrow-up" } },
      { id: "backend.showMigrations", label: "Show Migrations", commandId: COMMAND_SHOW_MIGRATIONS, icon: { id: "list-tree" } },
      { id: "backend.shell", label: "Django Shell", commandId: COMMAND_OPEN_DJANGO_SHELL, icon: { id: "terminal" } },
      { id: "backend.dbShell", label: "Database Shell", commandId: COMMAND_OPEN_DB_SHELL, icon: { id: "database" } },
      { id: "backend.superuser", label: "Superuser", commandId: COMMAND_CREATE_SUPERUSER, icon: { id: "person-add" } },
      { id: "backend.createApp", label: "Create App", commandId: COMMAND_CREATE_DJANGO_APP, icon: { id: "new-folder" } },
      ...buildDjangoAppsSection(input.detectedProject?.djangoApps ?? []),
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
    ]
  };
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
  const frontend = input.detectedProject?.frontend.selected;

  if (frontend === undefined) {
    return {
      id: "frontend",
      label: "Frontend",
      description: "Not detected",
      contextValue: "frontendServer.notDetected",
      icon: ICON_NOT_DETECTED
    };
  }

  const packageManager = frontend.packageManager;
  const blocked = input.frontend.state === "stopped" && packageManager.kind !== "detected";

  const description = blocked
    ? packageManager.kind === "missing"
      ? "Package manager not found"
      : "Ambiguous package manager"
    : describeServerState(input.frontend);
  const tooltip = blocked
    ? packageManager.kind === "missing"
      ? packageManager.reason
      : `Multiple lockfiles found: ${packageManager.candidates.map((candidate) => candidate.manager).join(", ")}`
    : input.frontend.lastError;
  const contextValue = blocked ? "frontendServer.blocked" : `frontendServer.${input.frontend.state}`;
  const icon = blocked ? ICON_BLOCKED : serverStateIcon(input.frontend.state);

  const children: TreeNode[] = [];
  if (packageManager.kind === "detected") {
    children.push({
      id: "frontend.installDependencies",
      label: "Install Dependencies",
      commandId: COMMAND_INSTALL_FRONTEND_DEPENDENCIES,
      icon: { id: "package" }
    });
    if (input.configuration !== undefined && Object.hasOwn(frontend.scripts, input.configuration.frontendBuildScript)) {
      children.push({ id: "frontend.build", label: "Build", commandId: COMMAND_BUILD_FRONTEND, icon: { id: "tools" } });
    }
    if (input.configuration !== undefined && Object.hasOwn(frontend.scripts, input.configuration.frontendTestScript)) {
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

  const python = input.detectedProject.python.selected;
  const frontend = input.detectedProject.frontend.selected;

  const children: TreeNode[] = [
    {
      id: "environment.python",
      label: "Python",
      description: python === undefined ? "Not detected" : describePython(python.version, python.executablePath),
      tooltip: python?.executablePath,
      icon: python === undefined ? ICON_NOT_DETECTED : { id: "circuit-board" }
    }
  ];

  if (input.detectedProject.backend.selected !== undefined && python?.source !== "venv") {
    children.push({
      id: "environment.createVenv",
      label: "Create Virtual Environment",
      commandId: COMMAND_CREATE_VIRTUAL_ENVIRONMENT,
      icon: { id: "add" }
    });
  }

  if (frontend !== undefined) {
    children.push({
      id: "environment.packageManager",
      label: "Package Manager",
      description: describePackageManager(frontend.packageManager),
      icon: frontend.packageManager.kind === "detected" ? { id: "package" } : ICON_BLOCKED
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

function describePython(version: string | undefined, executablePath: string): string {
  return version === undefined ? executablePath : `${version} · ${executablePath}`;
}

function describePackageManager(
  packageManager: NonNullable<DetectedProject["frontend"]["selected"]>["packageManager"]
): string {
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
