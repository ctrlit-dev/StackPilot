import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_CONFIGURATION } from "../../src/config/configurationModel";
import type { BackendProject } from "../../src/detection/backendDetector";
import type { FrontendProject } from "../../src/detection/frontendDetector";
import type { PackageManagerDetection } from "../../src/detection/packageManagerDetector";
import type { PythonEnvironment } from "../../src/detection/pythonDetector";
import type { DetectedProject } from "../../src/detection/projectDetector";
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
  return {
    workspaceRootPath: "/workspace",
    backend: { selected: overrides.backend, candidates: [], diagnostics: [] },
    frontend: { selected: overrides.frontend, candidates: [], diagnostics: [] },
    python: { selected: overrides.python, candidates: [], diagnostics: [] },
    djangoApps: overrides.djangoApps,
    diagnostics: []
  };
}

function backendProject(): BackendProject {
  return { rootPath: "/workspace/backend", managePyPath: "/workspace/backend/manage.py", score: 80, evidence: ["manage.py"] };
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
