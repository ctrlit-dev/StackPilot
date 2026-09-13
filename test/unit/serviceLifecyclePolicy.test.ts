import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_CONFIGURATION } from "../../src/config/configurationModel";
import { COMMAND_START_BACKEND, COMMAND_START_FRONTEND } from "../../src/constants";
import { createDefaultServiceLifecyclePolicyProvider, fallbackServiceLifecyclePolicy } from "../../src/execution/serviceLifecyclePolicy";
import { BACKEND_SERVICE_ID, FRONTEND_SERVICE_ID } from "../../src/execution/serviceRegistry";
import { ProjectStateStore } from "../../src/state/projectState";

function stateStoreWithConfiguration(overrides: Partial<typeof DEFAULT_CONFIGURATION> = {}): ProjectStateStore {
  const store = new ProjectStateStore();
  store.setState({
    selection: { kind: "none" },
    trusted: true,
    configuration: { ...DEFAULT_CONFIGURATION, ...overrides }
  });
  return store;
}

void test("fallbackServiceLifecyclePolicy disables auto-restart and uses the raw service id as the display name", () => {
  assert.deepEqual(fallbackServiceLifecyclePolicy("worker"), { autoRestartEnabled: false, displayName: "worker" });
});

void test("backend policy reflects the existing backendAutoRestart setting and known command/label", () => {
  const provider = createDefaultServiceLifecyclePolicyProvider(stateStoreWithConfiguration({ backendAutoRestart: true }));

  const policy = provider.getPolicy(BACKEND_SERVICE_ID);

  assert.equal(policy.autoRestartEnabled, true);
  assert.equal(policy.displayName, "Backend");
  assert.equal(policy.restartCommandId, COMMAND_START_BACKEND);
});

void test("backend policy is disabled when backendAutoRestart is false", () => {
  const provider = createDefaultServiceLifecyclePolicyProvider(stateStoreWithConfiguration({ backendAutoRestart: false }));

  assert.equal(provider.getPolicy(BACKEND_SERVICE_ID).autoRestartEnabled, false);
});

void test("frontend policy reflects the existing frontendAutoRestart setting and known command/label", () => {
  const provider = createDefaultServiceLifecyclePolicyProvider(stateStoreWithConfiguration({ frontendAutoRestart: true }));

  const policy = provider.getPolicy(FRONTEND_SERVICE_ID);

  assert.equal(policy.autoRestartEnabled, true);
  assert.equal(policy.displayName, "Frontend");
  assert.equal(policy.restartCommandId, COMMAND_START_FRONTEND);
});

void test("frontend policy is disabled when frontendAutoRestart is false", () => {
  const provider = createDefaultServiceLifecyclePolicyProvider(stateStoreWithConfiguration({ frontendAutoRestart: false }));

  assert.equal(provider.getPolicy(FRONTEND_SERVICE_ID).autoRestartEnabled, false);
});

void test("both auto-restart flags are false before any workspace/configuration is selected", () => {
  // Matches the pre-existing isAutoRestartEnabled() behavior: no configuration yet means no auto-restart, never a crash.
  const provider = createDefaultServiceLifecyclePolicyProvider(new ProjectStateStore());

  assert.equal(provider.getPolicy(BACKEND_SERVICE_ID).autoRestartEnabled, false);
  assert.equal(provider.getPolicy(FRONTEND_SERVICE_ID).autoRestartEnabled, false);
});

void test("a third service (worker) not known to the provider gets the safe fallback policy, never backend's or frontend's", () => {
  const provider = createDefaultServiceLifecyclePolicyProvider(
    stateStoreWithConfiguration({ backendAutoRestart: true, frontendAutoRestart: true })
  );

  const policy = provider.getPolicy("worker");

  assert.equal(policy.autoRestartEnabled, false);
  assert.equal(policy.displayName, "worker");
  assert.equal(policy.restartCommandId, undefined);
});

void test("an entirely unknown service id also gets the safe fallback policy, not frontend's", () => {
  const provider = createDefaultServiceLifecyclePolicyProvider(
    stateStoreWithConfiguration({ frontendAutoRestart: true })
  );

  const policy = provider.getPolicy("some-unregistered-service");

  assert.equal(policy.autoRestartEnabled, false, "must not silently inherit frontend's enabled auto-restart");
  assert.equal(policy.displayName, "some-unregistered-service");
});

void test("backend and frontend policies are resolved independently in the same provider call sequence", () => {
  const provider = createDefaultServiceLifecyclePolicyProvider(
    stateStoreWithConfiguration({ backendAutoRestart: true, frontendAutoRestart: false })
  );

  assert.equal(provider.getPolicy(BACKEND_SERVICE_ID).autoRestartEnabled, true);
  assert.equal(provider.getPolicy(FRONTEND_SERVICE_ID).autoRestartEnabled, false);
});

void test("the provider reads the CURRENT configuration on every call, not a snapshot captured at construction", () => {
  // Preserves the pre-existing dynamic-config behavior: both controllers previously
  // read projectState.getState() fresh on every crash, not a value cached once.
  const store = stateStoreWithConfiguration({ backendAutoRestart: false });
  const provider = createDefaultServiceLifecyclePolicyProvider(store);

  assert.equal(provider.getPolicy(BACKEND_SERVICE_ID).autoRestartEnabled, false);

  store.setState({ ...store.getState(), configuration: { ...DEFAULT_CONFIGURATION, backendAutoRestart: true } });

  assert.equal(provider.getPolicy(BACKEND_SERVICE_ID).autoRestartEnabled, true);
});
