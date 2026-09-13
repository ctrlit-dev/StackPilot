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

/** One entry in the Dev Tools sidebar/detail layout - see buildDevToolsTab(). */
interface DevToolEntry {
  readonly id: string;
  readonly title: string;
  readonly icon: string;
  readonly color: string;
  readonly category: string;
  readonly body: string;
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
  /** Set by open(tab) for a not-yet-created panel; consumed once by render() and baked into the first HTML instead of raced with a postMessage. */
  private pendingInitialTab: string | undefined;

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

  public open(initialTab?: string): void {
    if (this.panel !== undefined) {
      this.panel.reveal();
      if (initialTab !== undefined) {
        void this.panel.webview.postMessage({ type: "activateTab", tab: initialTab });
      }
      return;
    }
    this.pendingInitialTab = initialTab;
    this.attach(
      vscode.window.createWebviewPanel(DASHBOARD_PANEL_VIEW_TYPE, "StackPilot Dashboard", vscode.ViewColumn.Active, {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "resources")]
      })
    );
  }

  /** Shared wiring for both a freshly created panel and one restored by DashboardPanelSerializer after a window reload. */
  public attach(panel: vscode.WebviewPanel): void {
    this.panel = panel;
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "resources")]
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
    this.pendingInitialTab = undefined;
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
    const bcryptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "resources", "vendor", "bcrypt.js"));
    const state = this.projectState.getState();

    const body =
      state.selection.kind !== "selected"
        ? `${this.header(undefined)}<p class="muted">Select a workspace folder to get started.</p>`
        : `${this.header(state.selection.folder.name)}
           ${this.tabBar()}
           <section class="tab-panel" data-tab-panel="overview" role="tabpanel">${this.buildOverviewTab(state)}</section>
           <section class="tab-panel" data-tab-panel="devtools" role="tabpanel" hidden>${this.buildDevToolsTab()}</section>
           <section class="tab-panel" data-tab-panel="help" role="tabpanel" hidden>${this.buildHelpTab()}</section>`;

    return this.page(nonce, codiconsUri, bcryptUri, webview.cspSource, body, this.pendingInitialTab);
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
      <button class="tab-button" role="tab" data-tab="devtools">Dev Tools</button>
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

  /** Static shell, same spirit as buildHelpTab() - the tools are pure client-side transforms, computed entirely in page()'s inline script. */
  private buildDevToolsTab(): string {
    const regexTester = `<div class="tool-card">
      <div class="tool-row">
        <label class="tool-label" for="regexPattern">Pattern</label>
        <input id="regexPattern" class="tool-input tool-mono" type="text" placeholder="\\d+" autocomplete="off" spellcheck="false">
      </div>
      <div class="tool-row">
        <label class="tool-label" for="regexFlags">Flags</label>
        <input id="regexFlags" class="tool-input tool-mono tool-input-small" type="text" value="g" autocomplete="off" spellcheck="false">
      </div>
      <div class="tool-row">
        <label class="tool-label" for="regexInput">Test String</label>
        <textarea id="regexInput" class="tool-textarea tool-mono" rows="6" placeholder="Paste text to test against…"></textarea>
      </div>
      <div id="regexError" class="tool-error" hidden></div>
      <div id="regexSummary" class="tool-summary"></div>
      <pre id="regexPreview" class="tool-preview"></pre>
      <div id="regexMatches" class="match-list"></div>
    </div>`;

    const caseConverter = `<div class="tool-card">
      <textarea id="caseInput" class="tool-textarea" rows="4" placeholder="Type or paste text…"></textarea>
      <div class="tool-button-row">
        <button type="button" class="tool-button" data-case="camel">camelCase</button>
        <button type="button" class="tool-button" data-case="pascal">PascalCase</button>
        <button type="button" class="tool-button" data-case="snake">snake_case</button>
        <button type="button" class="tool-button" data-case="kebab">kebab-case</button>
        <button type="button" class="tool-button" data-case="constant">CONSTANT_CASE</button>
        <button type="button" class="tool-button" data-case="title">Title Case</button>
        <button type="button" class="tool-button" data-case="lower">lower case</button>
        <button type="button" class="tool-button" data-case="upper">UPPER CASE</button>
        <button type="button" class="tool-button" data-case="slug">slug-case</button>
        <button type="button" class="tool-button tool-button-secondary" id="caseCopyButton">${codiconGlyph("copy")}<span id="caseCopyLabel">Copy</span></button>
      </div>
    </div>`;

    const jsonTool = `<div class="tool-card">
      <textarea id="jsonInput" class="tool-textarea tool-mono" rows="8" placeholder="Paste JSON…" spellcheck="false"></textarea>
      <div id="jsonError" class="tool-error" hidden></div>
      <div id="jsonSummary" class="tool-summary"></div>
      <div class="tool-button-row">
        <button type="button" class="tool-button" data-json-action="prettify">Prettify</button>
        <button type="button" class="tool-button" data-json-action="minify">Minify</button>
        <button type="button" class="tool-button tool-button-secondary" id="jsonCopyButton">${codiconGlyph("copy")}<span id="jsonCopyLabel">Copy</span></button>
      </div>
    </div>`;

    const encodeTool = `<div class="tool-card">
      <textarea id="encodeInput" class="tool-textarea tool-mono" rows="6" placeholder="Text to encode/decode…" spellcheck="false"></textarea>
      <div id="encodeError" class="tool-error" hidden></div>
      <div class="tool-button-row">
        <button type="button" class="tool-button" data-encode-action="base64encode">Base64 Encode</button>
        <button type="button" class="tool-button" data-encode-action="base64decode">Base64 Decode</button>
        <button type="button" class="tool-button" data-encode-action="urlencode">URL Encode</button>
        <button type="button" class="tool-button" data-encode-action="urldecode">URL Decode</button>
        <button type="button" class="tool-button tool-button-secondary" id="encodeCopyButton">${codiconGlyph("copy")}<span id="encodeCopyLabel">Copy</span></button>
      </div>
    </div>`;

    const curlTool = `<div class="tool-card">
      <textarea id="curlInput" class="tool-textarea tool-mono" rows="6" placeholder="curl 'https://api.example.com/users' -H 'Authorization: Bearer …' -d '{&quot;name&quot;:&quot;Ada&quot;}'" spellcheck="false"></textarea>
      <div class="tool-button-row">
        <button type="button" class="tool-button" data-curl-target="fetch">Fetch</button>
        <button type="button" class="tool-button" data-curl-target="axios">Axios</button>
        <button type="button" class="tool-button" data-curl-target="python">Python</button>
        <button type="button" class="tool-button tool-button-secondary" id="curlCopyButton">${codiconGlyph("copy")}<span id="curlCopyLabel">Copy</span></button>
      </div>
      <pre id="curlOutput" class="tool-preview tool-mono"></pre>
    </div>`;

    const colorTool = `<div class="tool-card">
      <div class="color-row">
        <input id="colorPicker" class="color-native-picker" type="color" value="#3b82f6" aria-label="Pick a color">
        <div id="colorSwatch" class="color-swatch" aria-hidden="true"></div>
      </div>
      <div class="tool-row">
        <label class="tool-label" for="colorHex">HEX</label>
        <div class="tool-input-with-copy">
          <input id="colorHex" class="tool-input tool-mono" type="text" spellcheck="false" autocomplete="off">
          <button type="button" class="icon-button" title="Copy" aria-label="Copy HEX" data-copy-field="colorHex">${codiconGlyph("copy")}</button>
        </div>
      </div>
      <div class="tool-row">
        <label class="tool-label" for="colorRgb">RGBA</label>
        <div class="tool-input-with-copy">
          <input id="colorRgb" class="tool-input tool-mono" type="text" spellcheck="false" autocomplete="off">
          <button type="button" class="icon-button" title="Copy" aria-label="Copy RGBA" data-copy-field="colorRgb">${codiconGlyph("copy")}</button>
        </div>
      </div>
      <div class="tool-row">
        <label class="tool-label" for="colorHsl">HSLA</label>
        <div class="tool-input-with-copy">
          <input id="colorHsl" class="tool-input tool-mono" type="text" spellcheck="false" autocomplete="off">
          <button type="button" class="icon-button" title="Copy" aria-label="Copy HSLA" data-copy-field="colorHsl">${codiconGlyph("copy")}</button>
        </div>
      </div>
      <div id="colorError" class="tool-error" hidden></div>
    </div>`;

    const gradientTool = `<div class="tool-card">
      <div class="tool-row">
        <label class="tool-label" for="gradientType">Type</label>
        <select id="gradientType" class="tool-input">
          <option value="linear">Linear</option>
          <option value="radial">Radial</option>
          <option value="conic">Conic</option>
        </select>
      </div>
      <div class="tool-row" id="gradientAngleRow">
        <label class="tool-label" for="gradientAngle">Angle (deg)</label>
        <div class="angle-dial-row">
          <div id="gradientAngleDial" class="angle-dial" tabindex="0" role="slider" aria-valuemin="0" aria-valuemax="360" aria-valuenow="90" aria-label="Gradient angle">
            <div id="gradientAngleHandle" class="angle-dial-handle"></div>
          </div>
          <input id="gradientAngle" class="tool-input tool-input-small" type="number" min="0" max="360" value="90">
        </div>
      </div>
      <div id="gradientStops" class="gradient-stops"></div>
      <div class="tool-button-row">
        <button type="button" class="tool-button" id="gradientAddStopButton">${codiconGlyph("add")}<span>Add Stop</span></button>
      </div>
      <div id="gradientPreview" class="gradient-preview" aria-hidden="true"></div>
      <div class="tool-row">
        <label class="tool-label" for="gradientOutput">CSS</label>
        <div class="tool-input-with-copy">
          <input id="gradientOutput" class="tool-input tool-mono" type="text" readonly autocomplete="off">
          <button type="button" class="icon-button" title="Copy" aria-label="Copy gradient CSS" data-copy-field="gradientOutput">${codiconGlyph("copy")}</button>
        </div>
      </div>
    </div>`;

    const tailwindTool = `<div class="tool-card">
      <textarea id="tailwindInput" class="tool-textarea tool-mono" rows="4" placeholder="p-4 flex bg-red-500 block bg-blue-500 p-4 text-left text-sm text-center" spellcheck="false"></textarea>
      <div id="tailwindSummary" class="tool-summary"></div>
      <div class="tool-button-row">
        <button type="button" class="tool-button" id="tailwindOptimizeButton">Optimize</button>
        <button type="button" class="tool-button tool-button-secondary" id="tailwindCopyButton">${codiconGlyph("copy")}<span id="tailwindCopyLabel">Copy</span></button>
      </div>
    </div>`;

    const svgTool = `<div class="tool-card">
      <textarea id="svgInput" class="tool-textarea tool-mono" rows="6" placeholder="<svg xmlns=&quot;http://www.w3.org/2000/svg&quot; viewBox=&quot;0 0 24 24&quot;>…</svg>" spellcheck="false"></textarea>
      <div class="tool-button-row">
        <button type="button" class="tool-button" data-svg-target="urlencoded">URL-encoded</button>
        <button type="button" class="tool-button" data-svg-target="base64">Base64</button>
        <button type="button" class="tool-button tool-button-secondary" id="svgCopyButton">${codiconGlyph("copy")}<span id="svgCopyLabel">Copy</span></button>
      </div>
      <pre id="svgOutput" class="tool-preview tool-mono"></pre>
    </div>`;

    const jwtTool = `<div class="tool-card">
      <textarea id="jwtInput" class="tool-textarea tool-mono" rows="4" placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…" spellcheck="false"></textarea>
      <div id="jwtError" class="tool-error" hidden></div>
      <div id="jwtSummary" class="tool-summary"></div>
      <div class="tool-row">
        <label class="tool-label">Header</label>
        <pre id="jwtHeader" class="tool-preview tool-mono"></pre>
      </div>
      <div class="tool-row">
        <label class="tool-label">Payload</label>
        <pre id="jwtPayload" class="tool-preview tool-mono"></pre>
      </div>
      <p class="tool-note">Decoded locally - the signature is not verified.</p>
    </div>`;

    const passwordTool = `<div class="tool-card">
      <h3>Hash</h3>
      <div class="tool-row">
        <label class="tool-label" for="hashPassword">Password</label>
        <input id="hashPassword" class="tool-input tool-mono" type="text" autocomplete="off" spellcheck="false">
      </div>
      <div class="tool-row">
        <label class="tool-label" for="hashRounds">Rounds</label>
        <input id="hashRounds" class="tool-input tool-input-small" type="number" min="4" max="14" value="10">
      </div>
      <div class="tool-button-row">
        <button type="button" class="tool-button" id="hashButton">Hash</button>
      </div>
      <div id="hashError" class="tool-error" hidden></div>
      <div class="tool-row">
        <label class="tool-label" for="hashOutput">Bcrypt Hash</label>
        <div class="tool-input-with-copy">
          <input id="hashOutput" class="tool-input tool-mono" type="text" readonly autocomplete="off">
          <button type="button" class="icon-button" title="Copy" aria-label="Copy hash" data-copy-field="hashOutput">${codiconGlyph("copy")}</button>
        </div>
      </div>
      <p class="tool-note">Standard bcrypt ($2a$/$2b$). Django's default password hasher is PBKDF2, not bcrypt - this only matches a Django user row if <code>BCryptSHA256PasswordHasher</code> is explicitly configured (which also SHA-256-prehashes before bcrypt).</p>

      <h3>Verify</h3>
      <div class="tool-row">
        <label class="tool-label" for="verifyPassword">Password</label>
        <input id="verifyPassword" class="tool-input tool-mono" type="text" autocomplete="off" spellcheck="false">
      </div>
      <div class="tool-row">
        <label class="tool-label" for="verifyHash">Hash</label>
        <input id="verifyHash" class="tool-input tool-mono" type="text" autocomplete="off" spellcheck="false">
      </div>
      <div class="tool-button-row">
        <button type="button" class="tool-button" id="verifyButton">Verify</button>
      </div>
      <div id="verifyResult" class="tool-summary"></div>
    </div>`;

    const colorAndGradientBody = [
      subheader("symbol-color", "charts.purple", "Solid Color"),
      colorTool,
      subheader("color-mode", "charts.purple", "Gradient"),
      gradientTool
    ].join("\n");

    const CATEGORIES: readonly { readonly id: string; readonly label: string }[] = [
      { id: "data", label: "Data, Formatting & Code" },
      { id: "styling", label: "Frontend & Styling" },
      { id: "security", label: "Security & Authentication" }
    ];

    const tools: readonly DevToolEntry[] = [
      { id: "regex", title: "Regex Tester", icon: "regex", color: "charts.blue", category: "data", body: regexTester },
      { id: "case", title: "Case Converter & Slug Generator", icon: "case-sensitive", color: "charts.purple", category: "data", body: caseConverter },
      { id: "json", title: "JSON Formatter & Validator", icon: "json", color: "charts.orange", category: "data", body: jsonTool },
      { id: "base64", title: "Base64 & URL Encoder/Decoder", icon: "key", color: "charts.green", category: "data", body: encodeTool },
      { id: "curl", title: "cURL → Fetch/Axios/Python", icon: "arrow-swap", color: "charts.blue", category: "data", body: curlTool },
      { id: "color", title: "Color Picker & Gradient Builder", icon: "symbol-color", color: "charts.purple", category: "styling", body: colorAndGradientBody },
      { id: "tailwind", title: "Tailwind CSS Class Optimizer", icon: "wand", color: "charts.blue", category: "styling", body: tailwindTool },
      { id: "svg", title: "SVG → CSS Data-URI Converter", icon: "file-media", color: "charts.orange", category: "styling", body: svgTool },
      { id: "jwt", title: "JWT Inspector", icon: "shield", color: "charts.green", category: "security", body: jwtTool },
      { id: "password", title: "Password Hasher & Validator", icon: "lock", color: "charts.red", category: "security", body: passwordTool }
    ];

    const navGroups = CATEGORIES.map(({ id, label }) => {
      const items = tools
        .filter((tool) => tool.category === id)
        .map(
          (tool) =>
            `<button type="button" class="devtools-nav-item" data-tool-select="${tool.id}" data-tool-search="${escapeHtml(tool.title.toLowerCase())}">${iconBadge(tool.icon, tool.color, "small")}<span>${escapeHtml(tool.title)}</span></button>`
        )
        .join("\n");
      return `<div class="devtools-nav-group" data-nav-group="${id}">
        <button type="button" class="devtools-nav-group-header" data-nav-group-toggle="${id}" aria-expanded="true">
          <span>${escapeHtml(label)}</span>
          ${codiconGlyph("chevron-down")}
        </button>
        <div class="devtools-nav-group-items" data-nav-group-items="${id}">${items}</div>
      </div>`;
    }).join("\n");

    const panels = tools
      .map(
        (tool) =>
          `<div class="tool-panel" data-tool-panel="${tool.id}" hidden><div class="tool-panel-header">${iconBadge(tool.icon, tool.color, "medium")}<h2>${escapeHtml(tool.title)}</h2></div>${tool.body}</div>`
      )
      .join("\n");

    return `<div class="devtools-layout">
      <nav class="devtools-nav" aria-label="Dev Tools">
        <div class="devtools-search">${codiconGlyph("search")}<input type="text" id="toolSearch" placeholder="Filter tools…" autocomplete="off" spellcheck="false"></div>
        <div class="devtools-nav-groups">${navGroups}</div>
      </nav>
      <div class="devtools-detail">${panels}</div>
    </div>`;
  }

  private page(nonce: string, codiconsUri: vscode.Uri, bcryptUri: vscode.Uri, cspSource: string, body: string, requestedInitialTab?: string): string {
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
<script nonce="${nonce}" src="${bcryptUri.toString()}"></script>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  let currentState = vscode.getState() || {};

  function persistState(patch) {
    currentState = Object.assign({}, currentState, patch);
    vscode.setState(currentState);
  }

  function persistDevToolsField(key, value) {
    persistState({ devTools: Object.assign({}, currentState.devTools, { [key]: value }) });
  }

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
      return;
    }
    const caseButtonEl = event.target.closest("[data-case]");
    if (caseButtonEl) {
      const caseInput = document.getElementById("caseInput");
      if (caseInput) {
        caseInput.value = caseConvert(caseInput.value, caseButtonEl.getAttribute("data-case"));
        persistDevToolsField("caseInput", caseInput.value);
      }
      return;
    }
    const copyButtonEl = event.target.closest("#caseCopyButton");
    if (copyButtonEl) {
      const caseInput = document.getElementById("caseInput");
      const copyLabel = document.getElementById("caseCopyLabel");
      if (caseInput) {
        copyTextToClipboard(caseInput.value, copyLabel);
      }
      return;
    }
    const jsonActionEl = event.target.closest("[data-json-action]");
    if (jsonActionEl) {
      applyJsonAction(jsonActionEl.getAttribute("data-json-action"));
      return;
    }
    const jsonCopyEl = event.target.closest("#jsonCopyButton");
    if (jsonCopyEl) {
      const jsonInput = document.getElementById("jsonInput");
      const copyLabel = document.getElementById("jsonCopyLabel");
      if (jsonInput) {
        copyTextToClipboard(jsonInput.value, copyLabel);
      }
      return;
    }
    const encodeActionEl = event.target.closest("[data-encode-action]");
    if (encodeActionEl) {
      applyEncodeAction(encodeActionEl.getAttribute("data-encode-action"));
      return;
    }
    const encodeCopyEl = event.target.closest("#encodeCopyButton");
    if (encodeCopyEl) {
      const encodeInput = document.getElementById("encodeInput");
      const copyLabel = document.getElementById("encodeCopyLabel");
      if (encodeInput) {
        copyTextToClipboard(encodeInput.value, copyLabel);
      }
      return;
    }
    const curlTargetEl = event.target.closest("[data-curl-target]");
    if (curlTargetEl) {
      activateCurlTarget(curlTargetEl.getAttribute("data-curl-target"));
      return;
    }
    const curlCopyEl = event.target.closest("#curlCopyButton");
    if (curlCopyEl) {
      const curlOutput = document.getElementById("curlOutput");
      const copyLabel = document.getElementById("curlCopyLabel");
      if (curlOutput) {
        copyTextToClipboard(curlOutput.textContent, copyLabel);
      }
      return;
    }
    const colorCopyEl = event.target.closest("[data-copy-field]");
    if (colorCopyEl) {
      const fieldEl = document.getElementById(colorCopyEl.getAttribute("data-copy-field"));
      if (fieldEl) {
        copyTextToClipboard(fieldEl.value, null);
      }
      return;
    }
    const tailwindOptimizeEl = event.target.closest("#tailwindOptimizeButton");
    if (tailwindOptimizeEl) {
      applyTailwindOptimize();
      return;
    }
    const tailwindCopyEl = event.target.closest("#tailwindCopyButton");
    if (tailwindCopyEl) {
      const tailwindInput = document.getElementById("tailwindInput");
      const copyLabel = document.getElementById("tailwindCopyLabel");
      if (tailwindInput) {
        copyTextToClipboard(tailwindInput.value, copyLabel);
      }
      return;
    }
    const svgTargetEl = event.target.closest("[data-svg-target]");
    if (svgTargetEl) {
      activateSvgTarget(svgTargetEl.getAttribute("data-svg-target"));
      return;
    }
    const svgCopyEl = event.target.closest("#svgCopyButton");
    if (svgCopyEl) {
      const svgOutput = document.getElementById("svgOutput");
      const copyLabel = document.getElementById("svgCopyLabel");
      if (svgOutput) {
        copyTextToClipboard(svgOutput.textContent, copyLabel);
      }
      return;
    }
    const navGroupToggleEl = event.target.closest("[data-nav-group-toggle]");
    if (navGroupToggleEl) {
      toggleNavGroup(navGroupToggleEl.getAttribute("data-nav-group-toggle"));
      return;
    }
    const toolSelectEl = event.target.closest("[data-tool-select]");
    if (toolSelectEl) {
      selectTool(toolSelectEl.getAttribute("data-tool-select"));
      return;
    }
    const gradientAddStopEl = event.target.closest("#gradientAddStopButton");
    if (gradientAddStopEl) {
      addGradientStop();
      return;
    }
    const gradientRemoveStopEl = event.target.closest("[data-stop-remove]");
    if (gradientRemoveStopEl) {
      removeGradientStop(Number(gradientRemoveStopEl.getAttribute("data-stop-remove")));
      return;
    }
    const hashButtonEl = event.target.closest("#hashButton");
    if (hashButtonEl) {
      runBcryptHash();
      return;
    }
    const verifyButtonEl = event.target.closest("#verifyButton");
    if (verifyButtonEl) {
      runBcryptVerify();
    }
  });

  document.addEventListener("input", (event) => {
    const stopFieldEl = event.target.closest("[data-stop-field]");
    if (stopFieldEl) {
      updateGradientStopField(stopFieldEl);
      return;
    }
    const id = event.target.id;
    if (id === "gradientAngle") {
      setGradientAngle(Number(event.target.value) || 0);
      return;
    }
    if (id === "regexPattern" || id === "regexFlags" || id === "regexInput") {
      persistDevToolsField(id === "regexPattern" ? "pattern" : id === "regexFlags" ? "flags" : "testString", event.target.value);
      updateRegexTester();
    } else if (id === "caseInput") {
      persistDevToolsField("caseInput", event.target.value);
    } else if (id === "jsonInput") {
      persistDevToolsField("jsonInput", event.target.value);
      updateJsonTool();
    } else if (id === "encodeInput") {
      persistDevToolsField("encodeInput", event.target.value);
      document.getElementById("encodeError").hidden = true;
    } else if (id === "curlInput") {
      persistDevToolsField("curlInput", event.target.value);
      updateCurlPreview();
    } else if (id === "colorHex" || id === "colorRgb" || id === "colorHsl") {
      parseColorInput(id, event.target.value);
    } else if (id === "colorPicker") {
      parseColorInput("colorPicker", event.target.value);
    } else if (id === "tailwindInput") {
      persistDevToolsField("tailwindInput", event.target.value);
    } else if (id === "svgInput") {
      persistDevToolsField("svgInput", event.target.value);
      updateSvgPreview();
    } else if (id === "jwtInput") {
      persistDevToolsField("jwtInput", event.target.value);
      updateJwtInspector();
    } else if (id === "toolSearch") {
      filterToolNav(event.target.value);
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

    if (event.target.id === "gradientAngleDial" && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      const step = event.shiftKey ? 15 : 1;
      const delta = event.key === "ArrowRight" || event.key === "ArrowUp" ? step : -step;
      setGradientAngle(gradientAngle + delta);
      return;
    }

    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && event.target.classList.contains("devtools-nav-item")) {
      const items = Array.from(document.querySelectorAll(".devtools-nav-item")).filter((item) => !item.hidden);
      const currentIndex = items.indexOf(event.target);
      if (currentIndex === -1) {
        return;
      }
      const nextIndex = event.key === "ArrowDown" ? (currentIndex + 1) % items.length : (currentIndex - 1 + items.length) % items.length;
      event.preventDefault();
      items[nextIndex].focus();
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

  document.addEventListener("change", (event) => {
    if (event.target.id === "gradientType") {
      activateGradientType(event.target.value);
    }
  });

  document.addEventListener("pointerdown", (event) => {
    const dial = event.target.closest("#gradientAngleDial");
    if (!dial) {
      return;
    }
    dial.setPointerCapture(event.pointerId);
    dial.focus();
    setGradientAngle(angleFromPointerEvent(dial, event));
  });

  document.addEventListener("pointermove", (event) => {
    const dial = document.getElementById("gradientAngleDial");
    if (!dial || !dial.hasPointerCapture(event.pointerId)) {
      return;
    }
    setGradientAngle(angleFromPointerEvent(dial, event));
  });

  // The only host->webview push message: reveal-while-already-open (open() on an existing panel)
  // can't bake the requested tab into freshly rendered HTML the way first render does, so it needs
  // a live message instead.
  window.addEventListener("message", (event) => {
    if (event.data && event.data.type === "activateTab") {
      activateTab(event.data.tab);
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
    persistState({ activeTab: tabId });
  }

  function escapeHtmlClient(value) {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function updateRegexTester() {
    const patternEl = document.getElementById("regexPattern");
    const flagsEl = document.getElementById("regexFlags");
    const inputEl = document.getElementById("regexInput");
    const errorEl = document.getElementById("regexError");
    const summaryEl = document.getElementById("regexSummary");
    const previewEl = document.getElementById("regexPreview");
    const matchesEl = document.getElementById("regexMatches");
    if (!patternEl || !flagsEl || !inputEl) {
      return;
    }

    const pattern = patternEl.value;
    const testString = inputEl.value;

    if (pattern === "") {
      errorEl.hidden = true;
      summaryEl.textContent = "";
      previewEl.innerHTML = escapeHtmlClient(testString);
      matchesEl.innerHTML = "";
      return;
    }

    let regex;
    try {
      regex = new RegExp(pattern, flagsEl.value);
    } catch (error) {
      errorEl.hidden = false;
      errorEl.textContent = error instanceof Error ? error.message : String(error);
      summaryEl.textContent = "";
      previewEl.innerHTML = escapeHtmlClient(testString);
      matchesEl.innerHTML = "";
      return;
    }
    errorEl.hidden = true;

    const matches = [];
    if (regex.global) {
      matches.push(...testString.matchAll(regex));
    } else {
      const match = regex.exec(testString);
      if (match) {
        matches.push(match);
      }
    }

    summaryEl.textContent = matches.length === 1 ? "1 match" : matches.length + " matches";

    let highlighted = "";
    let cursor = 0;
    for (const match of matches) {
      if (match.index === undefined || match.index < cursor) {
        continue;
      }
      highlighted += escapeHtmlClient(testString.slice(cursor, match.index));
      highlighted += "<mark>" + escapeHtmlClient(match[0]) + "</mark>";
      cursor = match.index + match[0].length;
      if (match[0].length === 0) {
        cursor += 1;
      }
    }
    highlighted += escapeHtmlClient(testString.slice(cursor));
    previewEl.innerHTML = highlighted;

    matchesEl.innerHTML = matches
      .map((match, index) => {
        const groups = match
          .slice(1)
          .map((group, groupIndex) => "Group " + (groupIndex + 1) + ": " + escapeHtmlClient(group === undefined ? "" : group))
          .join("<br>");
        return (
          '<div class="match-item">Match ' +
          (index + 1) +
          ": " +
          escapeHtmlClient(match[0]) +
          (groups ? "<br>" + groups : "") +
          "</div>"
        );
      })
      .join("");
  }

  function tokenizeWords(text) {
    return text
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .split(/[\\s_-]+/)
      .filter(Boolean);
  }

  function caseConvert(text, target) {
    const words = tokenizeWords(text);
    if (words.length === 0) {
      return "";
    }
    const lowerWords = words.map((word) => word.toLowerCase());
    const capitalize = (word) => word.charAt(0).toUpperCase() + word.slice(1);
    switch (target) {
      case "camel":
        return lowerWords.map((word, index) => (index === 0 ? word : capitalize(word))).join("");
      case "pascal":
        return lowerWords.map(capitalize).join("");
      case "snake":
        return lowerWords.join("_");
      case "kebab":
        return lowerWords.join("-");
      case "constant":
        return words.map((word) => word.toUpperCase()).join("_");
      case "title":
        return lowerWords.map(capitalize).join(" ");
      case "lower":
        return lowerWords.join(" ");
      case "upper":
        return words.map((word) => word.toUpperCase()).join(" ");
      case "slug":
        return slugify(text);
      default:
        return text;
    }
  }

  function slugify(text) {
    return text
      .normalize("NFD")
      .replace(/[\\u0300-\\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function applyJsonAction(action) {
    const jsonInput = document.getElementById("jsonInput");
    if (!jsonInput) {
      return;
    }
    try {
      const parsed = JSON.parse(jsonInput.value);
      jsonInput.value = action === "minify" ? JSON.stringify(parsed) : JSON.stringify(parsed, null, 2);
      persistDevToolsField("jsonInput", jsonInput.value);
      updateJsonTool();
    } catch (error) {
      // Parse already failed and is reported by updateJsonTool()'s live validation - nothing more to do here.
    }
  }

  function updateJsonTool() {
    const jsonInput = document.getElementById("jsonInput");
    const errorEl = document.getElementById("jsonError");
    const summaryEl = document.getElementById("jsonSummary");
    if (!jsonInput || !errorEl || !summaryEl) {
      return;
    }
    if (jsonInput.value.trim() === "") {
      errorEl.hidden = true;
      summaryEl.textContent = "";
      return;
    }
    try {
      JSON.parse(jsonInput.value);
      errorEl.hidden = true;
      summaryEl.textContent = "Valid JSON";
    } catch (error) {
      errorEl.hidden = false;
      errorEl.textContent = error instanceof Error ? error.message : String(error);
      summaryEl.textContent = "";
    }
  }

  function utf8ToBase64(text) {
    return btoa(unescape(encodeURIComponent(text)));
  }

  function base64ToUtf8(text) {
    return decodeURIComponent(escape(atob(text)));
  }

  function applyEncodeAction(action) {
    const encodeInput = document.getElementById("encodeInput");
    const errorEl = document.getElementById("encodeError");
    if (!encodeInput || !errorEl) {
      return;
    }
    try {
      switch (action) {
        case "base64encode":
          encodeInput.value = utf8ToBase64(encodeInput.value);
          break;
        case "base64decode":
          encodeInput.value = base64ToUtf8(encodeInput.value);
          break;
        case "urlencode":
          encodeInput.value = encodeURIComponent(encodeInput.value);
          break;
        case "urldecode":
          encodeInput.value = decodeURIComponent(encodeInput.value);
          break;
        default:
          return;
      }
      errorEl.hidden = true;
      persistDevToolsField("encodeInput", encodeInput.value);
    } catch (error) {
      errorEl.hidden = false;
      errorEl.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  function tokenizeShellCommand(command) {
    const tokens = [];
    let current = "";
    let quote = null;
    let hasToken = false;
    for (let i = 0; i < command.length; i++) {
      const char = command[i];
      if (quote) {
        if (char === quote) {
          quote = null;
        } else if (char === "\\\\" && quote === '"' && i + 1 < command.length) {
          current += command[++i];
        } else {
          current += char;
        }
        continue;
      }
      if (char === "'" || char === '"') {
        quote = char;
        hasToken = true;
        continue;
      }
      if (char === "\\\\" && i + 1 < command.length) {
        current += command[++i];
        hasToken = true;
        continue;
      }
      if (/\\s/.test(char)) {
        if (hasToken) {
          tokens.push(current);
          current = "";
          hasToken = false;
        }
        continue;
      }
      current += char;
      hasToken = true;
    }
    if (hasToken) {
      tokens.push(current);
    }
    return tokens;
  }

  function parseCurlCommand(command) {
    const normalized = command.trim().replace(/\\\\\\s*\\n/g, " ");
    const tokens = tokenizeShellCommand(normalized);
    if (tokens[0] === "curl") {
      tokens.shift();
    }

    const request = { url: "", method: undefined, headers: [], body: undefined, auth: undefined };
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token === "-X" || token === "--request") {
        request.method = tokens[++i];
      } else if (token === "-H" || token === "--header") {
        const header = tokens[++i];
        if (header) {
          const separatorIndex = header.indexOf(":");
          if (separatorIndex !== -1) {
            request.headers.push([header.slice(0, separatorIndex).trim(), header.slice(separatorIndex + 1).trim()]);
          }
        }
      } else if (token === "-d" || token === "--data" || token === "--data-raw" || token === "--data-binary") {
        request.body = tokens[++i];
      } else if (token === "-u" || token === "--user") {
        request.auth = tokens[++i];
      } else if (token === "-b" || token === "--cookie") {
        request.headers.push(["Cookie", tokens[++i]]);
      } else if (token === "--compressed" || token === "-s" || token === "--silent" || token === "-k" || token === "--insecure" || token === "-L" || token === "--location") {
        // Flags with no effect on the generated request code.
      } else if (!token.startsWith("-") && request.url === "") {
        request.url = token;
      }
    }

    if (request.auth) {
      request.headers.push(["Authorization", "Basic " + utf8ToBase64(request.auth)]);
    }
    if (!request.method) {
      request.method = request.body !== undefined ? "POST" : "GET";
    }
    return request;
  }

  function isJsonBody(body) {
    if (body === undefined) {
      return false;
    }
    try {
      JSON.parse(body);
      return true;
    } catch (error) {
      return false;
    }
  }

  function curlToFetch(request) {
    const lines = ["fetch(" + JSON.stringify(request.url) + ", {", "  method: " + JSON.stringify(request.method) + ","];
    if (request.headers.length > 0) {
      lines.push("  headers: {");
      for (const [name, value] of request.headers) {
        lines.push("    " + JSON.stringify(name) + ": " + JSON.stringify(value) + ",");
      }
      lines.push("  },");
    }
    if (request.body !== undefined) {
      lines.push("  body: " + JSON.stringify(request.body) + ",");
    }
    lines.push("});");
    return lines.join("\\n");
  }

  function curlToAxios(request) {
    const lines = ["axios({", "  method: " + JSON.stringify(request.method) + ",", "  url: " + JSON.stringify(request.url) + ","];
    if (request.headers.length > 0) {
      lines.push("  headers: {");
      for (const [name, value] of request.headers) {
        lines.push("    " + JSON.stringify(name) + ": " + JSON.stringify(value) + ",");
      }
      lines.push("  },");
    }
    if (request.body !== undefined) {
      lines.push("  data: " + (isJsonBody(request.body) ? request.body : JSON.stringify(request.body)) + ",");
    }
    lines.push("});");
    return lines.join("\\n");
  }

  function pythonLiteral(value) {
    return "'" + String(value).replace(/\\\\/g, "\\\\\\\\").replace(/'/g, "\\\\'") + "'";
  }

  function curlToPython(request) {
    const lines = ["import requests", ""];
    if (request.headers.length > 0) {
      lines.push("headers = {");
      for (const [name, value] of request.headers) {
        lines.push("    " + pythonLiteral(name) + ": " + pythonLiteral(value) + ",");
      }
      lines.push("}");
    }
    const bodyArg = request.body === undefined ? "" : isJsonBody(request.body) ? ", json=" + request.body : ", data=" + pythonLiteral(request.body);
    const headersArg = request.headers.length > 0 ? ", headers=headers" : "";
    lines.push("response = requests." + request.method.toLowerCase() + "(" + pythonLiteral(request.url) + headersArg + bodyArg + ")");
    lines.push("print(response.status_code, response.text)");
    return lines.join("\\n");
  }

  function activateCurlTarget(target) {
    document.querySelectorAll("[data-curl-target]").forEach((button) => {
      button.classList.toggle("active", button.getAttribute("data-curl-target") === target);
    });
    persistDevToolsField("curlTarget", target);
    updateCurlPreview();
  }

  function updateCurlPreview() {
    const curlInput = document.getElementById("curlInput");
    const outputEl = document.getElementById("curlOutput");
    if (!curlInput || !outputEl) {
      return;
    }
    if (curlInput.value.trim() === "") {
      outputEl.textContent = "";
      return;
    }
    const activeButton = document.querySelector("[data-curl-target].active");
    const target = activeButton ? activeButton.getAttribute("data-curl-target") : "fetch";
    try {
      const request = parseCurlCommand(curlInput.value);
      if (target === "axios") {
        outputEl.textContent = curlToAxios(request);
      } else if (target === "python") {
        outputEl.textContent = curlToPython(request);
      } else {
        outputEl.textContent = curlToFetch(request);
      }
    } catch (error) {
      outputEl.textContent = "Could not parse this command: " + (error instanceof Error ? error.message : String(error));
    }
  }

  let currentColor = { r: 59, g: 130, b: 246, a: 1 };
  let gradientType = "linear";
  let gradientAngle = 90;
  let gradientStops = [
    { color: "#3b82f6", alpha: 1, position: 0 },
    { color: "#ef4444", alpha: 1, position: 100 }
  ];

  function clamp255(value) {
    return Math.max(0, Math.min(255, Math.round(value)));
  }

  function componentToHex(value) {
    return clamp255(value).toString(16).padStart(2, "0");
  }

  function rgbToHex(r, g, b, a) {
    const base = "#" + componentToHex(r) + componentToHex(g) + componentToHex(b);
    return a < 1 ? base + componentToHex(a * 255) : base;
  }

  function hexToRgb(hex) {
    const normalized = hex.trim().replace(/^#/, "");
    if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{4}$|^[0-9a-fA-F]{6}$|^[0-9a-fA-F]{8}$/.test(normalized)) {
      throw new Error("Expected a 3, 4, 6, or 8 digit hex color");
    }
    const expand = (value) => (value.length <= 4 ? value.split("").map((ch) => ch + ch).join("") : value);
    const expanded = expand(normalized);
    const r = parseInt(expanded.slice(0, 2), 16);
    const g = parseInt(expanded.slice(2, 4), 16);
    const b = parseInt(expanded.slice(4, 6), 16);
    const a = expanded.length === 8 ? parseInt(expanded.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }

  function rgbToHsl(r, g, b, a) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    let h = 0;
    let s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case rn:
          h = (gn - bn) / d + (gn < bn ? 6 : 0);
          break;
        case gn:
          h = (bn - rn) / d + 2;
          break;
        default:
          h = (rn - gn) / d + 4;
      }
      h *= 60;
    }
    return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100), a };
  }

  function hslToRgb(h, s, l, a) {
    const sn = s / 100;
    const ln = l / 100;
    const c = (1 - Math.abs(2 * ln - 1)) * sn;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = ln - c / 2;
    let rp = 0;
    let gp = 0;
    let bp = 0;
    if (h < 60) {
      rp = c;
      gp = x;
    } else if (h < 120) {
      rp = x;
      gp = c;
    } else if (h < 180) {
      gp = c;
      bp = x;
    } else if (h < 240) {
      gp = x;
      bp = c;
    } else if (h < 300) {
      rp = x;
      bp = c;
    } else {
      rp = c;
      bp = x;
    }
    return { r: clamp255((rp + m) * 255), g: clamp255((gp + m) * 255), b: clamp255((bp + m) * 255), a };
  }

  function parseRgbString(value) {
    const match = value.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/i);
    if (!match) {
      throw new Error("Expected rgb(r, g, b) or rgba(r, g, b, a)");
    }
    return { r: clamp255(Number(match[1])), g: clamp255(Number(match[2])), b: clamp255(Number(match[3])), a: match[4] === undefined ? 1 : Number(match[4]) };
  }

  function parseHslString(value) {
    const match = value.match(/hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+)\s*)?\)/i);
    if (!match) {
      throw new Error("Expected hsl(h, s%, l%) or hsla(h, s%, l%, a)");
    }
    const rgb = hslToRgb(Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4]));
    return rgb;
  }

  function renderColorFields(skip) {
    const { r, g, b, a } = currentColor;
    const hsl = rgbToHsl(r, g, b, a);
    const hexEl = document.getElementById("colorHex");
    const rgbEl = document.getElementById("colorRgb");
    const hslEl = document.getElementById("colorHsl");
    const swatchEl = document.getElementById("colorSwatch");
    const pickerEl = document.getElementById("colorPicker");
    if (hexEl && skip !== "colorHex") {
      hexEl.value = rgbToHex(r, g, b, a);
    }
    if (rgbEl && skip !== "colorRgb") {
      rgbEl.value = a < 1 ? "rgba(" + r + ", " + g + ", " + b + ", " + a + ")" : "rgb(" + r + ", " + g + ", " + b + ")";
    }
    if (hslEl && skip !== "colorHsl") {
      hslEl.value = a < 1 ? "hsla(" + hsl.h + ", " + hsl.s + "%, " + hsl.l + "%, " + a + ")" : "hsl(" + hsl.h + ", " + hsl.s + "%, " + hsl.l + "%)";
    }
    if (swatchEl) {
      swatchEl.style.backgroundColor = "rgba(" + r + ", " + g + ", " + b + ", " + a + ")";
    }
    if (pickerEl && skip !== "colorPicker") {
      pickerEl.value = rgbToHex(r, g, b, 1);
    }
    persistDevToolsField("colorHex", rgbToHex(r, g, b, a));
  }

  function parseColorInput(source, value) {
    const errorEl = document.getElementById("colorError");
    if (!errorEl) {
      return;
    }
    try {
      const parsed = source === "colorRgb" ? parseRgbString(value) : source === "colorHsl" ? parseHslString(value) : hexToRgb(value);
      currentColor = parsed;
      errorEl.hidden = true;
      renderColorFields(source);
    } catch (error) {
      errorEl.hidden = false;
      errorEl.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  const GRADIENT_CHECKERBOARD_LAYERS =
    "linear-gradient(45deg, rgba(128,128,128,0.3) 25%, transparent 25%), linear-gradient(-45deg, rgba(128,128,128,0.3) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(128,128,128,0.3) 75%), linear-gradient(-45deg, transparent 75%, rgba(128,128,128,0.3) 75%)";

  function formatStopColor(stop) {
    if (stop.alpha >= 1) {
      return stop.color;
    }
    const rgb = hexToRgb(stop.color);
    return "rgba(" + rgb.r + ", " + rgb.g + ", " + rgb.b + ", " + stop.alpha + ")";
  }

  function buildGradientCss() {
    const sorted = gradientStops.slice().sort((a, b) => a.position - b.position);
    const stopsCss = sorted.map((stop) => formatStopColor(stop) + " " + stop.position + "%").join(", ");
    if (gradientType === "radial") {
      return "radial-gradient(circle, " + stopsCss + ")";
    }
    if (gradientType === "conic") {
      return "conic-gradient(from " + gradientAngle + "deg, " + stopsCss + ")";
    }
    return "linear-gradient(" + gradientAngle + "deg, " + stopsCss + ")";
  }

  function updateAngleDialVisual() {
    const handle = document.getElementById("gradientAngleHandle");
    const dial = document.getElementById("gradientAngleDial");
    if (handle) {
      handle.style.transform = "rotate(" + gradientAngle + "deg)";
    }
    if (dial) {
      dial.setAttribute("aria-valuenow", String(gradientAngle));
    }
  }

  function setGradientAngle(angle) {
    gradientAngle = ((Math.round(angle) % 360) + 360) % 360;
    const angleInput = document.getElementById("gradientAngle");
    if (angleInput) {
      angleInput.value = gradientAngle;
    }
    updateAngleDialVisual();
    updateGradientPreview();
    persistGradientState();
  }

  function angleFromPointerEvent(dialEl, event) {
    const rect = dialEl.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const angle = Math.atan2(dx, -dy) * (180 / Math.PI);
    return angle < 0 ? angle + 360 : angle;
  }

  function persistGradientState() {
    persistDevToolsField("gradient", { type: gradientType, angle: gradientAngle, stops: gradientStops });
  }

  function updateGradientPreview() {
    const previewEl = document.getElementById("gradientPreview");
    const outputEl = document.getElementById("gradientOutput");
    if (!previewEl || !outputEl) {
      return;
    }
    const css = buildGradientCss();
    previewEl.style.backgroundImage = css + ", " + GRADIENT_CHECKERBOARD_LAYERS;
    previewEl.style.backgroundSize = "100% 100%, 12px 12px, 12px 12px, 12px 12px, 12px 12px";
    previewEl.style.backgroundPosition = "0 0, 0 0, 0 6px, 6px -6px, -6px 0";
    outputEl.value = css;
  }

  function renderGradientStops() {
    const container = document.getElementById("gradientStops");
    if (!container) {
      return;
    }
    const canRemove = gradientStops.length > 2;
    container.innerHTML = gradientStops
      .map(
        (stop, index) =>
          '<div class="gradient-stop" data-stop-index="' +
          index +
          '"><input type="color" class="color-native-picker" data-stop-field="color" value="' +
          stop.color +
          '" aria-label="Stop ' +
          (index + 1) +
          ' color"><input type="number" class="tool-input gradient-stop-alpha" data-stop-field="alpha" min="0" max="1" step="0.1" value="' +
          stop.alpha +
          '" aria-label="Stop ' +
          (index + 1) +
          ' alpha" title="Alpha (0-1)"><input type="number" class="tool-input gradient-stop-position" data-stop-field="position" min="0" max="100" value="' +
          stop.position +
          '" aria-label="Stop ' +
          (index + 1) +
          ' position"><span class="gradient-stop-percent">%</span><button type="button" class="icon-button gradient-stop-remove" data-stop-remove="' +
          index +
          '" title="Remove stop" aria-label="Remove stop ' +
          (index + 1) +
          '" ' +
          (canRemove ? "" : "disabled") +
          '><i class="codicon codicon-trash"></i></button></div>'
      )
      .join("");
  }

  function updateGradientStopField(fieldEl) {
    const stopEl = fieldEl.closest("[data-stop-index]");
    if (!stopEl) {
      return;
    }
    const index = Number(stopEl.getAttribute("data-stop-index"));
    const field = fieldEl.getAttribute("data-stop-field");
    const stop = gradientStops[index];
    if (!stop) {
      return;
    }
    if (field === "color") {
      stop.color = fieldEl.value;
    } else if (field === "alpha") {
      stop.alpha = Math.max(0, Math.min(1, Number(fieldEl.value)));
    } else if (field === "position") {
      stop.position = Math.max(0, Math.min(100, Math.round(Number(fieldEl.value))));
    }
    updateGradientPreview();
    persistGradientState();
  }

  function addGradientStop() {
    const positions = gradientStops.map((stop) => stop.position);
    const nextPosition = positions.length > 0 ? Math.max(0, Math.min(100, Math.max(...positions) + 10)) : 50;
    gradientStops.push({ color: "#ffffff", alpha: 1, position: nextPosition });
    renderGradientStops();
    updateGradientPreview();
    persistGradientState();
  }

  function removeGradientStop(index) {
    if (gradientStops.length <= 2) {
      return;
    }
    gradientStops.splice(index, 1);
    renderGradientStops();
    updateGradientPreview();
    persistGradientState();
  }

  function activateGradientType(type) {
    gradientType = type;
    const selectEl = document.getElementById("gradientType");
    if (selectEl && selectEl.value !== type) {
      selectEl.value = type;
    }
    const angleRow = document.getElementById("gradientAngleRow");
    if (angleRow) {
      angleRow.hidden = type === "radial";
    }
    updateGradientPreview();
    persistGradientState();
  }

  const TAILWIND_CATEGORY_RULES = [
    { test: /^(container|box-border|box-content|block|inline-block|inline|flex|inline-flex|grid|inline-grid|hidden|contents|list-item|table|inline-table|table-.*|flow-root)$/, category: 0 },
    { test: /^(float-|clear-|isolate|object-|overflow-|overscroll-|static|fixed|absolute|relative|sticky|inset-|top-|right-|bottom-|left-|z-)/, category: 0 },
    { test: /^(flex-|grow|grow-|shrink|shrink-|order-|grid-|col-|row-|gap-|justify-|items-|content-|self-|place-)/, category: 1 },
    { test: /^(p|px|py|pt|pr|pb|pl|space-x-|space-y-)-/, category: 2 },
    { test: /^(m|mx|my|mt|mr|mb|ml)-/, category: 2 },
    { test: /^(w-|min-w-|max-w-|h-|min-h-|max-h-|size-)/, category: 3 },
    { test: /^(font-|text-|leading-|tracking-|whitespace-|break-|list-|decoration-|indent-|align-)/, category: 4 },
    { test: /^bg-/, category: 5 },
    { test: /^(border|rounded|divide-|outline-|ring-)/, category: 6 },
    { test: /^(shadow-|opacity-|mix-blend-|bg-blend-)/, category: 7 },
    { test: /^(filter|blur-|brightness-|contrast-|drop-shadow-|grayscale|hue-rotate-|invert|saturate-|sepia|backdrop-)/, category: 8 },
    { test: /^(transition|duration-|ease-|delay-|animate-)/, category: 9 },
    { test: /^(transform|scale-|rotate-|translate-|skew-|origin-)/, category: 10 },
    { test: /^(cursor-|select-|resize|scroll-|touch-|pointer-events-|appearance-)/, category: 11 },
    { test: /^(fill-|stroke-)/, category: 12 },
    { test: /^(sr-only|not-sr-only)$/, category: 13 }
  ];

  const TAILWIND_CONFLICT_FAMILIES = [
    { test: /^(block|inline-block|inline|flex|inline-flex|grid|inline-grid|hidden|contents|list-item|table|inline-table|flow-root)$/, family: "display" },
    { test: /^(static|fixed|absolute|relative|sticky)$/, family: "position" },
    { test: /^text-(left|center|right|justify|start|end)$/, family: "text-align" },
    { test: /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/, family: "font-weight" },
    { test: /^flex-(row|row-reverse|col|col-reverse)$/, family: "flex-direction" },
    { test: /^justify-(start|end|center|between|around|evenly|stretch|normal)$/, family: "justify-content" },
    { test: /^items-(start|end|center|baseline|stretch)$/, family: "align-items" },
    { test: /^text-(xs|sm|base|lg|xl|[2-9]xl)$/, family: "text-size" },
    { test: /^text-(black|white|transparent|current|inherit|\\w+-\\d{2,3})$/, family: "text-color" },
    { test: /^bg-(black|white|transparent|current|inherit|\\w+-\\d{2,3})$/, family: "bg-color" },
    { test: /^w-[\\w./\\[\\]%]+$/, family: "width" },
    { test: /^h-[\\w./\\[\\]%]+$/, family: "height" },
    { test: /^opacity-\\d+$/, family: "opacity" },
    { test: /^z-[\\w\\[\\]]+$/, family: "z-index" },
    { test: /^rounded(-(none|sm|md|lg|xl|2xl|3xl|full))?$/, family: "rounded" },
    { test: /^p-/, family: "p" },
    { test: /^px-/, family: "px" },
    { test: /^py-/, family: "py" },
    { test: /^pt-/, family: "pt" },
    { test: /^pr-/, family: "pr" },
    { test: /^pb-/, family: "pb" },
    { test: /^pl-/, family: "pl" },
    { test: /^m-/, family: "m" },
    { test: /^mx-/, family: "mx" },
    { test: /^my-/, family: "my" },
    { test: /^mt-/, family: "mt" },
    { test: /^mr-/, family: "mr" },
    { test: /^mb-/, family: "mb" },
    { test: /^ml-/, family: "ml" }
  ];

  function splitVariant(cls) {
    const lastColon = cls.lastIndexOf(":");
    return lastColon === -1 ? { variants: "", base: cls } : { variants: cls.slice(0, lastColon + 1), base: cls.slice(lastColon + 1) };
  }

  function classifyCategory(base) {
    for (const rule of TAILWIND_CATEGORY_RULES) {
      if (rule.test.test(base)) {
        return rule.category;
      }
    }
    return 99;
  }

  function classifyConflictFamily(base) {
    for (const rule of TAILWIND_CONFLICT_FAMILIES) {
      if (rule.test.test(base)) {
        return rule.family;
      }
    }
    return undefined;
  }

  function optimizeTailwindClasses(input) {
    const rawClasses = input.split(/\\s+/).filter(Boolean);
    const seen = new Set();
    const deduped = [];
    let duplicateCount = 0;
    for (const cls of rawClasses) {
      if (seen.has(cls)) {
        duplicateCount++;
        continue;
      }
      seen.add(cls);
      deduped.push(cls);
    }

    const lastIndexByKey = new Map();
    deduped.forEach((cls, index) => {
      const { variants, base } = splitVariant(cls);
      const family = classifyConflictFamily(base);
      if (family !== undefined) {
        lastIndexByKey.set(variants + "|" + family, index);
      }
    });

    const survivors = [];
    const removedClasses = [];
    deduped.forEach((cls, index) => {
      const { variants, base } = splitVariant(cls);
      const family = classifyConflictFamily(base);
      if (family !== undefined && lastIndexByKey.get(variants + "|" + family) !== index) {
        removedClasses.push(cls);
        return;
      }
      survivors.push({ cls, index, variants, base });
    });

    survivors.sort((a, b) => {
      const variantRank = (a.variants === "" ? 0 : 1) - (b.variants === "" ? 0 : 1);
      if (variantRank !== 0) {
        return variantRank;
      }
      const categoryRank = classifyCategory(a.base) - classifyCategory(b.base);
      if (categoryRank !== 0) {
        return categoryRank;
      }
      return a.index - b.index;
    });

    return {
      result: survivors.map((entry) => entry.cls).join(" "),
      removedCount: duplicateCount + removedClasses.length,
      removedClasses
    };
  }

  function applyTailwindOptimize() {
    const tailwindInput = document.getElementById("tailwindInput");
    const summaryEl = document.getElementById("tailwindSummary");
    if (!tailwindInput || !summaryEl) {
      return;
    }
    const { result, removedCount, removedClasses } = optimizeTailwindClasses(tailwindInput.value);
    tailwindInput.value = result;
    persistDevToolsField("tailwindInput", result);
    summaryEl.textContent =
      removedCount === 0
        ? "No duplicates or conflicts found"
        : "Removed " + removedCount + " duplicate/conflicting class(es)" + (removedClasses.length > 0 ? ": " + removedClasses.join(", ") : "");
  }

  function svgToUrlEncodedCss(svg) {
    const cleaned = svg.replace(/"/g, "'").replace(/\\s+/g, " ").trim();
    return 'background-image: url("data:image/svg+xml,' + encodeURIComponent(cleaned) + '");';
  }

  function svgToBase64Css(svg) {
    return 'background-image: url("data:image/svg+xml;base64,' + utf8ToBase64(svg) + '");';
  }

  function activateSvgTarget(target) {
    document.querySelectorAll("[data-svg-target]").forEach((button) => {
      button.classList.toggle("active", button.getAttribute("data-svg-target") === target);
    });
    persistDevToolsField("svgTarget", target);
    updateSvgPreview();
  }

  function updateSvgPreview() {
    const svgInput = document.getElementById("svgInput");
    const outputEl = document.getElementById("svgOutput");
    if (!svgInput || !outputEl) {
      return;
    }
    if (svgInput.value.trim() === "") {
      outputEl.textContent = "";
      return;
    }
    const activeButton = document.querySelector("[data-svg-target].active");
    const target = activeButton ? activeButton.getAttribute("data-svg-target") : "urlencoded";
    outputEl.textContent = target === "base64" ? svgToBase64Css(svgInput.value) : svgToUrlEncodedCss(svgInput.value);
  }

  function base64UrlDecode(segment) {
    let base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padding = base64.length % 4;
    if (padding === 2) {
      base64 += "==";
    } else if (padding === 3) {
      base64 += "=";
    } else if (padding !== 0) {
      throw new Error("Invalid base64url segment");
    }
    return base64ToUtf8(base64);
  }

  function decodeJwt(token) {
    const parts = token.trim().split(".");
    if (parts.length !== 3) {
      throw new Error("Expected a JWT with 3 dot-separated parts (header.payload.signature)");
    }
    const header = JSON.parse(base64UrlDecode(parts[0]));
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    return { header, payload };
  }

  function formatJwtMagnitude(deltaSeconds) {
    const abs = Math.abs(deltaSeconds);
    if (abs < 60) {
      return Math.round(abs) + "s";
    }
    if (abs < 3600) {
      return Math.round(abs / 60) + "m";
    }
    if (abs < 86400) {
      return Math.round(abs / 3600) + "h";
    }
    return Math.round(abs / 86400) + "d";
  }

  function updateJwtInspector() {
    const jwtInput = document.getElementById("jwtInput");
    const errorEl = document.getElementById("jwtError");
    const summaryEl = document.getElementById("jwtSummary");
    const headerEl = document.getElementById("jwtHeader");
    const payloadEl = document.getElementById("jwtPayload");
    if (!jwtInput || !errorEl || !summaryEl || !headerEl || !payloadEl) {
      return;
    }
    if (jwtInput.value.trim() === "") {
      errorEl.hidden = true;
      summaryEl.textContent = "";
      headerEl.textContent = "";
      payloadEl.textContent = "";
      return;
    }
    try {
      const { header, payload } = decodeJwt(jwtInput.value);
      errorEl.hidden = true;
      headerEl.textContent = JSON.stringify(header, null, 2);
      payloadEl.textContent = JSON.stringify(payload, null, 2);
      if (typeof payload.exp === "number") {
        const deltaSeconds = payload.exp - Math.floor(Date.now() / 1000);
        summaryEl.textContent = deltaSeconds < 0 ? "Expired " + formatJwtMagnitude(deltaSeconds) + " ago" : "Expires in " + formatJwtMagnitude(deltaSeconds);
      } else {
        summaryEl.textContent = "No exp claim";
      }
    } catch (error) {
      errorEl.hidden = false;
      errorEl.textContent = error instanceof Error ? error.message : String(error);
      summaryEl.textContent = "";
      headerEl.textContent = "";
      payloadEl.textContent = "";
    }
  }

  async function runBcryptHash() {
    const passwordEl = document.getElementById("hashPassword");
    const roundsEl = document.getElementById("hashRounds");
    const outputEl = document.getElementById("hashOutput");
    const errorEl = document.getElementById("hashError");
    const button = document.getElementById("hashButton");
    if (!passwordEl || !roundsEl || !outputEl || !errorEl || !button) {
      return;
    }
    const rounds = Math.max(4, Math.min(14, Number(roundsEl.value) || 10));
    roundsEl.value = rounds;
    errorEl.hidden = true;
    button.disabled = true;
    const originalLabel = button.textContent;
    button.textContent = "Hashing…";
    try {
      outputEl.value = await bcrypt.hash(passwordEl.value, rounds);
    } catch (error) {
      errorEl.hidden = false;
      errorEl.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }

  async function runBcryptVerify() {
    const passwordEl = document.getElementById("verifyPassword");
    const hashEl = document.getElementById("verifyHash");
    const resultEl = document.getElementById("verifyResult");
    const button = document.getElementById("verifyButton");
    if (!passwordEl || !hashEl || !resultEl || !button) {
      return;
    }
    button.disabled = true;
    const originalLabel = button.textContent;
    button.textContent = "Verifying…";
    try {
      const matches = await bcrypt.compare(passwordEl.value, hashEl.value);
      let roundsNote = "";
      try {
        roundsNote = " (" + bcrypt.getRounds(hashEl.value) + " rounds)";
      } catch (error) {
        // Not a hash we can introspect the cost factor of - omit the rounds note.
      }
      resultEl.textContent = (matches ? "✓ Match" : "✗ No match") + roundsNote;
    } catch (error) {
      resultEl.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }

  function selectTool(id) {
    document.querySelectorAll(".tool-panel").forEach((panel) => {
      panel.hidden = panel.getAttribute("data-tool-panel") !== id;
    });
    document.querySelectorAll(".devtools-nav-item").forEach((item) => {
      item.classList.toggle("active", item.getAttribute("data-tool-select") === id);
    });
    const detail = document.querySelector(".devtools-detail");
    if (detail) {
      detail.scrollTop = 0;
    }
    persistDevToolsField("activeTool", id);
  }

  let navGroupCollapsed = {};

  function toggleNavGroup(groupId) {
    navGroupCollapsed[groupId] = !navGroupCollapsed[groupId];
    const header = document.querySelector('[data-nav-group-toggle="' + groupId + '"]');
    if (header) {
      header.setAttribute("aria-expanded", navGroupCollapsed[groupId] ? "false" : "true");
    }
    persistDevToolsField("navGroupsCollapsed", navGroupCollapsed);
    const searchEl = document.getElementById("toolSearch");
    filterToolNav(searchEl ? searchEl.value : "");
  }

  function filterToolNav(query) {
    const normalized = query.trim().toLowerCase();
    document.querySelectorAll(".devtools-nav-group").forEach((group) => {
      const groupId = group.getAttribute("data-nav-group");
      const itemsEl = group.querySelector(".devtools-nav-group-items");
      let visibleCount = 0;
      group.querySelectorAll(".devtools-nav-item").forEach((item) => {
        const matches = normalized === "" || (item.getAttribute("data-tool-search") || "").includes(normalized);
        item.hidden = !matches;
        if (matches) {
          visibleCount++;
        }
      });
      group.hidden = visibleCount === 0;
      if (itemsEl) {
        itemsEl.hidden = normalized === "" && !!navGroupCollapsed[groupId];
      }
    });
  }

  function legacyCopy(text) {
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.focus();
    helper.select();
    try {
      document.execCommand("copy");
    } catch (error) {
      // Clipboard access unavailable in this environment - nothing more we can do.
    }
    document.body.removeChild(helper);
  }

  function copyTextToClipboard(text, label) {
    const showCopied = () => {
      if (!label) {
        return;
      }
      const original = label.textContent;
      label.textContent = "Copied";
      setTimeout(() => {
        label.textContent = original;
      }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(showCopied, () => {
        legacyCopy(text);
        showCopied();
      });
    } else {
      legacyCopy(text);
      showCopied();
    }
  }

  const requestedInitialTab = ${JSON.stringify(requestedInitialTab ?? null)};
  if (requestedInitialTab) {
    activateTab(requestedInitialTab);
  } else if (currentState.activeTab) {
    activateTab(currentState.activeTab);
  }

  if (currentState.devTools) {
    const patternEl = document.getElementById("regexPattern");
    const flagsEl = document.getElementById("regexFlags");
    const inputEl = document.getElementById("regexInput");
    const caseInputEl = document.getElementById("caseInput");
    const jsonInputEl = document.getElementById("jsonInput");
    const encodeInputEl = document.getElementById("encodeInput");
    const curlInputEl = document.getElementById("curlInput");
    const tailwindInputEl = document.getElementById("tailwindInput");
    const svgInputEl = document.getElementById("svgInput");
    const jwtInputEl = document.getElementById("jwtInput");
    if (patternEl && currentState.devTools.pattern !== undefined) {
      patternEl.value = currentState.devTools.pattern;
    }
    if (flagsEl && currentState.devTools.flags !== undefined) {
      flagsEl.value = currentState.devTools.flags;
    }
    if (inputEl && currentState.devTools.testString !== undefined) {
      inputEl.value = currentState.devTools.testString;
    }
    if (caseInputEl && currentState.devTools.caseInput !== undefined) {
      caseInputEl.value = currentState.devTools.caseInput;
    }
    if (jsonInputEl && currentState.devTools.jsonInput !== undefined) {
      jsonInputEl.value = currentState.devTools.jsonInput;
    }
    if (encodeInputEl && currentState.devTools.encodeInput !== undefined) {
      encodeInputEl.value = currentState.devTools.encodeInput;
    }
    if (curlInputEl && currentState.devTools.curlInput !== undefined) {
      curlInputEl.value = currentState.devTools.curlInput;
    }
    if (tailwindInputEl && currentState.devTools.tailwindInput !== undefined) {
      tailwindInputEl.value = currentState.devTools.tailwindInput;
    }
    if (svgInputEl && currentState.devTools.svgInput !== undefined) {
      svgInputEl.value = currentState.devTools.svgInput;
    }
    if (jwtInputEl && currentState.devTools.jwtInput !== undefined) {
      jwtInputEl.value = currentState.devTools.jwtInput;
    }
    if (currentState.devTools.colorHex !== undefined) {
      try {
        currentColor = hexToRgb(currentState.devTools.colorHex);
      } catch (error) {
        // Ignore a corrupted persisted value and keep the default color.
      }
    }
    const savedGradient = currentState.devTools.gradient;
    if (savedGradient && Array.isArray(savedGradient.stops) && savedGradient.stops.length >= 2) {
      gradientStops = savedGradient.stops;
      if (savedGradient.type === "linear" || savedGradient.type === "radial" || savedGradient.type === "conic") {
        gradientType = savedGradient.type;
      }
      if (typeof savedGradient.angle === "number") {
        gradientAngle = savedGradient.angle;
      }
    }
    if (currentState.devTools.navGroupsCollapsed) {
      navGroupCollapsed = currentState.devTools.navGroupsCollapsed;
    }
  }
  updateRegexTester();
  updateJsonTool();
  activateCurlTarget((currentState.devTools && currentState.devTools.curlTarget) || "fetch");
  renderColorFields();
  activateSvgTarget((currentState.devTools && currentState.devTools.svgTarget) || "urlencoded");
  updateJwtInspector();
  document.querySelectorAll("[data-nav-group-toggle]").forEach((header) => {
    const groupId = header.getAttribute("data-nav-group-toggle");
    header.setAttribute("aria-expanded", navGroupCollapsed[groupId] ? "false" : "true");
  });
  filterToolNav("");
  const requestedTool = (currentState.devTools && currentState.devTools.activeTool) || "regex";
  selectTool(document.querySelector('[data-tool-panel="' + requestedTool + '"]') ? requestedTool : "regex");
  const gradientAngleEl = document.getElementById("gradientAngle");
  if (gradientAngleEl) {
    gradientAngleEl.value = gradientAngle;
  }
  updateAngleDialVisual();
  renderGradientStops();
  activateGradientType(gradientType);
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

/** A small labeled divider between two sub-tools sharing one Dev Tools panel (see the merged Color Picker & Gradient Builder entry). */
function subheader(icon: string, colorToken: string, title: string): string {
  return `<div class="tool-panel-subheader">${iconBadge(icon, colorToken, "small")}<h3>${escapeHtml(title)}</h3></div>`;
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
  .tab-panel[data-tab-panel="devtools"] { max-width: 1200px; }
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

  .devtools-layout { display: flex; gap: 24px; align-items: stretch; height: calc(100vh - 160px); min-height: 420px; }
  .devtools-nav { flex: none; width: 240px; display: flex; flex-direction: column; gap: 16px; height: 100%; min-height: 0; }
  .devtools-search { position: relative; display: flex; align-items: center; flex: none; }
  .devtools-search .codicon { position: absolute; left: 9px; font-size: 14px; color: var(--vscode-descriptionForeground); pointer-events: none; }
  .devtools-search input { width: 100%; padding: 6px 10px 6px 30px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, var(--vscode-panel-border))); border-radius: 6px; font-family: inherit; font-size: 0.9em; }
  .devtools-search input:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .devtools-nav-groups { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; padding-right: 4px; }
  .devtools-nav-group-header { display: flex; align-items: center; justify-content: space-between; gap: 6px; width: 100%; background: transparent; border: none; color: var(--vscode-descriptionForeground); padding: 5px 10px; cursor: pointer; font-family: inherit; font-size: 0.72em; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; border-radius: 6px; }
  .devtools-nav-group-header:hover { background: var(--vscode-list-hoverBackground); color: var(--vscode-foreground); }
  .devtools-nav-group-header .codicon { font-size: 12px; transition: transform 0.15s ease; }
  .devtools-nav-group-header[aria-expanded="false"] .codicon { transform: rotate(-90deg); }
  .devtools-nav-group-items { display: flex; flex-direction: column; gap: 2px; margin-top: 4px; }
  .devtools-nav-group-items[hidden] { display: none; }
  .devtools-nav-item { display: flex; align-items: center; gap: 10px; width: 100%; background: transparent; color: var(--vscode-foreground); border: none; border-radius: 6px; padding: 7px 10px; cursor: pointer; font-family: inherit; font-size: 0.9em; text-align: left; }
  .devtools-nav-item:hover { background: var(--vscode-list-hoverBackground); }
  .devtools-nav-item.active { background: var(--vscode-list-activeSelectionBackground, var(--vscode-list-hoverBackground)); color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground)); font-weight: 600; }
  .devtools-nav-item span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .devtools-nav-item[hidden], .devtools-nav-group[hidden] { display: none; }
  .devtools-detail { flex: 1; min-width: 0; height: 100%; overflow-y: auto; padding-right: 4px; }
  .tool-panel-header { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
  .tool-panel-header h2 { margin: 0; font-size: 1.05em; font-weight: 600; }
  .tool-panel-subheader { display: flex; align-items: center; gap: 8px; margin: 24px 0 12px; }
  .tool-panel-subheader:first-child { margin-top: 0; }
  .tool-panel-subheader h3 { margin: 0; font-size: 0.95em; font-weight: 600; }
  @media (max-width: 700px) {
    .devtools-layout { flex-direction: column; height: auto; min-height: 0; }
    .devtools-nav { width: 100%; height: auto; }
    .devtools-nav-groups { max-height: 260px; }
    .devtools-detail { height: auto; overflow-y: visible; }
  }

  .tool-card { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 10px; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
  .tool-row { display: flex; flex-direction: column; gap: 4px; }
  .tool-label { font-size: 0.76em; text-transform: uppercase; letter-spacing: 0.05em; color: var(--vscode-descriptionForeground); }
  .tool-input, .tool-textarea { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, var(--vscode-panel-border))); border-radius: 6px; padding: 6px 8px; font-family: inherit; font-size: 0.92em; resize: vertical; }
  .tool-input:focus, .tool-textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .tool-input-small { max-width: 140px; }
  .tool-mono { font-family: var(--vscode-editor-font-family, monospace); }
  .tool-error { color: var(--vscode-errorForeground, #f14c4c); font-size: 0.88em; }
  .tool-summary { font-size: 0.82em; color: var(--vscode-descriptionForeground); }
  .tool-note { margin: 0; font-size: 0.82em; line-height: 1.5; color: var(--vscode-descriptionForeground); }
  .tool-preview { margin: 0; padding: 8px 10px; background: var(--vscode-textCodeBlock-background); border-radius: 6px; font-family: var(--vscode-editor-font-family, monospace); font-size: 0.85em; line-height: 1.5; white-space: pre-wrap; word-break: break-word; max-height: 12em; overflow-y: auto; }
  .tool-preview mark { background: var(--vscode-editor-findMatchHighlightBackground, color-mix(in srgb, var(--vscode-charts-yellow, #cca700) 45%, transparent)); color: inherit; border-radius: 2px; }
  .match-list { display: flex; flex-direction: column; gap: 4px; max-height: 12em; overflow-y: auto; }
  .match-item { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.82em; line-height: 1.5; padding: 6px 8px; background: var(--vscode-textCodeBlock-background); border-radius: 6px; color: var(--vscode-descriptionForeground); }
  .tool-button-row { display: flex; flex-wrap: wrap; gap: 8px; }
  .tool-button { background: var(--vscode-button-secondaryBackground, var(--vscode-editorWidget-background)); color: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 6px; padding: 6px 12px; cursor: pointer; font-family: inherit; font-size: 0.88em; display: inline-flex; align-items: center; gap: 6px; }
  .tool-button:hover { border-color: var(--vscode-focusBorder); }
  .tool-button.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: var(--vscode-button-background); }
  .tool-button-secondary { margin-left: auto; }

  .tool-input-with-copy { display: flex; gap: 6px; align-items: center; }
  .tool-input-with-copy .tool-input { flex: 1; }
  .color-row { display: flex; align-items: center; gap: 12px; }
  .color-native-picker { width: 44px; height: 32px; padding: 0; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 6px; background: none; cursor: pointer; }
  .color-swatch {
    flex: 1; height: 32px; border-radius: 6px; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    background-image: linear-gradient(45deg, rgba(128,128,128,0.3) 25%, transparent 25%), linear-gradient(-45deg, rgba(128,128,128,0.3) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(128,128,128,0.3) 75%), linear-gradient(-45deg, transparent 75%, rgba(128,128,128,0.3) 75%);
    background-size: 12px 12px; background-position: 0 0, 0 6px, 6px -6px, -6px 0;
  }

  .angle-dial-row { display: flex; align-items: center; gap: 12px; }
  .angle-dial { position: relative; flex: none; width: 44px; height: 44px; border-radius: 50%; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); background: var(--vscode-input-background); cursor: pointer; touch-action: none; }
  .angle-dial:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
  .angle-dial-handle { position: absolute; bottom: 50%; left: 50%; width: 2px; height: 16px; margin-left: -1px; background: var(--vscode-focusBorder, var(--vscode-textLink-foreground)); border-radius: 1px; transform-origin: bottom center; }
  .gradient-stops { display: flex; flex-direction: column; gap: 8px; }
  .gradient-stop { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .gradient-stop-position, .gradient-stop-alpha { width: 64px; }
  .gradient-stop-percent { color: var(--vscode-descriptionForeground); font-size: 0.82em; }
  .gradient-stop-remove { margin-left: auto; }
  .gradient-preview { height: 40px; border-radius: 6px; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); }

  @media (prefers-reduced-motion: reduce) {
    .codicon-modifier-spin { animation: none; }
    .tile, .icon-button, .tab-button { transition: none; }
    .devtools-nav-group-header .codicon { transition: none; }
  }
`;
