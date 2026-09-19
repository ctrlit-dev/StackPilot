import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_CONFIGURATION } from "../../src/config/configurationModel";
import { COMMAND_INSTALL_PYTHON_DEPENDENCIES, COMMAND_MIGRATE } from "../../src/constants";
import type { BackendProject } from "../../src/detection/backendDetector";
import type { DetectedProject, DetectedService } from "../../src/detection/detectedProject";
import type { FrontendProject } from "../../src/detection/frontendDetector";
import type { PackageManagerDetection } from "../../src/detection/packageManagerDetector";
import type { PythonEnvironment } from "../../src/detection/pythonDetector";
import type { DiagnosticResult } from "../../src/diagnostics/diagnostic";
import type { ManagedProcessDescriptor } from "../../src/execution/processManager";
import { buildStackPilotTree, type TreeModelInput, type TreeNode } from "../../src/ui/stackPilotTreeModel";

function stoppedDescriptor(kind: "backend" | "frontend"): ManagedProcessDescriptor {
  return { kind, state: "stopped" };
}

function findNode(nodes: readonly TreeNode[], id: string): TreeNode | undefined {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    const child = node.children === undefined ? undefined : findNode(node.children, id);
    if (child !== undefined) {
      return child;
    }
  }
  return undefined;
}

function detectedProject(overrides: {
  backend?: BackendProject;
  frontend?: FrontendProject;
  python?: PythonEnvironment;
  djangoApps?: readonly { name: string; path: string }[];
} = {}): DetectedProject {
  const pythonDetection = {
    selected: overrides.python,
    candidates: overrides.python === undefined ? [] : [overrides.python],
    diagnostics: []
  };
  const services: DetectedService[] = [];
  if (overrides.backend !== undefined) {
    services.push({
      id: "backend",
      rootPath: overrides.backend.rootPath,
      frameworkId: "django",
      runtime: { kind: "python", detection: pythonDetection },
      frameworkMetadata: { kind: "django", managePyPath: overrides.backend.frameworkEntryPath, apps: overrides.djangoApps ?? [] },
      score: overrides.backend.score,
      evidence: overrides.backend.evidence
    });
  }
  if (overrides.frontend !== undefined) {
    services.push({
      id: "frontend",
      rootPath: overrides.frontend.rootPath,
      frameworkId: "vite",
      runtime: {
        kind: "node",
        packageManager: overrides.frontend.packageManager,
        packageJsonPath: overrides.frontend.packageJsonPath,
        scripts: overrides.frontend.scripts
      },
      score: overrides.frontend.score,
      evidence: overrides.frontend.evidence
    });
  }
  return {
    workspaceRootPath: "/workspace",
    services,
    pythonRuntime: pythonDetection,
    diagnostics: []
  };
}

function backendProject(): BackendProject {
  return { rootPath: "/workspace/backend", frameworkEntryPath: "/workspace/backend/manage.py", score: 80, evidence: ["manage.py"] };
}

function frontendProject(packageManager: PackageManagerDetection, scripts: Record<string, string> = { dev: "vite" }): FrontendProject {
  return {
    rootPath: "/workspace/frontend",
    packageJsonPath: "/workspace/frontend/package.json",
    scripts,
    packageManager,
    score: 90,
    evidence: ["package.json"]
  };
}

function baseInput(overrides: Partial<TreeModelInput> = {}): TreeModelInput {
  return {
    backend: stoppedDescriptor("backend"),
    frontend: stoppedDescriptor("frontend"),
    diagnostics: [],
    ...overrides
  };
}

void test("shows the backend as not detected when no backend was found", () => {
  const tree = buildStackPilotTree(baseInput());
  const node = findNode(tree, "backend");
  assert.equal(node?.description, "Not detected");
  assert.equal(node?.contextValue, "backendServer.notDetected");
});

void test("shows the backend as running with host:port", () => {
  const tree = buildStackPilotTree(
    baseInput({
      detectedProject: detectedProject({ backend: backendProject() }),
      configuration: { ...DEFAULT_CONFIGURATION, backendHost: "127.0.0.1" },
      backend: { kind: "backend", state: "running", expectedPort: 8000 }
    })
  );
  const node = findNode(tree, "backend");
  assert.equal(node?.description, "Running · 127.0.0.1:8000");
  assert.equal(node?.contextValue, "backendServer.running");
});

void test("surfaces the last error as a tooltip when the backend failed", () => {
  const tree = buildStackPilotTree(
    baseInput({
      detectedProject: detectedProject({ backend: backendProject() }),
      backend: { kind: "backend", state: "failed", lastError: "spawn python ENOENT" }
    })
  );
  const node = findNode(tree, "backend");
  assert.equal(node?.description, "Failed");
  assert.equal(node?.tooltip, "spawn python ENOENT");
});

