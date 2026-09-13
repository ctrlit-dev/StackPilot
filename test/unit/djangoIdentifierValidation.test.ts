import assert from "node:assert/strict";
import test from "node:test";

import { validateDjangoAppName } from "../../src/adapters/djangoIdentifierValidation";

void test("accepts a normal app name", () => {
  assert.deepEqual(validateDjangoAppName("billing"), { valid: true });
});

void test("accepts underscores and digits after the first character", () => {
  assert.deepEqual(validateDjangoAppName("_billing_v2"), { valid: true });
});

void test("rejects an empty name", () => {
  const result = validateDjangoAppName("");
  assert.equal(result.valid, false);
});

void test("rejects a name starting with a digit", () => {
  const result = validateDjangoAppName("2fast");
  assert.equal(result.valid, false);
});

void test("rejects whitespace", () => {
  const result = validateDjangoAppName("billing app");
  assert.equal(result.valid, false);
});

void test("rejects Unicode characters", () => {
  const result = validateDjangoAppName("bëlastung");
  assert.equal(result.valid, false);
});

void test("rejects shell metacharacters", () => {
  for (const candidate of ["billing;rm", "billing|ls", "billing&&ls", "billing$(whoami)", "billing`whoami`", "billing>out"]) {
    const result = validateDjangoAppName(candidate);
    assert.equal(result.valid, false, `expected "${candidate}" to be rejected`);
  }
});

void test("rejects a path-traversal-style command-injection attempt", () => {
  const result = validateDjangoAppName("../../etc/passwd");
  assert.equal(result.valid, false);
});

void test("rejects the exact malicious input from spec §88 scenario H", () => {
  const result = validateDjangoAppName("inventory && del C:\\*");
  assert.equal(result.valid, false);
});

void test("rejects reserved Python keywords", () => {
  for (const keyword of ["class", "import", "for", "None", "async"]) {
    const result = validateDjangoAppName(keyword);
    assert.equal(result.valid, false, `expected "${keyword}" to be rejected`);
  }
});
