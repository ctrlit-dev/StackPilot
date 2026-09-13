import assert from "node:assert/strict";
import test from "node:test";

import type { ManagedProcessDescriptor } from "../../src/execution/processManager";
import { planOpenApplication, planServiceUrl } from "../../src/commands/openApplicationPlan";

function descriptor(kind: "backend" | "frontend", overrides: Partial<ManagedProcessDescriptor> = {}): ManagedProcessDescriptor {
  return { kind, state: "stopped", ...overrides };
}

void test("planServiceUrl returns undefined when the service is not running", () => {
  assert.equal(planServiceUrl("backend", descriptor("backend"), undefined, "127.0.0.1"), undefined);
});

void test("planServiceUrl builds the backend URL from its configured host and actual bound port", () => {
  const url = planServiceUrl("backend", descriptor("backend", { state: "running", expectedPort: 8001 }), undefined, "127.0.0.1");
  assert.equal(url, "http://127.0.0.1:8001/");
});

void test("planServiceUrl prefers the frontend's actual detected URL over its configured port", () => {
  const url = planServiceUrl("frontend", descriptor("frontend", { state: "running", expectedPort: 5173 }), "http://localhost:5174/", "127.0.0.1");
  assert.equal(url, "http://localhost:5174/");
});

void test("reports nothing-running when neither process is running", () => {
  const plan = planOpenApplication(descriptor("backend"), descriptor("frontend"), undefined, "127.0.0.1");
  assert.deepEqual(plan, { kind: "nothing-running" });
});

void test("prefers the frontend's actual detected URL over its configured port guess", () => {
  const plan = planOpenApplication(
    descriptor("backend"),
    descriptor("frontend", { state: "running", expectedPort: 5173 }),
    "http://localhost:5174/",
    "127.0.0.1"
  );
  assert.deepEqual(plan, { kind: "open", url: "http://localhost:5174/" });
});

void test("falls back to the frontend's configured port when no actual URL was detected yet", () => {
  const plan = planOpenApplication(descriptor("backend"), descriptor("frontend", { state: "running", expectedPort: 5173 }), undefined, "127.0.0.1");
  assert.deepEqual(plan, { kind: "open", url: "http://127.0.0.1:5173/" });
});

void test("falls back to the backend when the frontend is not running", () => {
  const plan = planOpenApplication(
    descriptor("backend", { state: "running", expectedPort: 8000 }),
    descriptor("frontend"),
    undefined,
    "127.0.0.1"
  );
  assert.deepEqual(plan, { kind: "open", url: "http://127.0.0.1:8000/" });
});

void test("prefers a running frontend over a running backend", () => {
  const plan = planOpenApplication(
    descriptor("backend", { state: "running", expectedPort: 8000 }),
    descriptor("frontend", { state: "running", expectedPort: 5173 }),
    "http://localhost:5173/",
    "127.0.0.1"
  );
  assert.deepEqual(plan, { kind: "open", url: "http://localhost:5173/" });
});

void test("uses the configured backend host, not a hardcoded 127.0.0.1", () => {
  const plan = planOpenApplication(descriptor("backend", { state: "running", expectedPort: 8000 }), descriptor("frontend"), undefined, "0.0.0.0");
  assert.deepEqual(plan, { kind: "open", url: "http://0.0.0.0:8000/" });
});
