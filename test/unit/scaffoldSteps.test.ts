import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import {
  commandCaptureStep,
  commandStep,
  createDirectoryStep,
  viteScaffoldStep,
  writeFileStep
} from "../../src/project/scaffoldSteps";
import { FakeProcessSpawner } from "./fakes/fakeProcessSpawner";
import { InMemoryProjectFileWriter } from "./fakes/inMemoryProjectFileWriter";

const root = path.resolve("pc-test-fixtures", "scaffold-steps");

function flushMicrotask(): Promise<void> {
  return Promise.resolve();
}

void test("createDirectoryStep reports the directory as newly created when it did not exist", async () => {
  const writer = new InMemoryProjectFileWriter();
  const step = createDirectoryStep(writer, "backend-dir", "Create backend directory", path.join(root, "backend"));

  const result = await step.execute();

  assert.equal(result.succeeded, true);
  assert.deepEqual(result.createdPaths, [path.join(root, "backend")]);
  assert.equal(await writer.pathExists(path.join(root, "backend")), true);
});

void test("createDirectoryStep does not report an already-existing directory as newly created", async () => {
  const writer = new InMemoryProjectFileWriter().preExistingDirectory(path.join(root, "backend"));
  const step = createDirectoryStep(writer, "backend-dir", "Create backend directory", path.join(root, "backend"));

  const result = await step.execute();

  assert.deepEqual(result.createdPaths, []);
});

void test("writeFileStep reports a newly written file as created", async () => {
  const writer = new InMemoryProjectFileWriter();
  const step = writeFileStep(writer, "gitignore", "Write .gitignore", path.join(root, ".gitignore"), "node_modules/\n");

  const result = await step.execute();

  assert.equal(result.succeeded, true);
  assert.deepEqual(result.createdPaths, [path.join(root, ".gitignore")]);
  assert.equal(writer.files.get(path.resolve(path.join(root, ".gitignore"))), "node_modules/\n");
});

void test("writeFileStep never overwrites an existing file by default and reports nothing created", async () => {
  const target = path.join(root, ".gitignore");
  const writer = new InMemoryProjectFileWriter().preExistingFile(target, "# user's own content\n");
  const step = writeFileStep(writer, "gitignore", "Write .gitignore", target, "node_modules/\n");

  const result = await step.execute();

  assert.equal(result.succeeded, true);
  assert.deepEqual(result.createdPaths, []);
  assert.equal(writer.files.get(path.resolve(target)), "# user's own content\n");
});

void test("commandStep reports success and the owned path when the command exits 0", async () => {
  const spawner = new FakeProcessSpawner();
  const handle = spawner.queueSuccess();
  const stepPromise = commandStep(
    spawner,
    "venv",
    "Create virtual environment",
    { executable: "python", args: ["-m", "venv", ".venv"], cwd: root },
    path.join(root, "backend", ".venv")
  ).execute();
  await flushMicrotask();
  handle.emitExit({ code: 0, signal: null });

  const result = await stepPromise;
  assert.equal(result.succeeded, true);
  assert.deepEqual(result.createdPaths, [path.join(root, "backend", ".venv")]);
});

void test("commandStep reports failure with stderr context on a non-zero exit code", async () => {
  const spawner = new FakeProcessSpawner();
  const handle = spawner.queueSuccess();
  const stepPromise = commandStep(
    spawner,
    "startproject",
    "Create Django project",
    { executable: "python", args: ["-m", "django", "startproject", "config", "backend"], cwd: root },
    undefined
  ).execute();
  await flushMicrotask();
  handle.emitOutput("CommandError: backend/manage.py already exists.\n", "stderr");
  handle.emitExit({ code: 1, signal: null });

  const result = await stepPromise;
  assert.equal(result.succeeded, false);
  assert.ok(result.errorMessage?.includes("already exists"));
});

void test("commandStep reports failure when the spawner itself fails to start", async () => {
  const spawner = new FakeProcessSpawner();
  spawner.queueFailure(new Error("spawn python ENOENT"));
  const result = await commandStep(spawner, "venv", "Create virtual environment", { executable: "python", args: [], cwd: root }, undefined).execute();

  assert.equal(result.succeeded, false);
  assert.ok(result.errorMessage?.includes("ENOENT"));
});

void test("commandCaptureStep passes captured stdout to the callback and creates no paths", async () => {
  const spawner = new FakeProcessSpawner();
  const handle = spawner.queueSuccess();
  let captured = "";
  const stepPromise = commandCaptureStep(
    spawner,
    "pip-show",
    "Read installed Django version",
    { executable: "python", args: ["-m", "pip", "show", "django"], cwd: root },
    (stdout) => {
      captured = stdout;
    }
  ).execute();
  await flushMicrotask();
  handle.emitOutput("Name: Django\nVersion: 6.1.1\n");
  handle.emitExit({ code: 0, signal: null });

  const result = await stepPromise;
  assert.equal(result.succeeded, true);
  assert.deepEqual(result.createdPaths, []);
  assert.equal(captured, "Name: Django\nVersion: 6.1.1\n");
});

void test("viteScaffoldStep succeeds when package.json exists after a zero exit code", async () => {
  const spawner = new FakeProcessSpawner();
  const handle = spawner.queueSuccess();
  const frontendPath = path.join(root, "frontend");
  const writer = new InMemoryProjectFileWriter();

  const stepPromise = viteScaffoldStep(
    spawner,
    writer,
    "vite-scaffold",
    "Scaffold Vite frontend",
    { executable: "npm", args: [], cwd: root },
    frontendPath
  ).execute();
  await flushMicrotask();
  writer.preExistingFile(path.join(frontendPath, "package.json"), "{}");
  handle.emitExit({ code: 0, signal: null });

  const result = await stepPromise;
  assert.equal(result.succeeded, true);
  assert.deepEqual(result.createdPaths, [frontendPath]);
});

void test("viteScaffoldStep fails on the empirically-verified 'exit 0 but nothing created' quirk", async () => {
  const spawner = new FakeProcessSpawner();
  const handle = spawner.queueSuccess();
  const frontendPath = path.join(root, "frontend-already-has-files");
  const writer = new InMemoryProjectFileWriter();

  const stepPromise = viteScaffoldStep(
    spawner,
    writer,
    "vite-scaffold",
    "Scaffold Vite frontend",
    { executable: "npm", args: [], cwd: root },
    frontendPath
  ).execute();
  await flushMicrotask();
  handle.emitExit({ code: 0, signal: null }); // create-vite's real behavior for a non-empty target

  const result = await stepPromise;
  assert.equal(result.succeeded, false);
  assert.ok(result.errorMessage?.includes("did not create a package.json"));
});
