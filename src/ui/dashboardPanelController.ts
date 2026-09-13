import * as vscode from "vscode";
import {
  COMMAND_BUILD_FRONTEND,
  COMMAND_COPY_BACKEND_URL,
  COMMAND_COPY_FRONTEND_URL,
  COMMAND_CREATE_DJANGO_APP,
  COMMAND_CREATE_PROJECT,
  COMMAND_CREATE_SUPERUSER,
  COMMAND_GENERATE_DEBUG_CONFIG,
  COMMAND_INITIALIZE_PROJECT,
  COMMAND_INSTALL_FRONTEND_DEPENDENCIES,
  COMMAND_INSTALL_PYTHON_DEPENDENCIES,
  COMMAND_MAKE_MIGRATIONS,
  COMMAND_MIGRATE,
  COMMAND_OPEN_ADMIN,
  COMMAND_OPEN_APPLICATION,
  COMMAND_OPEN_BACKEND_ENV_FILE,
  COMMAND_OPEN_DB_SHELL,
  COMMAND_OPEN_DJANGO_SHELL,
  COMMAND_OPEN_FRONTEND_ENV_FILE,
  COMMAND_OPEN_LOGS,
  COMMAND_OPEN_SETTINGS,
  COMMAND_OPEN_SIMPLE_BROWSER,
  COMMAND_REFRESH,
  COMMAND_RUN_DJANGO_TESTS,
  COMMAND_RUN_FRONTEND_SCRIPT,
  COMMAND_RUN_FRONTEND_TESTS,
  COMMAND_RUN_MANAGEMENT_COMMAND,
  COMMAND_SHOW_MIGRATIONS,
  COMMAND_TOGGLE_BACKEND,
  COMMAND_TOGGLE_FRONTEND,
  DASHBOARD_PANEL_VIEW_TYPE
} from "../constants";
import type { DjangoApp } from "../detection/djangoAppDetector";
import type { FrontendProject } from "../detection/frontendDetector";
import type { PythonEnvironment } from "../detection/pythonDetector";
import type { MigrationStatusController } from "../execution/migrationStatusController";
import type { ManagedProcessDescriptor, ManagedProcessKind, ProcessManager } from "../execution/processManager";
import type { ActivityEntry, ActivityLog } from "../state/activityLog";
import type { ProjectState, ProjectStateStore } from "../state/projectState";
import { describeServerState, ICON_BLOCKED, serverStateIcon } from "./serverStatus";

/** How many trailing lines of raw server output the Dashboard shows per server - a glance, not a log viewer. */
const LOG_PREVIEW_LINE_COUNT = 6;
/** Server output can arrive in rapid bursts; this avoids re-rendering the whole webview on every single chunk. */
const OUTPUT_RENDER_DEBOUNCE_MS = 400;

/** Mirrors the keybindings declared in package.json - shown in the Help tab so they're actually discoverable. */
const MODIFIER_PREFIX = process.platform === "darwin" ? "Cmd" : "Ctrl";
const KEYBINDING_START_ALL = `${MODIFIER_PREFIX}+Alt+R`;
const KEYBINDING_STOP_ALL = `${MODIFIER_PREFIX}+Alt+Shift+R`;
const KEYBINDING_OPEN_DASHBOARD = `${MODIFIER_PREFIX}+Alt+D`;

interface ActionTile {
  readonly label: string;
  readonly icon: string;
  readonly commandId: string;
}

const BACKEND_TILES: readonly ActionTile[] = [
  { label: "Make Migrations", icon: "diff-added", commandId: COMMAND_MAKE_MIGRATIONS },
  { label: "Migrate", icon: "arrow-up", commandId: COMMAND_MIGRATE },
  { label: "Show Migrations", icon: "list-tree", commandId: COMMAND_SHOW_MIGRATIONS },
  { label: "Django Shell", icon: "terminal", commandId: COMMAND_OPEN_DJANGO_SHELL },
  { label: "Database Shell", icon: "database", commandId: COMMAND_OPEN_DB_SHELL },
  { label: "Superuser", icon: "person-add", commandId: COMMAND_CREATE_SUPERUSER },
  { label: "Create App", icon: "new-folder", commandId: COMMAND_CREATE_DJANGO_APP },
  { label: "Run Tests", icon: "beaker", commandId: COMMAND_RUN_DJANGO_TESTS },
  { label: "Install Dependencies", icon: "package", commandId: COMMAND_INSTALL_PYTHON_DEPENDENCIES },
  { label: "Environment Variables (.env)", icon: "key", commandId: COMMAND_OPEN_BACKEND_ENV_FILE },
  { label: "Run Management Command…", icon: "run", commandId: COMMAND_RUN_MANAGEMENT_COMMAND }
];

