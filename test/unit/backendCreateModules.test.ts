import assert from "node:assert/strict";
import test from "node:test";

import { BACKEND_CREATE_MODULES } from "../../src/project/create/backendCreateModules";

void test("BACKEND_CREATE_MODULES is a non-empty, deterministically-ordered array", () => {
  assert.ok(BACKEND_CREATE_MODULES.length > 0);
  assert.deepEqual(BACKEND_CREATE_MODULES.map((module) => module.id), Array.from(BACKEND_CREATE_MODULES, (module) => module.id));
});

void test("BACKEND_CREATE_MODULES contains no duplicate ids", () => {
  const ids = BACKEND_CREATE_MODULES.map((module) => module.id);
  assert.equal(new Set(ids).size, ids.length);
});

void test("every registered module has a non-empty id, label, and description, and a callable prepare()", () => {
  for (const module of BACKEND_CREATE_MODULES) {
    assert.ok(module.id.length > 0);
    assert.ok(module.label.length > 0);
    assert.ok(module.description.length > 0);
    assert.equal(typeof module.prepare, "function");
  }
});

void test("registers Django", () => {
  assert.ok(BACKEND_CREATE_MODULES.some((module) => module.id === "django"));
});
