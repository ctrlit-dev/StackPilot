import assert from "node:assert/strict";
import test from "node:test";

import { expressBackendAdapter, pickExpressScript } from "../../src/adapters/expressBackendAdapter";
import type { DetectedService, NodeRuntimeReference } from "../../src/detection/detectedProject";

function nodeRuntime(overrides: Partial<NodeRuntimeReference> = {}): NodeRuntimeReference {
  return {
    kind: "node",
    packageManager: { kind: "detected", manager: "npm", source: "lockfile", evidence: "package-lock.json" },
    packageJsonPath: "/workspace/package.json",
    scripts: { dev: "node index.js", start: "node index.js" },
    ...overrides
  };
}

function backendService(runtime: NodeRuntimeReference): DetectedService {
  return {
    id: "backend",
    rootPath: "/workspace",
    frameworkId: "express",
    runtime,
    score: 80,
    evidence: ["app.js"]
  };
}

void test("expressBackendAdapter identifies itself as the 'express' framework, distinct from any ServiceId", () => {
  assert.equal(expressBackendAdapter.id, "express");
});

void test("pickExpressScript prefers dev over start when both exist", () => {
  assert.equal(pickExpressScript({ dev: "node index.js", start: "node index.js" }), "dev");
});

void test("pickExpressScript falls back to start when dev does not exist", () => {
  assert.equal(pickExpressScript({ start: "node index.js" }), "start");
});

void test("pickExpressScript returns undefined when neither dev nor start exists", () => {
  assert.equal(pickExpressScript({ build: "tsc" }), undefined);
});

void test("builds 'npm run dev' when both dev and start scripts exist (dev preferred)", () => {
  const command = expressBackendAdapter.buildStartCommand(backendService(nodeRuntime()), "127.0.0.1", 3000);

  assert.equal(command.executable, "npm");
  assert.deepEqual(command.args, ["run", "dev"]);
  assert.equal(command.cwd, "/workspace");
  assert.equal(command.expectedPort, 3000);
});

void test("falls back to the start script when only start exists", () => {
  const command = expressBackendAdapter.buildStartCommand(
    backendService(nodeRuntime({ scripts: { start: "node index.js" } })),
    "127.0.0.1",
    3000
  );

  assert.deepEqual(command.args, ["run", "start"]);
});

void test("sets PORT and HOST as a best-effort convention via StartProcessOptions.env", () => {
  const command = expressBackendAdapter.buildStartCommand(backendService(nodeRuntime()), "0.0.0.0", 4000);

  assert.deepEqual(command.env, { PORT: "4000", HOST: "0.0.0.0" });
});

void test("never substitutes a different host than the one configured", () => {
  const command = expressBackendAdapter.buildStartCommand(backendService(nodeRuntime()), "0.0.0.0", 8080);

  assert.equal(command.env?.HOST, "0.0.0.0");
});

void test("uses shell:false, structured argv - never a composed command string", () => {
  const command = expressBackendAdapter.buildStartCommand(backendService(nodeRuntime()), "127.0.0.1", 3000);

  assert.ok(Array.isArray(command.args));
  assert.ok(command.args.every((arg) => typeof arg === "string"));
  assert.equal((command as { shell?: boolean }).shell, undefined);
});

void test("builds 'pnpm dev' for pnpm", () => {
  const command = expressBackendAdapter.buildStartCommand(
    backendService(nodeRuntime({ packageManager: { kind: "detected", manager: "pnpm", source: "lockfile", evidence: "pnpm-lock.yaml" } })),
    "127.0.0.1",
    3000
  );

  assert.equal(command.executable, "pnpm");
  assert.deepEqual(command.args, ["dev"]);
});

void test("builds 'yarn dev' for yarn", () => {
  const command = expressBackendAdapter.buildStartCommand(
    backendService(nodeRuntime({ packageManager: { kind: "detected", manager: "yarn", source: "lockfile", evidence: "yarn.lock" } })),
    "127.0.0.1",
    3000
  );

  assert.equal(command.executable, "yarn");
  assert.deepEqual(command.args, ["dev"]);
});

void test("builds 'bun run dev' for bun", () => {
  const command = expressBackendAdapter.buildStartCommand(
    backendService(nodeRuntime({ packageManager: { kind: "detected", manager: "bun", source: "lockfile", evidence: "bun.lock" } })),
    "127.0.0.1",
    3000
  );

  assert.equal(command.executable, "bun");
  assert.deepEqual(command.args, ["run", "dev"]);
});