const PROJECT_TILES: readonly ActionTile[] = [
  { label: "New Project", icon: "new-folder", commandId: COMMAND_CREATE_PROJECT },
  { label: "Initialize Project", icon: "rocket", commandId: COMMAND_INITIALIZE_PROJECT },
  { label: "Generate Debug Configuration", icon: "debug", commandId: COMMAND_GENERATE_DEBUG_CONFIG },
  { label: "Refresh Detection", icon: "refresh", commandId: COMMAND_REFRESH },
  { label: "Open Logs", icon: "output", commandId: COMMAND_OPEN_LOGS },
  { label: "Open Settings", icon: "gear", commandId: COMMAND_OPEN_SETTINGS }
];

interface WebviewMessage {
  readonly type?: string;
  readonly id?: string;
  readonly path?: string;
  readonly url?: string;
}

/**
 * Opens as a normal editor tab (vscode.window.createWebviewPanel), not a
 * sidebar view - a deliberate choice so it's something you open when you
 * want it rather than a second panel permanently competing for sidebar
 * space with the tree. Every action tile posts the exact same command id
 * the tree already uses (see COMMAND_* imports) - this view adds no new
 * execution paths, only a differently organized way to reach the existing
 * ones plus a compact status/overview and a Help tab.
 */
export class DashboardPanelController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly recentOutput = new Map<ManagedProcessKind, string[]>();
  private outputRenderTimer: ReturnType<typeof setTimeout> | undefined;

  public constructor(
    private readonly projectState: ProjectStateStore,
    private readonly processManager: ProcessManager,
    private readonly extensionUri: vscode.Uri,
    private readonly activityLog: ActivityLog,
    private readonly migrationStatusController: MigrationStatusController,
    private readonly extension: vscode.Extension<unknown>
  ) {
    this.disposables.push(
      processManager.onDidChangeState((descriptor) => {
        if (descriptor.state === "starting") {
          this.recentOutput.delete(descriptor.kind);
        }
        this.render();
      }),
      projectState.onDidChangeState(() => this.render()),
      activityLog.onDidChange(() => this.render()),
      migrationStatusController.onDidChangeStatus(() => this.render()),
      processManager.onDidReceiveOutput((kind, chunk) => this.appendOutput(kind, chunk))
    );
  }

  public dispose(): void {
    this.panel?.dispose();
    if (this.outputRenderTimer !== undefined) {
      clearTimeout(this.outputRenderTimer);
    }
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private appendOutput(kind: ManagedProcessKind, chunk: string): void {
    const lines = this.recentOutput.get(kind) ?? [];
    const incoming = chunk.split(/\r?\n/).filter((line) => line.length > 0);
    const updated = [...lines, ...incoming].slice(-LOG_PREVIEW_LINE_COUNT);
    this.recentOutput.set(kind, updated);

    if (this.outputRenderTimer !== undefined) {
      clearTimeout(this.outputRenderTimer);
    }
    this.outputRenderTimer = setTimeout(() => {
      this.outputRenderTimer = undefined;
      this.render();
    }, OUTPUT_RENDER_DEBOUNCE_MS);
  }

  public open(): void {
    if (this.panel !== undefined) {
      this.panel.reveal();
      return;
    }
    this.attach(
      vscode.window.createWebviewPanel(DASHBOARD_PANEL_VIEW_TYPE, "StackPilot Dashboard", vscode.ViewColumn.Active, {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "resources", "codicons")]
      })
    );
  }

  /** Shared wiring for both a freshly created panel and one restored by DashboardPanelSerializer after a window reload. */
  public attach(panel: vscode.WebviewPanel): void {
    this.panel = panel;
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "resources", "codicons")]
    };
    panel.webview.onDidReceiveMessage((message: WebviewMessage) => {
      if (message.type === "command" && message.id !== undefined) {
        void vscode.commands.executeCommand(message.id);
      } else if (message.type === "revealApp" && message.path !== undefined) {
        void vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(message.path));
      } else if (message.type === "openExternal" && message.url !== undefined) {
        void vscode.env.openExternal(vscode.Uri.parse(message.url));
      } else if (message.type === "reportProblem") {
        void this.reportProblem();
      }
    });
    panel.onDidDispose(() => {
      this.panel = undefined;
    });
    this.render();
  }

  private render(): void {
    if (this.panel === undefined) {
      return;
    }
    this.panel.webview.html = this.buildHtml(this.panel.webview);
  }

  /**
   * A GitHub repository is required for "Star on GitHub" to mean anything -
   * this reads whatever `repository`/`bugs`/`homepage` package.json ends up
   * with once the project has one, rather than a URL hardcoded here now.
   * Until then it resolves to undefined and the button stays hidden, the
   * same "dormant until the metadata exists" approach as the rating prompt.
   */
  private getGithubRepositoryUrl(): string | undefined {
    const packageJson = this.extension.packageJSON as {
      readonly repository?: unknown;
      readonly homepage?: unknown;
    };
    const raw =
      typeof packageJson.repository === "string"
        ? packageJson.repository
        : typeof (packageJson.repository as { url?: unknown } | undefined)?.url === "string"
          ? (packageJson.repository as { url: string }).url
          : typeof packageJson.homepage === "string"
            ? packageJson.homepage
            : undefined;
    if (raw === undefined) {
      return undefined;
    }
    const cleaned = raw.replace(/^git\+/, "").replace(/\.git$/, "");
    if (!cleaned.includes("github.com")) {
      return undefined;
    }
    // Require an actual owner/repo path, not just a profile URL like
    // "https://github.com/ctrlit-dev" - otherwise "Star on GitHub" and the
    // issue-reporting deep link below both resolve to a 404.
    const path = cleaned.replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\/+$/, "");
    return path.split("/").filter(Boolean).length >= 2 ? cleaned : undefined;
  }

  /** Explicit `bugs` metadata only - used as a plain fallback link for non-GitHub issue trackers. */
  private getConfiguredBugsUrl(): string | undefined {
    const packageJson = this.extension.packageJSON as { readonly bugs?: unknown };
    const bugs = packageJson.bugs;
    if (typeof bugs === "string") {
      return bugs;
    }
    if (typeof (bugs as { url?: unknown } | undefined)?.url === "string") {
      return (bugs as { url: string }).url;
    }
    return undefined;
  }

  private async reportProblem(): Promise<void> {
    const diagnostics = this.buildDiagnosticsText();
    const repoUrl = this.getGithubRepositoryUrl();

    if (repoUrl !== undefined) {
      // A real owner/repo URL: build a prefilled "new issue" deep link directly,
      // rather than through `bugs.url` (which conventionally already points at
      // ".../issues" and would double up to ".../issues/issues/new").
      const body = encodeURIComponent(`\n\n---\n${diagnostics}`);
      await vscode.env.openExternal(vscode.Uri.parse(`${repoUrl}/issues/new?body=${body}`));
      return;
    }

    const issueTrackerUrl = this.getConfiguredBugsUrl();
    if (issueTrackerUrl !== undefined) {
      await vscode.env.openExternal(vscode.Uri.parse(issueTrackerUrl));
      return;
    }

    // No issue tracker configured yet: still make reporting a problem
    // useful today, by getting the diagnostic info in front of the user
    // (clipboard, to paste wherever they end up reporting it) and the
    // Output channel (the detail behind whatever they saw go wrong).
    await vscode.env.clipboard.writeText(diagnostics);
    await vscode.commands.executeCommand(COMMAND_OPEN_LOGS);
    void vscode.window.showInformationMessage(
      "StackPilot: no issue tracker is configured yet. Diagnostic info was copied to your clipboard - paste it wherever you'd like to report this."
    );
  }

  private buildDiagnosticsText(): string {
    const state = this.projectState.getState();
    const backend = state.detectedProject?.backend.selected;
    const frontend = state.detectedProject?.frontend.selected;
    const python = state.detectedProject?.python.selected;
    const version = (this.extension.packageJSON as { readonly version?: unknown }).version;

    return [
      `StackPilot: ${typeof version === "string" ? version : "unknown"}`,
      `VS Code: ${vscode.version}`,
      `Platform: ${process.platform}`,
      `Backend detected: ${backend === undefined ? "no" : "yes"}`,
      `Frontend detected: ${frontend === undefined ? "no" : "yes"}`,
      `Python: ${python === undefined ? "not detected" : (python.version ?? "version unknown")}`
    ].join("\n");
  }

  private buildHtml(webview: vscode.Webview): string {
    const nonce = createNonce();
    const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "resources", "codicons", "codicon.css"));
    const state = this.projectState.getState();

    const body =
      state.selection.kind !== "selected"
        ? `${this.header(undefined)}<p class="muted">Select a workspace folder to get started.</p>`
        : `${this.header(state.selection.folder.name)}
           ${this.tabBar()}
           <section class="tab-panel" data-tab-panel="overview" role="tabpanel">${this.buildOverviewTab(state)}</section>
           <section class="tab-panel" data-tab-panel="help" role="tabpanel" hidden>${this.buildHelpTab()}</section>`;

    return this.page(nonce, codiconsUri, webview.cspSource, body);
  }

  private header(workspaceName: string | undefined): string {
    return `<header class="page-header">
      <div class="page-header-text">
        <h1>StackPilot</h1>
        <p>${workspaceName === undefined ? "No workspace selected" : escapeHtml(workspaceName)}</p>
      </div>
      <button class="icon-button" title="Refresh Detection" aria-label="Refresh Detection" data-command-id="${COMMAND_REFRESH}">${codiconGlyph("refresh")}</button>
    </header>`;
  }

  private tabBar(): string {
    return `<div class="tab-bar" role="tablist">
      <button class="tab-button" role="tab" data-tab="overview">Overview</button>
      <button class="tab-button" role="tab" data-tab="help">Help</button>
    </div>`;
  }

  private buildOverviewTab(state: ProjectState): string {
    const backend = state.detectedProject?.backend.selected;
    const frontend = state.detectedProject?.frontend.selected;
    const python = state.detectedProject?.python.selected;
    const djangoApps = state.detectedProject?.djangoApps ?? [];
    const backendDescriptor = this.processManager.getState("backend");
    const frontendDescriptor = this.processManager.getState("frontend");
    const canOpenApplication = backendDescriptor.state === "running" || frontendDescriptor.state === "running";

    const statCards = [
      serverStatCard(
        "Backend",
        "server-process",
        backend !== undefined,
        backendDescriptor,
        COMMAND_TOGGLE_BACKEND,
        state.configuration?.backendHost,
        [
          { icon: "copy", title: "Copy URL", commandId: COMMAND_COPY_BACKEND_URL },
          { icon: "account", title: "Open Admin", commandId: COMMAND_OPEN_ADMIN }
        ],
        this.recentOutput.get("backend") ?? []
      ),
      serverStatCard(
        "Frontend",
        "browser",
        frontend !== undefined,
        frontendDescriptor,
        COMMAND_TOGGLE_FRONTEND,
        undefined,
        [{ icon: "copy", title: "Copy URL", commandId: COMMAND_COPY_FRONTEND_URL }],
        this.recentOutput.get("frontend") ?? []
      ),
      pythonStatCard(python),
      packageManagerStatCard(frontend)
    ].join("\n");

    const sections = [`<div class="stat-grid">${statCards}</div>`];

    if (backend !== undefined && this.migrationStatusController.getStatus() === "pending") {
      sections.push(
        `<div class="row action alert" role="button" tabindex="0" data-command-id="${COMMAND_MIGRATE}">${codiconGlyph("warning")}<span class="label">Unapplied migrations - click to migrate</span></div>`
      );
    }

    if (canOpenApplication) {
      sections.push(
        `<div class="row action open-app" role="button" tabindex="0" data-command-id="${COMMAND_OPEN_APPLICATION}">${codiconGlyph("link-external")}<span class="label">Open Application in Browser</span></div>`
      );
      sections.push(
        `<div class="row action open-app" role="button" tabindex="0" data-command-id="${COMMAND_OPEN_SIMPLE_BROWSER}">${codiconGlyph("preview")}<span class="label">Open in Simple Browser</span></div>`
      );
    }

    const recentActivity = this.activityLog.getRecent(6);
    if (recentActivity.length > 0) {
      sections.push(section("Recent Activity", "history", "charts.blue", `<div class="activity-list">${buildActivityList(recentActivity)}</div>`));
    }

    if (djangoApps.length > 0) {
      sections.push(section("Django Apps", "symbol-namespace", "charts.orange", `<div class="app-grid">${buildAppsOverview(djangoApps)}</div>`));
    }

    const tileGroups: string[] = [];
    if (backend !== undefined) {
      tileGroups.push(tileGroup("Backend", "charts.green", BACKEND_TILES));
    }
    if (frontend !== undefined && frontend.packageManager.kind === "detected") {
      tileGroups.push(tileGroup("Frontend", "charts.blue", buildFrontendTiles(frontend, state)));
    }
    tileGroups.push(tileGroup("Project", "charts.purple", PROJECT_TILES));
    sections.push(section("Quick Actions", "zap", "charts.yellow", tileGroups.join("\n")));

    return sections.join("\n");
  }

  private buildHelpTab(): string {
    const githubUrl = this.getGithubRepositoryUrl();

    return `
    <section class="section">
      <h2>${iconBadge("book", "charts.blue", "small")}Guide</h2>
      <div class="guide-grid">
        <div class="tip-card">
          <h3>1. Detect your project</h3>
          <p>Opening a workspace with a <code>manage.py</code> and/or a frontend <code>package.json</code> auto-detects Django and Vite. If nothing shows up, run <strong>Refresh Detection</strong> after adding those files, or check <strong>Initialize Project</strong> if it's an existing, not-yet-wired-up project.</p>
        </div>
        <div class="tip-card">
          <h3>2. Start &amp; stop servers</h3>
          <p>Use the Start/Stop buttons on the status cards above, the tree's inline buttons, the status bar items, or <strong>Start All</strong> / <strong>Stop All</strong> (${KEYBINDING_START_ALL} / ${KEYBINDING_STOP_ALL}). Output streams into a dedicated terminal per server; the last few lines also show right on each status card here.</p>
        </div>
        <div class="tip-card">
          <h3>3. Django day-to-day</h3>
          <p>Make Migrations, Migrate, Django Shell, Database Shell, and Create Superuser all live under Quick Actions and in the tree's Backend section. <strong>Create App</strong> also offers to add the new app to <code>INSTALLED_APPS</code> automatically.</p>
        </div>
        <div class="tip-card">
          <h3>4. Django apps</h3>
          <p>Detected apps (folders with <code>apps.py</code>, or <code>models.py</code> + <code>migrations/</code>) are listed under Django Apps. Right-click one in the tree for per-app actions - migrations and tests scoped to just that app.</p>
        </div>
        <div class="tip-card">
          <h3>5. Frontend workflow</h3>
          <p>Install Dependencies, Build, Run Tests, and <strong>Run Script…</strong> (any package.json script, not just the configured ones) are all available once a package manager is unambiguously detected (single lockfile).</p>
        </div>
        <div class="tip-card">
          <h3>6. Environment &amp; secrets</h3>
          <p><strong>Environment Variables (.env)</strong> opens each side's <code>.env</code>, creating it from a <code>.env.example</code>/<code>.env.sample</code>/<code>.env.template</code> if one exists and <code>.env</code> doesn't yet. An existing <code>.env</code> is never overwritten.</p>
        </div>
        <div class="tip-card">
          <h3>7. Debugging</h3>
          <p><strong>Generate Debug Configuration</strong> writes a debugpy + Chrome launch.json (plus a combined compound if both sides are detected), using the exact interpreter this extension already detected - no need to hand-configure the Python path.</p>
        </div>
        <div class="tip-card">
          <h3>8. Tests</h3>
          <p>Both Django and frontend tests also show up in VS Code's native Testing panel (the flask icon). It's whole-suite, not per-test - parsing every possible test framework's output reliably wasn't realistic to get right.</p>
        </div>
        <div class="tip-card">
          <h3>9. New projects</h3>
          <p><strong>New Project</strong> scaffolds a fresh Django + Vite project end-to-end (venv, starter app, npm/pnpm/yarn/bun frontend, optional git init) - nothing is created until you confirm the final summary.</p>
        </div>
        <div class="tip-card">
          <h3>10. Auto-restart &amp; crash alerts</h3>
          <p>Off by default. Turn on <code>stackPilot.backend/frontend.autoRestartOnCrash</code> to auto-restart after an unexpected exit (up to 3 attempts, with backoff). With it off, a crash instead shows an immediate notification with Restart/Show Output actions.</p>
        </div>
      </div>
    </section>
    <section class="section">
      <h2>${iconBadge("lightbulb", "charts.yellow", "small")}Common Issues</h2>
      <div class="tip-grid">
        <div class="tip-card">
          <h3>No Python interpreter found</h3>
          <p>Windows sometimes only has the Microsoft Store "App execution alias" for <code>python.exe</code>, which is not a real interpreter. Install Python from <code>python.org</code> with "Add to PATH" checked, or set <code>stackPilot.python.interpreter</code> directly.</p>
        </div>
        <div class="tip-card">
          <h3>Port already in use</h3>
          <p>Starting a server offers a free port automatically; change the default in Settings if it happens often.</p>
        </div>
        <div class="tip-card">
          <h3>Ambiguous package manager</h3>
          <p>Shown when more than one lockfile (npm/pnpm/yarn/bun) is present - set <code>stackPilot.frontend.packageManager</code> to pick one.</p>
        </div>
        <div class="tip-card">
          <h3>"Migrations pending" won't clear</h3>
          <p>This checks <code>manage.py migrate --check</code>'s exit code. If your database itself is unreachable, that also exits non-zero - check Show Output on the backend card for the real error.</p>
        </div>
      </div>
    </section>
    <section class="section">
      <h2>${iconBadge("record-keys", "charts.purple", "small")}Keyboard Shortcuts</h2>
      <div class="tip-grid">
        <div class="tip-card"><h3>Start All</h3><p>${KEYBINDING_START_ALL}</p></div>
        <div class="tip-card"><h3>Stop All</h3><p>${KEYBINDING_STOP_ALL}</p></div>
        <div class="tip-card"><h3>Open Dashboard</h3><p>${KEYBINDING_OPEN_DASHBOARD}</p></div>
      </div>
    </section>
    <section class="section">
      <h2>${iconBadge("heart", "charts.red", "small")}Support This Project</h2>
      <div class="tile-grid">
        <button class="tile" data-report-problem="true">${iconBadge("bug", "charts.red", "small")}<span>Report a Problem</span></button>
        ${
          githubUrl === undefined
            ? ""
            : `<button class="tile" data-external-url="${escapeHtml(githubUrl)}">${iconBadge("github", "foreground", "small")}<span>Star on GitHub</span></button>`
        }
      </div>
    </section>
    <section class="section">
      <h2>${iconBadge("link", "charts.green", "small")}More</h2>
      <div class="tile-grid">
        <button class="tile" data-command-id="${COMMAND_OPEN_SETTINGS}">${iconBadge("gear", "charts.green", "small")}<span>Open Settings</span></button>
        <button class="tile" data-command-id="${COMMAND_OPEN_LOGS}">${iconBadge("output", "charts.green", "small")}<span>Open Logs</span></button>
      </div>
    </section>`;
  }

  private page(nonce: string, codiconsUri: vscode.Uri, cspSource: string, body: string): string {
    const csp = [
      "default-src 'none'",
      `style-src ${cspSource} 'unsafe-inline'`,
      `font-src ${cspSource}`,
      `script-src 'nonce-${nonce}'`
    ].join("; ");
    return `<!doctype html>
<html>
<head>
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link href="${codiconsUri.toString()}" rel="stylesheet">
<style>${STYLES}</style>
</head>
<body>
${body}
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();

  document.addEventListener("click", (event) => {
    const commandEl = event.target.closest("[data-command-id]");
    if (commandEl) {
      vscode.postMessage({ type: "command", id: commandEl.getAttribute("data-command-id") });
      return;
    }
    const revealEl = event.target.closest("[data-reveal-path]");
    if (revealEl) {
      vscode.postMessage({ type: "revealApp", path: revealEl.getAttribute("data-reveal-path") });
      return;
    }
    const externalEl = event.target.closest("[data-external-url]");
    if (externalEl) {
      vscode.postMessage({ type: "openExternal", url: externalEl.getAttribute("data-external-url") });
      return;
    }
    const reportEl = event.target.closest("[data-report-problem]");
    if (reportEl) {
      vscode.postMessage({ type: "reportProblem" });
      return;
    }
    const tabEl = event.target.closest(".tab-button");
    if (tabEl) {
      activateTab(tabEl.getAttribute("data-tab"));
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      const target = event.target.closest('[role="button"]');
      if (target) {
        event.preventDefault();
        target.click();
      }
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const currentTab = event.target.closest(".tab-button");
      if (!currentTab) {
        return;
      }
      const tabs = Array.from(document.querySelectorAll(".tab-button"));
      const currentIndex = tabs.indexOf(currentTab);
      const nextIndex = event.key === "ArrowRight" ? (currentIndex + 1) % tabs.length : (currentIndex - 1 + tabs.length) % tabs.length;
      const nextTab = tabs[nextIndex];
      event.preventDefault();
      activateTab(nextTab.getAttribute("data-tab"));
      nextTab.focus();
    }
  });

  function activateTab(tabId) {
    document.querySelectorAll(".tab-button").forEach((button) => {
      const active = button.getAttribute("data-tab") === tabId;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      panel.hidden = panel.getAttribute("data-tab-panel") !== tabId;
    });
    vscode.setState({ activeTab: tabId });
  }

  const previousState = vscode.getState();
  if (previousState && previousState.activeTab) {
    activateTab(previousState.activeTab);
  }
</script>
</body>
</html>`;
  }
}

