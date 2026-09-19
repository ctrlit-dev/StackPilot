import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import { expressBackendDetection } from "../../src/adapters/expressBackendDetection";
import { InMemoryFileSystemProbe } from "./fakes/inMemoryFileSystem";

const workspaceRoot = path.resolve("pc-test-fixtures", "express-backend-detection");

function packageJson(dependencies: Record<string, string> = { express: "^4.19.2" }): string {
  return JSON.stringify({ name: "app", dependencies });
}

void test("expressBackendDetection identifies itself as the 'express' framework, distinct from any ServiceId", () => {
  assert.equal(expressBackendDetection.frameworkId, "express");
});

// ---- TRUE: the one supported Phase-1 shape ----------------------------

void test("finds app.js as a candidate when both dependency evidence and a binding-aware express() call are present", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "app.js"), 'const express = require("express");\nconst app = express();\n')
    .addFile(path.join(workspaceRoot, "package.json"), packageJson());

  const result = await expressBackendDetection.detect(fs, workspaceRoot, "backend/manage.py");

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.rootPath, workspaceRoot);
  assert.equal(result.candidates[0]?.frameworkEntryPath, path.join(workspaceRoot, "app.js"));
  assert.equal(result.candidates[0]?.evidence, "app.js");
});

void test("finds index.js as a candidate", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "index.js"), "const express = require('express');\nconst app = express();\n")
    .addFile(path.join(workspaceRoot, "package.json"), packageJson());

  const result = await expressBackendDetection.detect(fs, workspaceRoot, "backend/manage.py");
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.evidence, "index.js");
});

void test("finds server.js as a candidate", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "server.js"), 'const express = require("express");\napp = express();\n')
    .addFile(path.join(workspaceRoot, "package.json"), packageJson());

  const result = await expressBackendDetection.detect(fs, workspaceRoot, "backend/manage.py");
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.evidence, "server.js");
});

void test("finds src/index.js, src/server.js, src/app.js as candidates, rooted at the workspace root", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "src", "app.js"), 'const express = require("express");\nconst app = express();\n')
    .addFile(path.join(workspaceRoot, "package.json"), packageJson());

  const result = await expressBackendDetection.detect(fs, workspaceRoot, "backend/manage.py");

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.rootPath, workspaceRoot);
  assert.equal(result.candidates[0]?.frameworkEntryPath, path.join(workspaceRoot, "src", "app.js"));
  assert.equal(result.candidates[0]?.evidence, "src/app.js");
});

void test("honors an arbitrary require-binding identifier, not just the literal name 'express'", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "app.js"), 'const createApp = require("express");\nconst app = createApp();\n')
    .addFile(path.join(workspaceRoot, "package.json"), packageJson());

  const result = await expressBackendDetection.detect(fs, workspaceRoot, "backend/manage.py");
  assert.equal(result.candidates.length, 1);
});

void test("matches the inline require(\"express\")() call form with no intermediate binding", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "app.js"), 'const app = require("express")();\n')
    .addFile(path.join(workspaceRoot, "package.json"), packageJson());

  const result = await expressBackendDetection.detect(fs, workspaceRoot, "backend/manage.py");
  assert.equal(result.candidates.length, 1);
});

// ---- FALSE: the required false-positive regression matrix -------------

void test("rejects express declared only in devDependencies (e.g. a Vite project's local API mock server)", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "app.js"), 'const express = require("express");\nconst app = express();\n')
    .addFile(path.join(workspaceRoot, "package.json"), JSON.stringify({ dependencies: {}, devDependencies: { express: "^4.19.2" } }));

  const result = await expressBackendDetection.detect(fs, workspaceRoot, "backend/manage.py");
  assert.deepEqual(result.candidates, []);
});

void test("rejects a project with the express dependency but no supported entry file", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "main.js"), 'const express = require("express");\nconst app = express();\n')
    .addFile(path.join(workspaceRoot, "package.json"), packageJson());

  const result = await expressBackendDetection.detect(fs, workspaceRoot, "backend/manage.py");
  assert.deepEqual(result.candidates, []);
});

