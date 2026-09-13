import assert from "node:assert/strict";
import test from "node:test";

import type { DetectedProject, DetectedService } from "../../../../src/detection/detectedProject";
import { COMMAND_MIGRATE } from "../../../../src/constants";
import { createDjangoMigrationsCheck, type MigrationStatusReader } from "../../../../src/diagnostics/checks/djangoMigrationsCheck";
import type { MigrationStatus } from "../../../../src/execution/migrationStatusController";
import { InMemoryFileSystemProbe } from "../../fakes/inMemoryFileSystem";

function fakeReader(status: MigrationStatus): MigrationStatusReader {
  return {
    getStatus: () => status,
    onDidChangeStatus: () => ({ dispose: () => {} })
  };
}

function djangoService(): DetectedService {
  return {
    id: "backend",
    rootPath: "/workspace/backend",
    frameworkId: "django",
    runtime: {
      kind: "python",
      detection: { selected: { executablePath: "/workspace/backend/.venv/bin/python", source: "venv", validation: "exists" }, candidates: [], diagnostics: [] }
    },
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
    runtime: {
      kind: "python",
      detection: { selected: { executablePath: "/workspace/.venv/bin/python", source: "venv", validation: "exists" }, candidates: [], diagnostics: [] }
    },
    frameworkMetadata: { kind: "fastapi", appImport: "main:app" },
    score: 80,
    evidence: ["main.py"]
  };
}

function project(services: readonly DetectedService[]): DetectedProject {
  return { workspaceRootPath: "/workspace", services, pythonRuntime: { selected: undefined, candidates: [], diagnostics: [] }, diagnostics: [] };
}

const fileSystem = new InMemoryFileSystemProbe();

void test("Django + pending -> django.migrations.pending, referencing the real Migrate command", async () => {
  const check = createDjangoMigrationsCheck(fakeReader("pending"));
  const results = await check.run({ detectedProject: project([djangoService()]), fileSystem });

  assert.equal(results.length, 1);
  assert.equal(results[0].code, "django.migrations.pending");
  assert.equal(results[0].severity, "warning");
  assert.equal(results[0].serviceId, "backend");
  assert.deepEqual(results[0].action, { label: "Migrate", commandId: COMMAND_MIGRATE });
});

void test("Django + up-to-date -> no result", async () => {
  const check = createDjangoMigrationsCheck(fakeReader("up-to-date"));
  const results = await check.run({ detectedProject: project([djangoService()]), fileSystem });
  assert.deepEqual(results, []);
});

for (const status of ["checking", "unknown", "unavailable"] as const) {
  void test(`Django + ${status} -> no result`, async () => {
    const check = createDjangoMigrationsCheck(fakeReader(status));
    const results = await check.run({ detectedProject: project([djangoService()]), fileSystem });
    assert.deepEqual(results, []);
  });
}

void test("framework isolation: a FastAPI project never emits django.migrations.pending, even when the reader reports pending", async () => {
  const check = createDjangoMigrationsCheck(fakeReader("pending"));
  const results = await check.run({ detectedProject: project([fastApiService()]), fileSystem });
  assert.deepEqual(results, []);
});

void test("no backend detected at all -> no result, even when the reader reports pending", async () => {
  const check = createDjangoMigrationsCheck(fakeReader("pending"));
  const results = await check.run({ detectedProject: project([]), fileSystem });
  assert.deepEqual(results, []);
});
