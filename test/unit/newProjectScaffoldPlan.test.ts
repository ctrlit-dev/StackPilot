import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import type { PythonEnvironment } from "../../src/detection/pythonDetector";
import { findPreset } from "../../src/project/newProjectPresets";
import { buildNewProjectSteps, resolveNewProjectPaths, type NewProjectAnswers } from "../../src/project/newProjectScaffoldPlan";
import { executeScaffoldSteps } from "../../src/project/scaffoldStep";
import { FakeProcessSpawner } from "./fakes/fakeProcessSpawner";
import { InMemoryProjectFileWriter } from "./fakes/inMemoryProjectFileWriter";

const parentDirectory = path.resolve("pc-test-fixtures", "new-project");

function basePython(): PythonEnvironment {
  return { executablePath: "C:\\Python313\\python.exe", source: "path", validation: "exists" };
}

function answers(overrides: Partial<NewProjectAnswers> = {}): NewProjectAnswers {
  return {
    parentDirectory,
    projectName: "kunden-portal",
    preset: findPreset("django-vite-react-ts"),
    basePython: basePython(),
    venvDirectoryName: ".venv",
    djangoPackageName: "config",
    packageManager: "npm",
    backendHost: "127.0.0.1",
    backendPort: 8000,
    frontendPort: 5173,
    ...overrides
  };
}

void test("resolveNewProjectPaths lays out backend/frontend/venv under the project root", () => {
  const paths = resolveNewProjectPaths(answers());
  assert.equal(paths.projectRoot, path.join(parentDirectory, "kunden-portal"));
  assert.equal(paths.backendRoot, path.join(parentDirectory, "kunden-portal", "backend"));
  assert.equal(paths.venvPath, path.join(parentDirectory, "kunden-portal", "backend", ".venv"));
  assert.equal(paths.frontendRoot, path.join(parentDirectory, "kunden-portal", "frontend"));
});

void test("resolveNewProjectPaths omits frontendRoot for the Django-only preset", () => {
  const paths = resolveNewProjectPaths(answers({ preset: findPreset("django-only"), packageManager: undefined }));
  assert.equal(paths.frontendRoot, undefined);
});

void test("a full django-rest-vite-react-ts run with a starter app and git completes every step", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const restAnswers = answers({ preset: findPreset("django-rest-vite-react-ts"), starterAppName: "billing" });
  const paths = resolveNewProjectPaths(restAnswers);

  // Queued in the exact order buildNewProjectSteps issues spawn() calls.
  spawner.queueAutoSuccess(); // create-venv
  spawner.queueAutoSuccess(); // upgrade-pip
  spawner.queueAutoSuccess(); // install-django
  spawner.queueAutoSuccess({ code: 0, signal: null }, "Name: Django\nVersion: 6.1.1\n"); // read-django-version
  spawner.queueAutoSuccess(); // install-drf
  spawner.queueAutoSuccess({ code: 0, signal: null }, "Name: djangorestframework\nVersion: 3.15.2\n"); // read-drf-version
  spawner.queueAutoSuccess(); // django-startproject
  spawner.queueAutoSuccess(); // django-startapp billing
  spawner.queueAutoSuccess(); // scaffold-frontend (vite)
  spawner.queueAutoSuccess(); // install-frontend-deps
  spawner.queueAutoSuccess(); // git-init

  let gitStatus: string | undefined;
  const steps = buildNewProjectSteps(spawner, writer, restAnswers, {
    initializeGit: true,
    onGitStatus: (status) => {
      gitStatus = status;
    }
  });
  const result = await executeScaffoldSteps(steps, (step) => {
    // Simulates create-vite having written package.json by the time
    // viteScaffoldStep checks for it, injected exactly when that step
    // starts so it does not retroactively mark project-root/backend-dir
    // (already-completed earlier steps) as having pre-existed.
    if (step.id === "scaffold-frontend") {
      writer.preExistingFile(path.join(paths.frontendRoot!, "package.json"), "{}");
    }
  });

  assert.equal(result.failedStep, undefined);
  assert.equal(gitStatus, "initialized");

  const requirementsContent = writer.files.get(path.resolve(path.join(paths.backendRoot, "requirements.txt")));
  assert.equal(requirementsContent, "Django==6.1.1\ndjangorestframework==3.15.2\n");

  for (const expectedFile of ["README.md", ".gitignore"]) {
    assert.ok(writer.files.has(path.resolve(path.join(paths.projectRoot, expectedFile))), `expected ${expectedFile} to be written`);
  }
  assert.ok(writer.files.has(path.resolve(path.join(paths.projectRoot, "docs", "README.md"))));
  assert.ok(writer.files.has(path.resolve(path.join(paths.projectRoot, ".vscode", "settings.json"))));

  assert.deepEqual(new Set(result.createdPaths), new Set([
    path.resolve(paths.projectRoot),
    path.resolve(paths.backendRoot),
    path.resolve(path.join(paths.backendRoot, "requirements.txt")),
    path.resolve(paths.frontendRoot!),
    path.resolve(path.join(paths.projectRoot, "docs")),
    path.resolve(path.join(paths.projectRoot, "docs", "README.md")),
    path.resolve(path.join(paths.projectRoot, ".vscode")),
    path.resolve(path.join(paths.projectRoot, ".vscode", "settings.json")),
    path.resolve(path.join(paths.projectRoot, ".gitignore")),
    path.resolve(path.join(paths.projectRoot, "README.md"))
  ]));
});