void test("shows the frontend as not detected when no frontend was found", () => {
  const tree = buildStackPilotTree(baseInput());
  const node = findNode(tree, "frontend");
  assert.equal(node?.description, "Not detected");
  assert.equal(node?.contextValue, "frontendServer.notDetected");
});

void test("blocks the frontend row when the package manager is missing", () => {
  const tree = buildStackPilotTree(
    baseInput({
      detectedProject: detectedProject({
        frontend: frontendProject({ kind: "missing", reason: "No supported package-manager lockfile was found." })
      })
    })
  );
  const node = findNode(tree, "frontend");
  assert.equal(node?.description, "Package manager not found");
  assert.equal(node?.contextValue, "frontendServer.blocked");
});

void test("shows the frontend as startable once a package manager is detected", () => {
  const tree = buildStackPilotTree(
    baseInput({
      detectedProject: detectedProject({
        frontend: frontendProject({ kind: "detected", manager: "npm", source: "lockfile", evidence: "package-lock.json" })
      })
    })
  );
  const node = findNode(tree, "frontend");
  assert.equal(node?.description, "Stopped");
  assert.equal(node?.contextValue, "frontendServer.stopped");
});

void test("omits the Environment section until detection has run", () => {
  const tree = buildStackPilotTree(baseInput());
  assert.equal(findNode(tree, "environment"), undefined);
});

void test("shows Python version and path once detection has run", () => {
  const tree = buildStackPilotTree(
    baseInput({
      detectedProject: detectedProject({
        python: { executablePath: "/workspace/backend/.venv/bin/python", version: "3.13.2", source: "venv", validation: "version-probed" }
      })
    })
  );
  const node = findNode(tree, "environment.python");
  assert.equal(node?.description, "3.13.2 · /workspace/backend/.venv/bin/python");
});

void test("shows Python as not detected when no interpreter was found", () => {
  const tree = buildStackPilotTree(baseInput({ detectedProject: detectedProject() }));
  const node = findNode(tree, "environment.python");
  assert.equal(node?.description, "Not detected");
});

void test("shows the detected package manager under Environment once a frontend exists", () => {
  const tree = buildStackPilotTree(
    baseInput({
      detectedProject: detectedProject({
        frontend: frontendProject({ kind: "detected", manager: "pnpm", source: "lockfile", evidence: "pnpm-lock.yaml" })
      })
    })
  );
  const node = findNode(tree, "environment.packageManager");
  assert.equal(node?.description, "pnpm");
});

void test("omits backend operation rows when no backend is detected", () => {
  const tree = buildStackPilotTree(baseInput());
  const backend = findNode(tree, "backend");
  assert.equal(backend?.children, undefined);
});

void test("omits all Django-only backend operation rows when the detected backend is FastAPI, not Django", () => {
  const project: DetectedProject = {
    workspaceRootPath: "/workspace",
    services: [
      {
        id: "backend",
        rootPath: "/workspace",
        frameworkId: "fastapi",
        runtime: { kind: "python", detection: { selected: undefined, candidates: [], diagnostics: [] } },
        frameworkMetadata: { kind: "fastapi", appImport: "main:app" },
        score: 80,
        evidence: ["main.py"]
      }
    ],
    pythonRuntime: { selected: undefined, candidates: [], diagnostics: [] },
    diagnostics: []
  };

  const tree = buildStackPilotTree(baseInput({ detectedProject: project }));
  const backend = findNode(tree, "backend");
  assert.equal(backend?.children, undefined);
});

void test("shows backend operation rows once a backend is detected", () => {
  const tree = buildStackPilotTree(baseInput({ detectedProject: detectedProject({ backend: backendProject() }) }));
  const backend = findNode(tree, "backend");
  assert.deepEqual(
    backend?.children?.map((child) => child.id),
    [
      "backend.makeMigrations",
      "backend.migrate",
      "backend.showMigrations",
      "backend.shell",
      "backend.dbShell",
      "backend.superuser",
      "backend.createApp",
      "backend.test",
      "backend.installDependencies",
      "backend.envFile",
      "backend.runManagementCommand"
    ]
  );
});

void test("omits the Apps row when no Django apps were detected", () => {
  const tree = buildStackPilotTree(baseInput({ detectedProject: detectedProject({ backend: backendProject() }) }));
  assert.equal(findNode(tree, "backend.apps"), undefined);
});

