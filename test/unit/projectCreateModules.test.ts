import assert from "node:assert/strict";
import test from "node:test";

import { PROJECT_CREATE_MODULES } from "../../src/project/create/projectCreateModules";

void test("PROJECT_CREATE_MODULES is a non-empty, deterministically-ordered array", () => {
  assert.ok(PROJECT_CREATE_MODULES.length > 0);
  assert.deepEqual(PROJECT_CREATE_MODULES.map((module) => module.id), Array.from(PROJECT_CREATE_MODULES, (module) => module.id));
});

void test("PROJECT_CREATE_MODULES contains no duplicate ids", () => {
  const ids = PROJECT_CREATE_MODULES.map((module) => module.id);
  assert.equal(new Set(ids).size, ids.length);
});

void test("every registered module has a non-empty id, label, and description, and a callable prepare()", () => {
  for (const module of PROJECT_CREATE_MODULES) {
    assert.ok(module.id.length > 0);
    assert.ok(module.label.length > 0);
    assert.ok(module.description.length > 0);
    assert.equal(typeof module.prepare, "function");
  }
});

void test("registers Django", () => {
  assert.ok(PROJECT_CREATE_MODULES.some((module) => module.id === "django"));
});

void test("registers FastAPI", () => {
  assert.ok(PROJECT_CREATE_MODULES.some((module) => module.id === "fastapi"));
});

void test("registers React + Vite", () => {
  assert.ok(PROJECT_CREATE_MODULES.some((module) => module.id === "vite-react"));
});

void test("registers Express", () => {
  assert.ok(PROJECT_CREATE_MODULES.some((module) => module.id === "express"));
});

void test("registers Next.js", () => {
  assert.ok(PROJECT_CREATE_MODULES.some((module) => module.id === "nextjs"));
});

void test("registers exactly Django, FastAPI, React + Vite, Express, and Next.js - no more, no fewer", () => {
  assert.deepEqual(
    PROJECT_CREATE_MODULES.map((module) => module.id),
    ["django", "fastapi", "vite-react", "express", "nextjs"]
  );
});

void test("React + Vite's label/description never claim it is a backend", () => {
  const module = PROJECT_CREATE_MODULES.find((candidate) => candidate.id === "vite-react");
  assert.ok(module !== undefined);
  assert.equal(/backend/i.test(module.label), false);
  assert.equal(/backend framework/i.test(module.description), false);
});