function buildFrontendTiles(frontend: FrontendProject, state: ProjectState): ActionTile[] {
  const tiles: ActionTile[] = [{ label: "Install Dependencies", icon: "package", commandId: COMMAND_INSTALL_FRONTEND_DEPENDENCIES }];
  if (state.configuration !== undefined && Object.hasOwn(frontend.scripts, state.configuration.frontendBuildScript)) {
    tiles.push({ label: "Build", icon: "tools", commandId: COMMAND_BUILD_FRONTEND });
  }
  if (state.configuration !== undefined && Object.hasOwn(frontend.scripts, state.configuration.frontendTestScript)) {
    tiles.push({ label: "Run Tests", icon: "beaker", commandId: COMMAND_RUN_FRONTEND_TESTS });
  }
  tiles.push({ label: "Environment Variables (.env)", icon: "key", commandId: COMMAND_OPEN_FRONTEND_ENV_FILE });
  tiles.push({ label: "Run Script…", icon: "run", commandId: COMMAND_RUN_FRONTEND_SCRIPT });
  return tiles;
}

function section(title: string, icon: string, colorToken: string, body: string): string {
  return `<section class="section"><h2>${iconBadge(icon, colorToken, "small")}${escapeHtml(title)}</h2>${body}</section>`;
}

function tileGroup(title: string, colorToken: string, tiles: readonly ActionTile[]): string {
  const tileHtml = tiles
    .map(
      (tile) =>
        `<button class="tile" data-command-id="${tile.commandId}">${iconBadge(tile.icon, colorToken, "small")}<span>${escapeHtml(tile.label)}</span></button>`
    )
    .join("\n");
  return `<div class="tile-group"><h3>${escapeHtml(title)}</h3><div class="tile-grid">${tileHtml}</div></div>`;
}