void test("lists detected Django apps under an Apps row, each tagged for the per-app context menu", () => {
  const tree = buildStackPilotTree(
    baseInput({
      detectedProject: detectedProject({
        backend: backendProject(),
        djangoApps: [
          { name: "billing", path: "/workspace/backend/billing" },
          { name: "shipping", path: "/workspace/backend/shipping" }
        ]
      })
    })
  );
  const appsNode = findNode(tree, "backend.apps");
  assert.deepEqual(appsNode?.children?.map((child) => child.label), ["billing", "shipping"]);
  assert.ok(appsNode?.children?.every((child) => child.contextValue === "djangoApp"));
});

void test("omits frontend operation rows when the package manager is not resolved", () => {
  const tree = buildStackPilotTree(
    baseInput({
      detectedProject: detectedProject({
        frontend: frontendProject({ kind: "missing", reason: "No supported package-manager lockfile was found." })
      })
    })
  );
  const frontend = findNode(tree, "frontend");
  assert.equal(frontend?.children, undefined);
});

void test("shows install/build/test frontend rows only when their scripts exist", () => {
  const tree = buildStackPilotTree(
    baseInput({
      detectedProject: detectedProject({
        frontend: frontendProject(
          { kind: "detected", manager: "npm", source: "lockfile", evidence: "package-lock.json" },
          { dev: "vite", build: "vite build" }
        )
      }),
      configuration: DEFAULT_CONFIGURATION
    })
  );
  const frontend = findNode(tree, "frontend");
  assert.deepEqual(
    frontend?.children?.map((child) => child.id),
    ["frontend.installDependencies", "frontend.build", "frontend.envFile", "frontend.runScript"]
  );
});

void test("shows the frontend test row once a matching test script exists (not assumed by default)", () => {
  const tree = buildStackPilotTree(
    baseInput({
      detectedProject: detectedProject({
        frontend: frontendProject(
          { kind: "detected", manager: "npm", source: "lockfile", evidence: "package-lock.json" },
          { dev: "vite", build: "vite build", test: "vitest" }
        )
      }),
      configuration: DEFAULT_CONFIGURATION
    })
  );
  const frontend = findNode(tree, "frontend");
  assert.ok(frontend?.children?.some((child) => child.id === "frontend.test"));
});

void test("always includes the Tools section with New Project/Initialize Project/Refresh/Open Logs/Open Settings rows", () => {
  const tree = buildStackPilotTree(baseInput());
  const tools = findNode(tree, "tools");
  assert.deepEqual(
    tools?.children?.map((child) => child.id),
    [
      "tools.newProject",
      "tools.initializeProject",
      "tools.openDashboard",
      "tools.devTools",
      "tools.generateDebugConfig",
      "tools.refresh",
      "tools.openLogs",
      "tools.openSettings"
    ]
  );
  assert.ok(tools?.children?.every((child) => child.commandId !== undefined));
});

void test("offers to create a virtual environment when a backend is detected but no venv is", () => {
  const tree = buildStackPilotTree(baseInput({ detectedProject: detectedProject({ backend: backendProject() }) }));
  assert.ok(findNode(tree, "environment.createVenv") !== undefined);
});

void test("does not offer to create a virtual environment once one is already detected", () => {
  const tree = buildStackPilotTree(
    baseInput({
      detectedProject: detectedProject({
        backend: backendProject(),
        python: { executablePath: "/workspace/backend/.venv/bin/python", source: "venv", validation: "exists" }
      })
    })
  );
  assert.equal(findNode(tree, "environment.createVenv"), undefined);
});

void test("does not offer to create a virtual environment without a detected backend", () => {
  const tree = buildStackPilotTree(baseInput({ detectedProject: detectedProject() }));
  assert.equal(findNode(tree, "environment.createVenv"), undefined);
});

void test("EXPRESS-1C: offers to create a virtual environment for a FastAPI backend without a venv (Python-family, not just Django)", () => {
  const project: DetectedProject = {
    workspaceRootPath: "/workspace",
    services: [
      {
        id: "backend",
        rootPath: "/workspace",
        frameworkId: "fastapi",
        runtime: { kind: "python", detection: { selected: undefined, candidates: [], diagnostics: [] } },
        frameworkMetadata: { kind: "fastapi", appImport: "main:app" },
        score: 80,
        evidence: ["main.py"]
      }
    ],
    pythonRuntime: { selected: undefined, candidates: [], diagnostics: [] },
    diagnostics: []
  };

  const tree = buildStackPilotTree(baseInput({ detectedProject: project }));
  assert.ok(findNode(tree, "environment.createVenv") !== undefined);
});

