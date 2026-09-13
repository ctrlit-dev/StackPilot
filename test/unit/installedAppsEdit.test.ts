import assert from "node:assert/strict";
import test from "node:test";

import { planInstalledAppsInsertion } from "../../src/project/installedAppsEdit";

const SETTINGS_WITH_APPS = [
  "INSTALLED_APPS = [",
  '    "django.contrib.admin",',
  '    "django.contrib.auth",',
  "]",
  ""
].join("\n");

void test("inserts a new line before the closing bracket, matching existing indentation", () => {
  const plan = planInstalledAppsInsertion(SETTINGS_WITH_APPS, "billing");
  assert.equal(plan.kind, "insert");
  if (plan.kind === "insert") {
    assert.equal(plan.lineText, '    "billing",');
    assert.equal(plan.lineIndex, 3);
  }
});

void test("reports already-present when the app is already listed (single or double quotes)", () => {
  const withDouble = planInstalledAppsInsertion(SETTINGS_WITH_APPS.replace('"django.contrib.auth",', '"django.contrib.auth",\n    "billing",'), "billing");
  assert.equal(withDouble.kind, "already-present");

  const withSingle = planInstalledAppsInsertion(SETTINGS_WITH_APPS.replace('"django.contrib.auth",', "'django.contrib.auth',\n    'billing',"), "billing");
  assert.equal(withSingle.kind, "already-present");
});

void test("reports not-found when there is no INSTALLED_APPS declaration at all", () => {
  const plan = planInstalledAppsInsertion('DEBUG = True\nSECRET_KEY = "x"\n', "billing");
  assert.equal(plan.kind, "not-found");
});

void test("reports not-found for a single-line list rather than risk rewriting it", () => {
  const plan = planInstalledAppsInsertion('INSTALLED_APPS = ["django.contrib.admin"]\n', "billing");
  assert.equal(plan.kind, "not-found");
});

void test("falls back to 4-space indent for an empty list", () => {
  const plan = planInstalledAppsInsertion("INSTALLED_APPS = [\n]\n", "billing");
  assert.equal(plan.kind, "insert");
  if (plan.kind === "insert") {
    assert.equal(plan.lineText, '    "billing",');
  }
});

void test("matches a type-annotated declaration", () => {
  const content = 'INSTALLED_APPS: list[str] = [\n    "django.contrib.admin",\n]\n';
  const plan = planInstalledAppsInsertion(content, "billing");
  assert.equal(plan.kind, "insert");
});
