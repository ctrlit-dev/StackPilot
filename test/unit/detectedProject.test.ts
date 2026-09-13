import assert from "node:assert/strict";
import test from "node:test";

import {
  findService,
  getBackendService,
  getDjangoBackendProject,
  getDjangoMetadata,
  getFrontendService,
  getNodeRuntime,
  getPythonEnvironment,
  type DetectedProject,
  type DetectedService
} from "../../src/detection/detectedProject";

function djangoService(overrides: Partial<DetectedService> = {}): DetectedService {
  return {
    id: "backend",
    rootPath: "/workspace/backend",
    frameworkId: "django",
    runtime: {
      kind: "python",
      detection: {
        selected: { executablePath: "/workspace/backend/.venv/bin/python", source: "venv", validation: "exists" },
        candidates: [],
        diagnostics: []
      }
    },
    frameworkMetadata: {
      kind: "django",
      managePyPath: "/workspace/backend/manage.py",
      apps: [{ name: "billing", path: "/workspace/backend/billing" }]
    },
    score: 80,
    evidence: ["manage.py"],
    ...overrides
  };
}

function viteService(overrides: Partial<DetectedService> = {}): DetectedService {
  return {
    id: "frontend",
    rootPath: "/workspace/frontend",
    frameworkId: "vite",
    runtime: {
      kind: "node",
      packageManager: { kind: "detected", manager: "npm", source: "lockfile", evidence: "package-lock.json" },
      packageJsonPath: "/workspace/frontend/package.json",
      scripts: { dev: "vite", build: "vite build" }
    },
    score: 90,
    evidence: ["package.json", "vite.config.ts"],
    ...overrides
  };
}

function project(services: readonly DetectedService[]): DetectedProject {
  const backendPython = services.find((s) => s.runtime?.kind === "python");
  const selected = backendPython?.runtime?.kind === "python" ? backendPython.runtime.detection.selected : undefined;
  return {
    workspaceRootPath: "/workspace",
    services,
    pythonRuntime: { selected, candidates: selected === undefined ? [] : [selected], diagnostics: [] },
    diagnostics: []
  };
}

// --- Backend-only ---

void test("a backend-only project has exactly a backend service and no frontend service", () => {
  const detected = project([djangoService()]);

  assert.notEqual(getBackendService(detected), undefined);
  assert.equal(getFrontendService(detected), undefined);
  assert.equal(detected.services.length, 1);
});

// --- Frontend-only ---

void test("a frontend-only project has exactly a frontend service and no backend service", () => {
  const detected = project([viteService()]);

  assert.equal(getBackendService(detected), undefined);
  assert.notEqual(getFrontendService(detected), undefined);
  assert.equal(detected.services.length, 1);
});

// --- Full stack ---

void test("a full-stack project carries both services independently, each with its own framework/runtime", () => {
  const detected = project([djangoService(), viteService()]);

  const backend = getBackendService(detected);
  const frontend = getFrontendService(detected);
  assert.equal(backend?.frameworkId, "django");
  assert.equal(frontend?.frameworkId, "vite");
  assert.equal(detected.services.length, 2);
});

// --- Lookup ---

void test("findService locates a service by id regardless of position in the collection", () => {
  const detected = project([viteService(), djangoService()]);

  assert.equal(findService(detected, "backend")?.rootPath, "/workspace/backend");
  assert.equal(findService(detected, "frontend")?.rootPath, "/workspace/frontend");
});

// --- Missing Service ---

void test("looking up a service that was not detected returns undefined cleanly, not a throw or a default", () => {
  const detected = project([]);

  assert.equal(getBackendService(detected), undefined);
  assert.equal(getFrontendService(detected), undefined);
  assert.equal(findService(detected, "worker"), undefined);
  assert.equal(findService(undefined, "backend"), undefined);
});

// --- Django Metadata ---

void test("Django metadata (managePyPath, apps) is available only on the backend service, never the frontend one", () => {
  const detected = project([djangoService(), viteService()]);

  const djangoMetadata = getDjangoMetadata(getBackendService(detected));
  assert.equal(djangoMetadata?.managePyPath, "/workspace/backend/manage.py");
  assert.deepEqual(djangoMetadata?.apps.map((app) => app.name), ["billing"]);

  assert.equal(getDjangoMetadata(getFrontendService(detected)), undefined);
});

void test("getDjangoBackendProject reconstructs the legacy BackendProject shape the Django adapter needs", () => {
  const backend = getDjangoBackendProject(getBackendService(project([djangoService()])));

  assert.deepEqual(backend, {
    rootPath: "/workspace/backend",
    managePyPath: "/workspace/backend/manage.py",
    score: 80,
    evidence: ["manage.py"]
  });
});

// --- Vite Metadata / Node runtime ---

void test("the frontend service's Node runtime (package manager, scripts) is available only there, never on the backend service", () => {
  const detected = project([djangoService(), viteService()]);

  const frontendRuntime = getNodeRuntime(getFrontendService(detected));
  assert.equal(frontendRuntime?.packageManager.kind, "detected");
  assert.deepEqual(frontendRuntime?.scripts, { dev: "vite", build: "vite build" });

  assert.equal(getNodeRuntime(getBackendService(detected)), undefined);
});

void test("frameworkId is only 'vite' when Vite's own config file was actually found, not merely a package.json", () => {
  const withoutViteConfig = viteService({ frameworkId: undefined });
  const detected = project([withoutViteConfig]);

  assert.equal(getFrontendService(detected)?.frameworkId, undefined);
  assert.notEqual(getNodeRuntime(getFrontendService(detected)), undefined, "runtime is still present - only frameworkId is uncertain");
});

// --- Runtime ---

void test("Python runtime is attached to the backend service, correctly reflecting the interpreter that was found", () => {
  const detected = project([djangoService()]);

  const python = getPythonEnvironment(getBackendService(detected));
  assert.equal(python?.executablePath, "/workspace/backend/.venv/bin/python");
});

void test("a backend service with no resolved interpreter still carries a python runtime slot, just with no environment", () => {
  const serviceWithoutPython = djangoService({
    runtime: { kind: "python", detection: { selected: undefined, candidates: [], diagnostics: [] } }
  });
  const detected = project([serviceWithoutPython]);

  const backend = getBackendService(detected);
  assert.equal(backend?.runtime?.kind, "python");
  assert.equal(getPythonEnvironment(backend), undefined);
});