void test("EXPRESS-1C: never offers to create a virtual environment for a detected Express backend (Node runtime), even with no venv-sourced Python anywhere in the workspace", () => {
  const project: DetectedProject = {
    workspaceRootPath: "/workspace",
    services: [
      {
        id: "backend",
        rootPath: "/workspace",
        frameworkId: "express",
        runtime: {
          kind: "node",
          packageManager: { kind: "detected", manager: "npm", source: "lockfile", evidence: "package-lock.json" },
          packageJsonPath: "/workspace/package.json",
          scripts: { dev: "node app.js" }
        },
        score: 80,
        evidence: ["app.js"]
      }
    ],
    // No selected Python at all (python?.source !== "venv" is true here too)
    // - proving the fix is not merely "was already true before", it is a
    // real, independent guard on the backend's own runtime.
    pythonRuntime: { selected: undefined, candidates: [], diagnostics: [] },
    diagnostics: []
  };

  const tree = buildStackPilotTree(baseInput({ detectedProject: project }));
  assert.equal(findNode(tree, "environment.createVenv"), undefined);
});

// --- Diagnostics ---

const migrationsPendingDiagnostic: DiagnosticResult = {
  code: "django.migrations.pending",
  severity: "warning",
  message: "There are unapplied Django migrations.",
  serviceId: "backend",
  action: { label: "Migrate", commandId: COMMAND_MIGRATE }
};

const interpreterMissingDiagnostic: DiagnosticResult = {
  code: "python.interpreter.missing",
  severity: "error",
  message: "No Python interpreter was found for the detected backend.",
  serviceId: "backend"
};

const fastApiDependencyMissingDiagnostic: DiagnosticResult = {
  code: "fastapi.dependency.missing",
  severity: "warning",
  message: "FastAPI is not installed in the detected virtual environment."
};

const infoDiagnostic: DiagnosticResult = {
  code: "example.info.notice",
  severity: "info",
  message: "An informational notice."
};

void test("omits the Diagnostics section until detection has run", () => {
  const tree = buildStackPilotTree(baseInput());
  assert.equal(findNode(tree, "diagnostics"), undefined);
});

void test("represents a healthy project as a Diagnostics section with a single 'No issues detected' child, no synthetic DiagnosticResult", () => {
  const tree = buildStackPilotTree(baseInput({ detectedProject: detectedProject({ backend: backendProject() }), diagnostics: [] }));
  const diagnosticsNode = findNode(tree, "diagnostics");
  assert.equal(diagnosticsNode?.description, undefined);
  assert.deepEqual(diagnosticsNode?.children?.map((child) => child.id), ["diagnostics.healthy"]);
  assert.equal(diagnosticsNode?.children?.[0].label, "No issues detected");
});

void test("renders a single warning diagnostic with its message and Migrate action", () => {
  const tree = buildStackPilotTree(
    baseInput({ detectedProject: detectedProject({ backend: backendProject() }), diagnostics: [migrationsPendingDiagnostic] })
  );
  const diagnosticsNode = findNode(tree, "diagnostics");
  assert.equal(diagnosticsNode?.description, "1 issue");
  assert.equal(diagnosticsNode?.children?.length, 1);

  const row = diagnosticsNode?.children?.[0];
  assert.equal(row?.label, "There are unapplied Django migrations.");
  assert.equal(row?.description, "Migrate");
  assert.equal(row?.commandId, COMMAND_MIGRATE);
});

void test("renders an error diagnostic with its message, and no command when it has no action", () => {
  const tree = buildStackPilotTree(
    baseInput({ detectedProject: detectedProject({ backend: backendProject() }), diagnostics: [interpreterMissingDiagnostic] })
  );
  const row = findNode(tree, `diagnostics.${interpreterMissingDiagnostic.code}`);
  assert.equal(row?.label, interpreterMissingDiagnostic.message);
  assert.equal(row?.commandId, undefined);
  assert.equal(row?.description, undefined);
  assert.notEqual(row?.icon?.id, undefined);
});

void test("renders error, warning, and info diagnostics with three mutually distinct icon shapes", () => {
  const project = detectedProject({ backend: backendProject() });
  const errorIcon = findNode(
    buildStackPilotTree(baseInput({ detectedProject: project, diagnostics: [interpreterMissingDiagnostic] })),
    `diagnostics.${interpreterMissingDiagnostic.code}`
  )?.icon?.id;
  const warningIcon = findNode(
    buildStackPilotTree(baseInput({ detectedProject: project, diagnostics: [migrationsPendingDiagnostic] })),
    `diagnostics.${migrationsPendingDiagnostic.code}`
  )?.icon?.id;
  const infoIcon = findNode(
    buildStackPilotTree(baseInput({ detectedProject: project, diagnostics: [infoDiagnostic] })),
    `diagnostics.${infoDiagnostic.code}`
  )?.icon?.id;

  assert.notEqual(errorIcon, undefined);
  assert.notEqual(warningIcon, undefined);
  assert.notEqual(infoIcon, undefined);
  assert.notEqual(errorIcon, warningIcon);
  assert.notEqual(errorIcon, infoIcon);
  assert.notEqual(warningIcon, infoIcon);
});

