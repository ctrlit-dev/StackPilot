import assert from "node:assert/strict";
import test from "node:test";

import "./support/vscodeTestStub";

import { COMMAND_OPEN_ADMIN } from "../../src/constants";
import { frameworkDisplayLabel, type DetectedService } from "../../src/detection/detectedProject";
import type { ManagedProcessDescriptor } from "../../src/execution/processManager";
import { backendExtraActions, serverStatCard } from "../../src/ui/dashboardPanelController";

function djangoService(): DetectedService {
  return {
    id: "backend",
    rootPath: "/workspace/backend",
    frameworkId: "django",
    frameworkMetadata: { kind: "django", managePyPath: "/workspace/backend/manage.py", apps: [] },
    score: 80,
    evidence: ["manage.py"]
  };
}

function fastApiService(): DetectedService {
  return {
    id: "backend",
    rootPath: "/workspace",
    frameworkId: "fastapi",
    frameworkMetadata: { kind: "fastapi", appImport: "main:app" },
    score: 80,
    evidence: ["main.py"]
  };
}

function viteService(): DetectedService {
  return {
    id: "frontend",
    rootPath: "/workspace/frontend",
    frameworkId: "vite",
    score: 90,
    evidence: ["vite.config.ts"]
  };
}

function expressService(): DetectedService {
  return {
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
  };
}

function descriptor(state: ManagedProcessDescriptor["state"]): ManagedProcessDescriptor {
  return { kind: "backend", state, expectedPort: 8000 };
}

void test("Django backend renders 'Backend · Django'", () => {
  const html = serverStatCard("Backend", "server-process", true, descriptor("running"), "toggle", "127.0.0.1", [], [], frameworkDisplayLabel(djangoService()));
  assert.match(html, /Backend · Django/);
});

void test("FastAPI backend renders 'Backend · FastAPI'", () => {
  const html = serverStatCard("Backend", "server-process", true, descriptor("running"), "toggle", "127.0.0.1", [], [], frameworkDisplayLabel(fastApiService()));
  assert.match(html, /Backend · FastAPI/);
});

void test("Vite frontend renders 'Frontend · Vite'", () => {
  const html = serverStatCard("Frontend", "browser", true, descriptor("running"), "toggle", undefined, [], [], frameworkDisplayLabel(viteService()));
  assert.match(html, /Frontend · Vite/);
});

void test("framework label stays visible while the service is Stopped", () => {
  const html = serverStatCard("Backend", "server-process", true, descriptor("stopped"), "toggle", "127.0.0.1", [], [], frameworkDisplayLabel(djangoService()));
  assert.match(html, /Backend · Django/);
  assert.match(html, /Stopped/);
});

void test("no framework label falls back to the plain 'Backend' title (e.g. no service detected)", () => {
  const html = serverStatCard("Backend", "server-process", false, descriptor("stopped"), "toggle", "127.0.0.1", [], [], frameworkDisplayLabel(undefined));
  assert.match(html, /Backend/);
  assert.doesNotMatch(html, /·/);
});

void test("Django backend's extra actions include Open Admin", () => {
  const actions = backendExtraActions(djangoService());
  assert.ok(actions.some((action) => action.commandId === COMMAND_OPEN_ADMIN));
});

void test("FastAPI backend's extra actions do not include Open Admin", () => {
  const actions = backendExtraActions(fastApiService());
  assert.ok(!actions.some((action) => action.commandId === COMMAND_OPEN_ADMIN));
});

void test("Django + Vite: both stat cards carry their own framework label independently", () => {
  const backendHtml = serverStatCard("Backend", "server-process", true, descriptor("running"), "toggle", "127.0.0.1", [], [], frameworkDisplayLabel(djangoService()));
  const frontendHtml = serverStatCard("Frontend", "browser", true, descriptor("running"), "toggle", undefined, [], [], frameworkDisplayLabel(viteService()));
  assert.match(backendHtml, /Backend · Django/);
  assert.match(frontendHtml, /Frontend · Vite/);
});

void test("FastAPI + Vite: both stat cards carry their own framework label independently", () => {
  const backendHtml = serverStatCard("Backend", "server-process", true, descriptor("running"), "toggle", "127.0.0.1", [], [], frameworkDisplayLabel(fastApiService()));
  const frontendHtml = serverStatCard("Frontend", "browser", true, descriptor("running"), "toggle", undefined, [], [], frameworkDisplayLabel(viteService()));
  assert.match(backendHtml, /Backend · FastAPI/);
  assert.match(frontendHtml, /Frontend · Vite/);
});

// --- EXPRESS-1C ---

void test("Express backend renders 'Backend · Express' while running", () => {
  const html = serverStatCard("Backend", "server-process", true, descriptor("running"), "toggle", "127.0.0.1", [], [], frameworkDisplayLabel(expressService()));
  assert.match(html, /Backend · Express/);
});

void test("Express backend renders 'Backend · Express' while stopped - framework identity comes from detection state, not process state", () => {
  const html = serverStatCard("Backend", "server-process", true, descriptor("stopped"), "toggle", "127.0.0.1", [], [], frameworkDisplayLabel(expressService()));
  assert.match(html, /Backend · Express/);
  assert.match(html, /Stopped/);
});

void test("Express backend's extra actions do not include Open Admin", () => {
  const actions = backendExtraActions(expressService());
  assert.ok(!actions.some((action) => action.commandId === COMMAND_OPEN_ADMIN));
});

void test("Express + Vite: both stat cards carry their own framework label independently", () => {
  const backendHtml = serverStatCard("Backend", "server-process", true, descriptor("running"), "toggle", "127.0.0.1", [], [], frameworkDisplayLabel(expressService()));
  const frontendHtml = serverStatCard("Frontend", "browser", true, descriptor("running"), "toggle", undefined, [], [], frameworkDisplayLabel(viteService()));
  assert.match(backendHtml, /Backend · Express/);
  assert.match(frontendHtml, /Frontend · Vite/);
});