/** The shared shell every stat card (Backend/Frontend/Python/Package Manager) renders into. */
function statCardShell(icon: string, colorToken: string, title: string, value: string, action?: string, footer?: string): string {
  return `<div class="stat-card">
    <div class="stat-card-row">
      ${iconBadge(icon, colorToken, "medium")}
      <div class="stat-body">
        <span class="stat-title">${escapeHtml(title)}</span>
        <span class="stat-value">${value}</span>
      </div>
      ${action ?? ""}
    </div>
    ${footer ?? ""}
  </div>`;
}

function logPreview(lines: readonly string[]): string {
  if (lines.length === 0) {
    return "";
  }
  return `<pre class="log-preview">${escapeHtml(lines.join("\n"))}</pre>`;
}

interface StatCardExtraAction {
  readonly icon: string;
  readonly title: string;
  readonly commandId: string;
}

function serverStatCard(
  label: string,
  glyphWhenDetected: string,
  detected: boolean,
  descriptor: ManagedProcessDescriptor,
  toggleCommandId: string,
  host?: string,
  extraActionsWhenRunning: readonly StatCardExtraAction[] = [],
  logLines: readonly string[] = []
): string {
  if (!detected) {
    return statCardShell(glyphWhenDetected, "disabledForeground", label, "Not detected");
  }

  const busy = descriptor.state === "starting" || descriptor.state === "stopping";
  const isRunningOrStarting = descriptor.state === "running" || descriptor.state === "starting";
  const buttonIcon = isRunningOrStarting ? "debug-stop" : "play";
  const buttonTitle = isRunningOrStarting ? "Stop" : "Start";
  const statusIcon = serverStateIcon(descriptor.state);

  const extraButtons =
    descriptor.state === "running"
      ? extraActionsWhenRunning
          .map(
            (extra) =>
              `<button class="icon-button" title="${escapeHtml(extra.title)}" aria-label="${escapeHtml(extra.title)}" data-command-id="${extra.commandId}">${codiconGlyph(extra.icon)}</button>`
          )
          .join("")
      : "";
  const action = `${extraButtons}<button class="icon-button" ${busy ? "disabled" : ""} title="${buttonTitle}" aria-label="${buttonTitle}" data-command-id="${toggleCommandId}">${codiconGlyph(buttonIcon)}</button>`;
  return statCardShell(
    statusIcon.id.replace("~spin", ""),
    statusIcon.color ?? "foreground",
    label,
    escapeHtml(describeServerState(descriptor, host)),
    action,
    logPreview(logLines)
  );
}

