import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import { nextFrontendDetection } from "../../src/adapters/nextFrontendDetection";
import { InMemoryFileSystemProbe } from "./fakes/inMemoryFileSystem";

const rootPath = path.resolve("pc-test-fixtures", "next-frontend-detection", "frontend");

function packageJson(dependencies: Record<string, string> = {}, devDependencies: Record<string, string> = {}): string {
  return JSON.stringify({ name: "app", dependencies, devDependencies });
}

void test("nextFrontendDetection identifies itself as the 'next' framework, distinct from any ServiceId", () => {
  assert.equal(nextFrontendDetection.frameworkId, "next");
});

// ---- TRUE: dependencies.next is the one required fact -----------------

void test("matches when dependencies.next is present, with no config file at all", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(rootPath, "package.json"), packageJson({ next: "16.3.5" }));

  const configPath = await nextFrontendDetection.findFrameworkConfigPath(fs, rootPath);

  assert.equal(configPath, path.join(rootPath, "package.json"));
});

void test("matches and prefers next.config.ts as the evidence path when both it and dependencies.next are present", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(rootPath, "package.json"), packageJson({ next: "16.3.5" }))
    .addFile(path.join(rootPath, "next.config.ts"));

  const configPath = await nextFrontendDetection.findFrameworkConfigPath(fs, rootPath);

  assert.equal(configPath, path.join(rootPath, "next.config.ts"));
});

void test("matches with next.config.js alongside dependencies.next", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(rootPath, "package.json"), packageJson({ next: "16.3.5" }))
    .addFile(path.join(rootPath, "next.config.js"));

  const configPath = await nextFrontendDetection.findFrameworkConfigPath(fs, rootPath);

  assert.equal(configPath, path.join(rootPath, "next.config.js"));
});

void test("matches with next.config.mjs alongside dependencies.next", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(rootPath, "package.json"), packageJson({ next: "16.3.5" }))
    .addFile(path.join(rootPath, "next.config.mjs"));

  const configPath = await nextFrontendDetection.findFrameworkConfigPath(fs, rootPath);

  assert.equal(configPath, path.join(rootPath, "next.config.mjs"));
});

void test("matches an ordinary App Router project shape (dependencies.next only) with no router-aware logic", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(rootPath, "package.json"), packageJson({ next: "16.3.5", react: "19.2.8", "react-dom": "19.2.8" }))
    .addFile(path.join(rootPath, "next.config.ts"))
    .addDirectory(path.join(rootPath, "src", "app"));

  const configPath = await nextFrontendDetection.findFrameworkConfigPath(fs, rootPath);

  assert.notEqual(configPath, undefined);
});

void test("matches an ordinary Pages Router project shape (dependencies.next only) with no router-aware logic", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(rootPath, "package.json"), packageJson({ next: "14.0.0", react: "18.0.0", "react-dom": "18.0.0" }))
    .addDirectory(path.join(rootPath, "pages"));

  const configPath = await nextFrontendDetection.findFrameworkConfigPath(fs, rootPath);

  assert.notEqual(configPath, undefined);
});

// ---- FALSE: the required negative matrix -------------------------------

void test("rejects next.config.ts with no dependencies.next", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(rootPath, "package.json"), packageJson())
    .addFile(path.join(rootPath, "next.config.ts"));

  const configPath = await nextFrontendDetection.findFrameworkConfigPath(fs, rootPath);

  assert.equal(configPath, undefined);
});

void test("rejects next.config.js with no dependencies.next", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(rootPath, "package.json"), packageJson())
    .addFile(path.join(rootPath, "next.config.js"));

  const configPath = await nextFrontendDetection.findFrameworkConfigPath(fs, rootPath);

  assert.equal(configPath, undefined);
});

void test("rejects next declared only in devDependencies", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(rootPath, "package.json"), packageJson({}, { next: "16.3.5" }));

  const configPath = await nextFrontendDetection.findFrameworkConfigPath(fs, rootPath);

  assert.equal(configPath, undefined);
});

void test("rejects a package.json script merely mentioning 'next dev' without the dependency", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(
    path.join(rootPath, "package.json"),
    JSON.stringify({ name: "app", scripts: { dev: "next dev" }, dependencies: {} })
  );

  const configPath = await nextFrontendDetection.findFrameworkConfigPath(fs, rootPath);

  assert.equal(configPath, undefined);
});

void test("rejects a Vite project (no dependencies.next)", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(rootPath, "package.json"), packageJson({ vite: "^5.0.0", react: "^18.0.0" }));

  const configPath = await nextFrontendDetection.findFrameworkConfigPath(fs, rootPath);

  assert.equal(configPath, undefined);
});

void test("rejects an Express project (no dependencies.next)", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(rootPath, "package.json"), packageJson({ express: "^4.19.2" }));

  const configPath = await nextFrontendDetection.findFrameworkConfigPath(fs, rootPath);

  assert.equal(configPath, undefined);
});

void test("rejects malformed package.json safely", async () => {
  const fs = new InMemoryFileSystemProbe().addFile(path.join(rootPath, "package.json"), "{ not valid json");

  const configPath = await nextFrontendDetection.findFrameworkConfigPath(fs, rootPath);

  assert.equal(configPath, undefined);
});

void test("rejects a missing package.json safely", async () => {
  const fs = new InMemoryFileSystemProbe();

  const configPath = await nextFrontendDetection.findFrameworkConfigPath(fs, rootPath);

  assert.equal(configPath, undefined);
});
