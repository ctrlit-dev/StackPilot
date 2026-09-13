import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import { checkDestination, cleanupCreatedPaths } from "../../src/project/projectCollision";
import { InMemoryProjectFileWriter } from "./fakes/inMemoryProjectFileWriter";

const projectRoot = path.resolve("pc-test-fixtures", "collision", "kunden-portal");

void test("accepts a destination that does not exist yet", async () => {
  const writer = new InMemoryProjectFileWriter();
  const result = await checkDestination(writer, projectRoot);
  assert.deepEqual(result, { ok: true });
});

void test("accepts a destination that exists but is empty", async () => {
  const writer = new InMemoryProjectFileWriter().preExistingDirectory(projectRoot);
  const result = await checkDestination(writer, projectRoot);
  assert.deepEqual(result, { ok: true });
});

void test("rejects a destination that already contains files", async () => {
  const writer = new InMemoryProjectFileWriter().preExistingFile(path.join(projectRoot, "existing.txt"));
  const result = await checkDestination(writer, projectRoot);
  assert.equal(result.ok, false);
});

void test("cleanupCreatedPaths removes exactly the given paths and nothing else", async () => {
  const writer = new InMemoryProjectFileWriter()
    .preExistingFile(path.join(projectRoot, "README.md"))
    .preExistingDirectory(path.join(projectRoot, "backend"));
  // A sibling the wizard did NOT create, standing in for a pre-existing file that must survive cleanup.
  writer.preExistingFile(path.resolve("pc-test-fixtures", "collision", "unrelated.txt"));

  await cleanupCreatedPaths(writer, [projectRoot]);

  assert.deepEqual(writer.removedPaths, [path.resolve(projectRoot)]);
  assert.equal(await writer.pathExists(path.resolve("pc-test-fixtures", "collision", "unrelated.txt")), true);
  assert.equal(await writer.pathExists(path.join(projectRoot, "README.md")), false);
});
