import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import { viteFrontendDetection } from "../../src/adapters/viteFrontendDetection";
import { InMemoryFileSystemProbe } from "./fakes/inMemoryFileSystem";

const rootPath = path.resolve("pc-test-fixtures", "vite-frontend-detection", "frontend");

void test("viteFrontendDetection identifies itself as the 'vite' framework, distinct from any ServiceId", () => {
  assert.equal(viteFrontendDetection.frameworkId, "vite");
});

void test("finds vite.config.ts in the given root", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(rootPath, "vite.config.ts"));

  const configPath = await viteFrontendDetection.findFrameworkConfigPath(fs, rootPath);

  assert.equal(configPath, path.join(rootPath, "vite.config.ts"));
});

void test("finds each of the other supported Vite config extensions", async () => {
  for (const fileName of ["vite.config.js", "vite.config.mts", "vite.config.mjs"]) {
    const fs = new InMemoryFileSystemProbe().addFile(path.join(rootPath, fileName));
    const configPath = await viteFrontendDetection.findFrameworkConfigPath(fs, rootPath);
    assert.equal(configPath, path.join(rootPath, fileName), `expected to find ${fileName}`);
  }
});

void test("returns undefined when no Vite config file exists in the root", async () => {
  const fs = new InMemoryFileSystemProbe();

  const configPath = await viteFrontendDetection.findFrameworkConfigPath(fs, rootPath);

  assert.equal(configPath, undefined);
});
