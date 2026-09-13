import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CONFIGURATION,
  isPackageManagerPreference,
  validateConfiguration,
  type StackPilotConfiguration
} from "../../src/config/configurationModel";

void test("default configuration is valid", () => {
  assert.deepEqual(validateConfiguration(DEFAULT_CONFIGURATION), []);
});

void test("package manager preference accepts only supported values", () => {
  assert.equal(isPackageManagerPreference("auto"), true);
  assert.equal(isPackageManagerPreference("pnpm"), true);
  assert.equal(isPackageManagerPreference("pip"), false);
});

void test("configuration validation rejects empty scripts, invalid ports, empty host, and null bytes", () => {
  const invalidConfiguration: StackPilotConfiguration = {
    ...DEFAULT_CONFIGURATION,
    backendDirectory: "backend\0",
    frontendDevScript: " ",
    backendHost: "",
    backendPort: 0,
    frontendPort: 70000
  };

  const diagnostics = validateConfiguration(invalidConfiguration);
  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.setting),
    ["backendDirectory", "frontendDevScript", "backendPort", "frontendPort", "backendHost"]
  );
});
