import assert from "node:assert/strict";
import test from "node:test";

import { validateFolderName } from "../../src/project/projectNameValidation";

void test("accepts a normal ASCII folder name", () => {
  assert.deepEqual(validateFolderName("kunden-portal"), { valid: true });
});

void test("accepts spaces and Unicode (spec's own example path uses both)", () => {
  assert.deepEqual(validateFolderName("Meine Projekte Düfte App"), { valid: true });
});

void test("rejects an empty name", () => {
  assert.equal(validateFolderName("").valid, false);
});

void test('rejects "." and ".."', () => {
  assert.equal(validateFolderName(".").valid, false);
  assert.equal(validateFolderName("..").valid, false);
});

void test("rejects Windows-forbidden path characters", () => {
  for (const candidate of ["a<b", "a>b", "a:b", 'a"b', "a/b", "a\\b", "a|b", "a?b", "a*b"]) {
    assert.equal(validateFolderName(candidate).valid, false, `expected "${candidate}" to be rejected`);
  }
});

void test("rejects a name ending in a space or period", () => {
  assert.equal(validateFolderName("myproject ").valid, false);
  assert.equal(validateFolderName("myproject.").valid, false);
});

void test("rejects Windows reserved device names case-insensitively, with or without an extension", () => {
  for (const candidate of ["CON", "con", "NUL", "COM1", "lpt3", "com9.txt"]) {
    assert.equal(validateFolderName(candidate).valid, false, `expected "${candidate}" to be rejected`);
  }
});

void test("rejects a name longer than 255 characters", () => {
  assert.equal(validateFolderName("a".repeat(256)).valid, false);
});

void test("does not reject a normal name that merely starts with a reserved-name prefix", () => {
  assert.deepEqual(validateFolderName("constants"), { valid: true });
});