function pythonStatCard(python: PythonEnvironment | undefined): string {
  if (python === undefined) {
    return statCardShell("circuit-board", "disabledForeground", "Python", "Not detected");
  }
  const value = python.version === undefined ? python.executablePath : `${python.version} · ${python.executablePath}`;
  return statCardShell("circuit-board", "charts.blue", "Python", escapeHtml(value));
}

function packageManagerStatCard(frontend: FrontendProject | undefined): string {
  if (frontend === undefined) {
    return statCardShell("package", "disabledForeground", "Package Manager", "Not detected");
  }
  const packageManager = frontend.packageManager;
  if (packageManager.kind === "detected") {
    return statCardShell("package", "charts.purple", "Package Manager", escapeHtml(packageManager.manager));
  }
  const description =
    packageManager.kind === "missing" ? "Not detected" : `Ambiguous (${packageManager.candidates.map((candidate) => candidate.manager).join(", ")})`;
  return statCardShell("warning", ICON_BLOCKED.color ?? "charts.yellow", "Package Manager", escapeHtml(description));
}

function buildAppsOverview(apps: readonly DjangoApp[]): string {
  return apps
    .map(
      (app) =>
        `<div class="app-chip" role="button" tabindex="0" aria-label="Reveal ${escapeHtml(app.name)} in Explorer" data-reveal-path="${escapeHtml(app.path)}">${iconBadge("symbol-namespace", "charts.orange", "small")}<span class="label">${escapeHtml(app.name)}</span></div>`
    )
    .join("\n");
}