void test("the Django-only preset never spawns npm or git", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const djangoOnlyAnswers = answers({ preset: findPreset("django-only"), packageManager: undefined });

  spawner.queueAutoSuccess(); // create-venv
  spawner.queueAutoSuccess(); // upgrade-pip
  spawner.queueAutoSuccess(); // install-django
  spawner.queueAutoSuccess({ code: 0, signal: null }, "Version: 6.1.1\n"); // read-django-version
  spawner.queueAutoSuccess(); // django-startproject

  const steps = buildNewProjectSteps(spawner, writer, djangoOnlyAnswers, { initializeGit: false });
  const result = await executeScaffoldSteps(steps);

  assert.equal(result.failedStep, undefined);
  assert.ok(!spawner.spawnCalls.some((call) => call.executable === "npm"));
  assert.ok(!spawner.spawnCalls.some((call) => call.executable === "git"));
});

void test("stops at the failing step and does not write requirements.txt or scaffold the frontend", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();

  spawner.queueAutoSuccess(); // create-venv
  spawner.queueAutoSuccess(); // upgrade-pip
  spawner.queueAutoSuccess({ code: 1, signal: null }); // install-django fails

  const steps = buildNewProjectSteps(spawner, writer, answers(), { initializeGit: false });
  const result = await executeScaffoldSteps(steps);

  assert.equal(result.failedStep?.id, "install-django");
  assert.deepEqual(result.createdPaths, [path.resolve(answers().parentDirectory, "kunden-portal"), path.resolve(answers().parentDirectory, "kunden-portal", "backend")]);
  assert.equal(writer.files.has(path.resolve(path.join(resolveNewProjectPaths(answers()).backendRoot, "requirements.txt"))), false);
  assert.equal(spawner.spawnCalls.some((call) => call.executable === "npm"), false);
});

void test("a Git-unavailable environment does not fail the overall scaffold (spec §32)", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const djangoOnlyAnswers = answers({ preset: findPreset("django-only"), packageManager: undefined });

  spawner.queueAutoSuccess(); // create-venv
  spawner.queueAutoSuccess(); // upgrade-pip
  spawner.queueAutoSuccess(); // install-django
  spawner.queueAutoSuccess({ code: 0, signal: null }, "Version: 6.1.1\n"); // read-django-version
  spawner.queueAutoSuccess(); // django-startproject
  spawner.queueFailure(new Error("spawn git ENOENT")); // git-init: git not installed

  let gitStatus: string | undefined;
  const steps = buildNewProjectSteps(spawner, writer, djangoOnlyAnswers, {
    initializeGit: true,
    onGitStatus: (status) => {
      gitStatus = status;
    }
  });
  const result = await executeScaffoldSteps(steps);

  assert.equal(result.failedStep, undefined, "a missing git must not fail the whole scaffold");
  assert.equal(gitStatus, "unavailable");
});