void test("rejects a supported entry file that never instantiates express, even with the dependency present", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "app.js"), "module.exports = { hello: 'world' };\n")
    .addFile(path.join(workspaceRoot, "package.json"), packageJson());

  const result = await expressBackendDetection.detect(fs, workspaceRoot, "backend/manage.py");
  assert.deepEqual(result.candidates, []);
});

void test("rejects an entry file that requires express but never calls it (import without instantiation)", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "app.js"), 'const express = require("express");\n// app is never created\n')
    .addFile(path.join(workspaceRoot, "package.json"), packageJson());

  const result = await expressBackendDetection.detect(fs, workspaceRoot, "backend/manage.py");
  assert.deepEqual(result.candidates, []);
});

void test("rejects a bare word 'express' co-occurring with a call, when it was never bound from require(\"express\") (binding-aware, not a substring scan)", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "app.js"), "// call expressCheckout()\nfunction expressCheckout() {}\nexpressCheckout();\n")
    .addFile(path.join(workspaceRoot, "package.json"), packageJson());

  const result = await expressBackendDetection.detect(fs, workspaceRoot, "backend/manage.py");
  assert.deepEqual(result.candidates, []);
});

void test("rejects a generic Node project (no express dependency, no express() call)", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "index.js"), "console.log('hello');\n")
    .addFile(path.join(workspaceRoot, "package.json"), JSON.stringify({ dependencies: { chalk: "^5.0.0" } }));

  const result = await expressBackendDetection.detect(fs, workspaceRoot, "backend/manage.py");
  assert.deepEqual(result.candidates, []);
});

void test("rejects a Next.js-shaped package (next dependency, no express)", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "package.json"), JSON.stringify({ dependencies: { next: "^14.0.0", react: "^18.0.0" } }))
    .addDirectory(path.join(workspaceRoot, "pages"));

  const result = await expressBackendDetection.detect(fs, workspaceRoot, "backend/manage.py");
  assert.deepEqual(result.candidates, []);
});

void test("rejects a NestJS-shaped entry file (NestFactory.create) even when express is a declared dependency (transitive via @nestjs/platform-express)", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(
      path.join(workspaceRoot, "app.js"),
      "const { NestFactory } = require('@nestjs/core');\nasync function bootstrap() {\n  const app = await NestFactory.create(AppModule);\n  await app.listen(3000);\n}\nbootstrap();\n"
    )
    .addFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ dependencies: { "@nestjs/core": "^10.0.0", "@nestjs/platform-express": "^10.0.0", express: "^4.19.2" } })
    );

  const result = await expressBackendDetection.detect(fs, workspaceRoot, "backend/manage.py");
  assert.deepEqual(result.candidates, []);
});

void test("rejects a monorepo root with the express dependency but the real backend (and its express() call) nested elsewhere, unrecognized by the bounded candidate list", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(workspaceRoot, "package.json"), packageJson())
    .addFile(
      path.join(workspaceRoot, "services", "api", "app.js"),
      'const express = require("express");\nconst app = express();\n'
    );

  const result = await expressBackendDetection.detect(fs, workspaceRoot, "backend/manage.py");
  assert.deepEqual(result.candidates, []);
});

void test("reports no candidates and no diagnostics when nothing exists", async () => {
  const fs = new InMemoryFileSystemProbe();
  const result = await expressBackendDetection.detect(fs, workspaceRoot, "backend/manage.py");
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.diagnostics, []);
});

void test("rejects an entry point candidate that escapes the workspace through a symlink", async () => {
  const outsideEntry = path.resolve(workspaceRoot, "..", "outside", "app.js");
  const fs = new InMemoryFileSystemProbe()
    .addFile(outsideEntry, 'const express = require("express");\nconst app = express();\n')
    .addSymlink(path.join(workspaceRoot, "app.js"), outsideEntry)
    .addFile(path.join(workspaceRoot, "package.json"), packageJson());

  const result = await expressBackendDetection.detect(fs, workspaceRoot, "backend/manage.py");

  assert.deepEqual(result.candidates, []);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.includes("escapes the workspace through a symlink")));
});
