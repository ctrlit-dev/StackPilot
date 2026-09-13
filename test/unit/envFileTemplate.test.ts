import assert from "node:assert/strict";
import test from "node:test";

import { findEnvExampleContent } from "../../src/project/envFileTemplate";
import { InMemoryFileSystemProbe } from "./fakes/inMemoryFileSystem";

void test("returns undefined when no example file exists", async () => {
  const fs = new InMemoryFileSystemProbe().addDirectory("/workspace/backend");
  const content = await findEnvExampleContent(fs, "/workspace/backend");
  assert.equal(content, undefined);
});

void test("reads .env.example when present", async () => {
  const fs = new InMemoryFileSystemProbe().addFile("/workspace/backend/.env.example", "DEBUG=1\n");
  const content = await findEnvExampleContent(fs, "/workspace/backend");
  assert.equal(content, "DEBUG=1\n");
});

void test("falls back to .env.sample when .env.example is absent", async () => {
  const fs = new InMemoryFileSystemProbe().addFile("/workspace/backend/.env.sample", "DEBUG=1\n");
  const content = await findEnvExampleContent(fs, "/workspace/backend");
  assert.equal(content, "DEBUG=1\n");
});

void test("falls back to .env.template when neither .env.example nor .env.sample exist", async () => {
  const fs = new InMemoryFileSystemProbe().addFile("/workspace/backend/.env.template", "DEBUG=1\n");
  const content = await findEnvExampleContent(fs, "/workspace/backend");
  assert.equal(content, "DEBUG=1\n");
});

void test("prefers .env.example over .env.sample when both exist", async () => {
  const fs = new InMemoryFileSystemProbe()
    .addFile("/workspace/backend/.env.example", "FROM_EXAMPLE=1\n")
    .addFile("/workspace/backend/.env.sample", "FROM_SAMPLE=1\n");
  const content = await findEnvExampleContent(fs, "/workspace/backend");
  assert.equal(content, "FROM_EXAMPLE=1\n");
});