const ACTIVITY_ICON_BY_KIND: Record<ActivityEntry["kind"], { icon: string; color: string }> = {
  success: { icon: "check", color: "charts.green" },
  failure: { icon: "error", color: "charts.red" },
  info: { icon: "circle-small-filled", color: "disabledForeground" }
};

function buildActivityList(entries: readonly ActivityEntry[]): string {
  return entries
    .map((entry) => {
      const { icon, color } = ACTIVITY_ICON_BY_KIND[entry.kind];
      return `<div class="activity-item">${iconBadge(icon, color, "small")}<span class="label">${escapeHtml(entry.message)}</span><span class="description">${escapeHtml(formatRelativeTime(entry.timestamp))}</span></div>`;
    })
    .join("\n");
}

function formatRelativeTime(timestamp: number): string {
  const elapsedSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (elapsedSeconds < 60) {
    return "just now";
  }
  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes} min ago`;
  }
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `${elapsedHours} h ago`;
  }
  const elapsedDays = Math.round(elapsedHours / 24);
  return `${elapsedDays} d ago`;
}

function iconBadge(id: string, colorToken: string, size: "small" | "medium"): string {
  return `<span class="icon-badge icon-badge-${size}" style="--accent:${toCssVar(colorToken)}">${codiconGlyph(id)}</span>`;
}

function codiconGlyph(id: string): string {
  return `<i class="codicon codicon-${id}"></i>`;
}

function toCssVar(token: string): string {
  return `var(--vscode-${token.replaceAll(".", "-")})`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function createNonce(): string {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i++) {
    nonce += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return nonce;
}

/**
 * Plain HTML/CSS on VS Code's own theme variables - no component framework.
 * (@vscode/webview-ui-toolkit was deprecated in January 2025 with no
 * official replacement; the community vscode-elements project would add a
 * Lit runtime for a handful of buttons and rows, which is not worth it
 * here.) Codicons give consistent, themed icons without hand-drawn SVGs.
 * Color comes from VS Code's own semantic tokens (charts.*, not made-up hex
 * values) via each icon badge's --accent custom property, so it stays
 * correct across light/dark/high-contrast themes instead of just being
 * grayscale chrome around a couple of status dots.
 */
const STYLES = `
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 0; margin: 0; }
  .muted { color: var(--vscode-descriptionForeground); padding: 16px 24px; }

  .page-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 20px 24px 16px; }
  .page-header h1 { margin: 0; font-size: 1.5em; font-weight: 650; letter-spacing: -0.01em; }
  .page-header p { margin: 2px 0 0; color: var(--vscode-descriptionForeground); }

  .tab-bar { display: flex; gap: 4px; border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); padding: 0 24px; }
  .tab-button { background: transparent; border: none; color: var(--vscode-descriptionForeground); padding: 8px 4px; margin-right: 18px; cursor: pointer; font-family: inherit; font-size: 0.95em; font-weight: 500; border-bottom: 2px solid transparent; transition: color 0.1s ease, border-color 0.1s ease; }
  .tab-button:hover { color: var(--vscode-foreground); }
  .tab-button.active { color: var(--vscode-foreground); border-bottom-color: var(--vscode-focusBorder); }

  .tab-panel { padding: 20px 24px 32px; max-width: 980px; }
  .section { margin-top: 26px; }
  .section:first-child { margin-top: 0; }
  .section h2 { display: flex; align-items: center; gap: 8px; font-size: 1.02em; margin: 0 0 12px; font-weight: 600; }
  .section h3 { font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.05em; color: var(--vscode-descriptionForeground); margin: 0 0 10px; font-weight: 600; }

  .icon-badge { display: inline-flex; flex: none; align-items: center; justify-content: center; border-radius: 8px; background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent); }
  .icon-badge-small { width: 26px; height: 26px; font-size: 13px; border-radius: 7px; }
  .icon-badge-medium { width: 38px; height: 38px; font-size: 17px; border-radius: 9px; }

  .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
  .stat-card { display: flex; flex-direction: column; gap: 8px; background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 10px; padding: 14px 16px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12); }
  .stat-card-row { display: flex; align-items: center; gap: 12px; }
  .stat-body { display: flex; flex-direction: column; min-width: 0; gap: 2px; }
  .stat-title { font-size: 0.76em; text-transform: uppercase; letter-spacing: 0.05em; color: var(--vscode-descriptionForeground); }
  .stat-value { font-size: 0.95em; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .stat-card .icon-button { margin-left: auto; }
  .log-preview { margin: 0; padding: 8px 10px; background: var(--vscode-textCodeBlock-background); border-radius: 6px; font-family: var(--vscode-editor-font-family, monospace); font-size: 0.82em; line-height: 1.5; color: var(--vscode-descriptionForeground); overflow-x: auto; white-space: pre; max-height: 8.5em; overflow-y: auto; }

  .row { display: flex; align-items: center; gap: 8px; padding: 6px 4px; border-radius: 6px; }
  .row.action { cursor: pointer; }
  .row.action:hover { background: var(--vscode-list-hoverBackground); }
  .label { flex: none; }

  .open-app { margin-top: 14px; font-weight: 500; color: var(--vscode-textLink-foreground); }
  .open-app:hover { color: var(--vscode-textLink-activeForeground); }
  .row.alert { margin-top: 14px; font-weight: 500; color: var(--vscode-charts-yellow, #cca700); }

  .activity-list { display: flex; flex-direction: column; gap: 2px; }
  .activity-item { display: flex; align-items: center; gap: 8px; padding: 5px 4px; }
  .activity-item .label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .activity-item .description { flex: none; font-size: 0.85em; color: var(--vscode-descriptionForeground); }

  .icon-button { flex: none; background: transparent; color: var(--vscode-foreground); border: none; border-radius: 6px; width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: background-color 0.1s ease; }
  .icon-button:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground); }
  .icon-button:disabled { opacity: 0.5; cursor: default; }

  .tile-group { margin-top: 26px; }
  .tile-group:first-child { margin-top: 0; }
  .tile-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; }
  .tile { display: flex; align-items: center; gap: 10px; background: var(--vscode-editorWidget-background); color: var(--vscode-foreground); border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 8px; padding: 8px 12px; cursor: pointer; font-family: inherit; font-size: 0.92em; text-align: left; transition: transform 0.08s ease, box-shadow 0.08s ease, border-color 0.08s ease; }
  .tile:hover { border-color: var(--vscode-focusBorder); box-shadow: 0 2px 6px rgba(0, 0, 0, 0.14); transform: translateY(-1px); }
  .tile span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .app-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px; }
  .app-chip { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 8px; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); cursor: pointer; transition: border-color 0.08s ease; }
  .app-chip:hover { border-color: var(--vscode-focusBorder); background: var(--vscode-list-hoverBackground); }
  .app-chip .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .tip-grid, .guide-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
  .tip-card { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 10px; padding: 12px 14px; }
  .tip-card h3 { margin: 0 0 6px; font-size: 0.92em; font-weight: 600; text-transform: none; letter-spacing: normal; color: var(--vscode-foreground); }
  .tip-card p { margin: 0; line-height: 1.55; color: var(--vscode-descriptionForeground); }

  code { background: var(--vscode-textCodeBlock-background); padding: 1px 5px; border-radius: 4px; }

  @media (prefers-reduced-motion: reduce) {
    .codicon-modifier-spin { animation: none; }
    .tile, .icon-button, .tab-button { transition: none; }
  }
`;
