import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import { detectPackageManager } from "../../src/detection/packageManagerDetector";
import { InMemoryFileSystemProbe } from "./fakes/inMemoryFileSystem";

const frontendRoot = path.resolve("pc-test-fixtures", "package-manager-detector");

void test("detects npm from package-lock.json", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(frontendRoot, "package-lock.json"));

  const result = await detectPackageManager(fs, frontendRoot, "auto");

  assert.deepEqual(result, { kind: "detected", manager: "npm", source: "lockfile", evidence: "package-lock.json" });
});

void test("detects pnpm from pnpm-lock.yaml", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(frontendRoot, "pnpm-lock.yaml"));

  const result = await detectPackageManager(fs, frontendRoot, "auto");

  assert.deepEqual(result, { kind: "detected", manager: "pnpm", source: "lockfile", evidence: "pnpm-lock.yaml" });
});

void test("detects yarn from yarn.lock", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(frontendRoot, "yarn.lock"));

  const result = await detectPackageManager(fs, frontendRoot, "auto");

  assert.deepEqual(result, { kind: "detected", manager: "yarn", source: "lockfile", evidence: "yarn.lock" });
});

void test("detects bun from bun.lock", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(frontendRoot, "bun.lock"));

  const result = await detectPackageManager(fs, frontendRoot, "auto");

  assert.deepEqual(result, { kind: "detected", manager: "bun", source: "lockfile", evidence: "bun.lock" });
});

void test("reports missing when no lockfile is present", async () => {
  const fs = new InMemoryFileSystemProbe();

  const result = await detectPackageManager(fs, frontendRoot, "auto");

  assert.equal(result.kind, "missing");
});

void test("reports ambiguous when multiple lockfiles from different managers are present", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(frontendRoot, "package-lock.json"))
    .addFile(path.join(frontendRoot, "pnpm-lock.yaml"));

  const result = await detectPackageManager(fs, frontendRoot, "auto");

  assert.equal(result.kind, "ambiguous");
  if (result.kind === "ambiguous") {
    assert.deepEqual(
      result.candidates.map((candidate) => candidate.manager).sort(),
      ["npm", "pnpm"]
    );
  }
});

void test("a configured preference overrides lockfile evidence", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(frontendRoot, "package-lock.json"));

  const result = await detectPackageManager(fs, frontendRoot, "pnpm");

  assert.deepEqual(result, { kind: "detected", manager: "pnpm", source: "configured" });
});
