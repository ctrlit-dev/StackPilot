import assert from "node:assert/strict";
import test from "node:test";

import { BACKEND_SERVICE_ID, DEFAULT_SERVICE_REGISTRY, FRONTEND_SERVICE_ID, ServiceRegistry } from "../../src/execution/serviceRegistry";

void test("DEFAULT_SERVICE_REGISTRY contains exactly backend and frontend, in that order", () => {
  assert.deepEqual(DEFAULT_SERVICE_REGISTRY.getServiceIds(), [BACKEND_SERVICE_ID, FRONTEND_SERVICE_ID]);
});

void test("a custom registry can hold an arbitrary set of service ids", () => {
  const registry = new ServiceRegistry(["backend", "frontend", "worker", "redis"]);

  assert.deepEqual(registry.getServiceIds(), ["backend", "frontend", "worker", "redis"]);
});

void test("registry is immutable to later mutation of the array passed to its constructor", () => {
  const ids = ["backend", "frontend"];
  const registry = new ServiceRegistry(ids);

  ids.push("worker");

  assert.deepEqual(registry.getServiceIds(), ["backend", "frontend"]);
});