void test("a diagnostic without an action renders no command and no description (never a fabricated FastAPI install button)", () => {
  const tree = buildStackPilotTree(
    baseInput({ detectedProject: detectedProject({ backend: backendProject() }), diagnostics: [fastApiDependencyMissingDiagnostic] })
  );
  const row = findNode(tree, `diagnostics.${fastApiDependencyMissingDiagnostic.code}`);
  assert.equal(row?.commandId, undefined);
  assert.equal(row?.description, undefined);
});

void test("renders multiple diagnostics, preserving DiagnosticsController's own order and showing a plural count", () => {
  const tree = buildStackPilotTree(
    baseInput({
      detectedProject: detectedProject({ backend: backendProject() }),
      diagnostics: [interpreterMissingDiagnostic, migrationsPendingDiagnostic, infoDiagnostic]
    })
  );
  const diagnosticsNode = findNode(tree, "diagnostics");
  assert.equal(diagnosticsNode?.description, "3 issues");
  assert.deepEqual(
    diagnosticsNode?.children?.map((child) => child.id),
    [
      `diagnostics.${interpreterMissingDiagnostic.code}`,
      `diagnostics.${migrationsPendingDiagnostic.code}`,
      `diagnostics.${infoDiagnostic.code}`
    ]
  );
});

void test("a diagnostic's action commandId is used verbatim, never re-derived from its code/severity/serviceId", () => {
  const customAction: DiagnosticResult = {
    code: "django.dependency.missing",
    severity: "warning",
    message: "Django is not installed in the detected virtual environment.",
    serviceId: "backend",
    action: { label: "Install Python Dependencies", commandId: COMMAND_INSTALL_PYTHON_DEPENDENCIES }
  };
  const tree = buildStackPilotTree(
    baseInput({ detectedProject: detectedProject({ backend: backendProject() }), diagnostics: [customAction] })
  );
  const row = findNode(tree, `diagnostics.${customAction.code}`);
  assert.equal(row?.commandId, COMMAND_INSTALL_PYTHON_DEPENDENCIES);
  assert.equal(row?.description, "Install Python Dependencies");
});

// --- Package manager overlap (DIAGNOSTICS-1A/1D) ---

void test("an ambiguous package manager still shows exactly once in the Diagnostics section, alongside the pre-existing Frontend row state", () => {
  const packageManagerBlockedDiagnostic: DiagnosticResult = {
    code: "node.packageManager.blocked",
    severity: "warning",
    message: "Multiple package-manager lockfiles were found (npm, pnpm). Set stackPilot.frontend.packageManager to choose one."
  };
  const ambiguous: PackageManagerDetection = {
    kind: "ambiguous",
    candidates: [
      { manager: "npm", lockfile: "package-lock.json" },
      { manager: "pnpm", lockfile: "pnpm-lock.yaml" }
    ]
  };
  const tree = buildStackPilotTree(
    baseInput({
      detectedProject: detectedProject({ frontend: frontendProject(ambiguous) }),
      diagnostics: [packageManagerBlockedDiagnostic]
    })
  );

  // The Diagnostics section carries the one, full, actionable explanation.
  const diagnosticRows = findNode(tree, "diagnostics")?.children ?? [];
  assert.equal(diagnosticRows.filter((row) => row.id === "diagnostics.node.packageManager.blocked").length, 1);
  assert.equal(diagnosticRows[0].label, packageManagerBlockedDiagnostic.message);

  // The pre-existing Frontend row keeps its own short, distinct operability
  // state (why it cannot be started right now) - not removed, and not the
  // same text as the diagnostic's message, so nothing is shown twice verbatim.
  const frontendNode = findNode(tree, "frontend");
  assert.equal(frontendNode?.description, "Ambiguous package manager");
  assert.equal(frontendNode?.contextValue, "frontendServer.blocked");
  assert.notEqual(frontendNode?.description, packageManagerBlockedDiagnostic.message);

  // The Environment section's own Package Manager inventory row is likewise untouched.
  const environmentPackageManagerNode = findNode(tree, "environment.packageManager");
  assert.equal(environmentPackageManagerNode?.description, "Ambiguous (npm, pnpm)");
});
