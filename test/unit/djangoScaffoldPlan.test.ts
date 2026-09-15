import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import { DEFAULT_CONFIGURATION } from "../../src/config/configurationModel";
import type { PythonEnvironment } from "../../src/detection/pythonDetector";
import { findPreset } from "../../src/project/create/django/djangoNewProjectPresets";
import { buildDjangoCreatePlan, resolveDjangoProjectPaths, type DjangoInputs, type DjangoScaffoldContext } from "../../src/project/create/django/djangoScaffoldPlan";
import { executeScaffoldSteps } from "../../src/project/scaffoldStep";
import { FakeProcessSpawner } from "./fakes/fakeProcessSpawner";
import { InMemoryProjectFileWriter } from "./fakes/inMemoryProjectFileWriter";

const parentDirectory = path.resolve("pc-test-fixtures", "new-project");

function basePython(): PythonEnvironment {
  return { executablePath: "C:\\Python313\\python.exe", source: "path", validation: "exists" };
}

function djangoInputs(overrides: Partial<DjangoInputs> = {}): DjangoInputs {
  return {
    preset: findPreset("django-vite-react-ts"),
    basePython: basePython(),
    venvDirectoryName: ".venv",
    djangoPackageName: "config",
    packageManager: "npm",
    ...overrides
  };
}

function scaffoldContext(spawner: FakeProcessSpawner, writer: InMemoryProjectFileWriter, projectName = "kunden-portal"): DjangoScaffoldContext {
  return {
    parentDirectory,
    projectName,
    projectFileWriter: writer,
    spawner,
    onOutput: () => undefined,
    configuration: DEFAULT_CONFIGURATION
  };
}

void test("resolveDjangoProjectPaths lays out backend/venv under the project root", () => {
  const context = scaffoldContext(new FakeProcessSpawner(), new InMemoryProjectFileWriter());
  const paths = resolveDjangoProjectPaths(context, djangoInputs());
  assert.equal(paths.projectRoot, path.join(parentDirectory, "kunden-portal"));
  assert.equal(paths.backendRoot, path.join(parentDirectory, "kunden-portal", "backend"));
  assert.equal(paths.venvPath, path.join(parentDirectory, "kunden-portal", "backend", ".venv"));
  assert.equal(paths.venvInterpreterPathWorkspaceRelative.startsWith("backend/.venv/"), true);
});

void test("a full django-rest-vite-react-ts run with a starter app completes every step and returns a matching plan", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const restInputs = djangoInputs({ preset: findPreset("django-rest-vite-react-ts"), starterAppName: "billing" });
  const context = scaffoldContext(spawner, writer);
  const paths = resolveDjangoProjectPaths(context, restInputs);

  // Queued in the exact order buildDjangoCreatePlan's steps issue spawn() calls.
  spawner.queueAutoSuccess(); // create-venv
  spawner.queueAutoSuccess(); // upgrade-pip
  spawner.queueAutoSuccess(); // install-django
  spawner.queueAutoSuccess({ code: 0, signal: null }, "Name: Django\nVersion: 6.1.1\n"); // read-django-version
  spawner.queueAutoSuccess(); // install-drf
  spawner.queueAutoSuccess({ code: 0, signal: null }, "Name: djangorestframework\nVersion: 3.15.2\n"); // read-drf-version
  spawner.queueAutoSuccess(); // django-startproject
  spawner.queueAutoSuccess(); // django-startapp billing

  const plan = buildDjangoCreatePlan(context, restInputs);
  const result = await executeScaffoldSteps(plan.steps);

  assert.equal(result.failedStep, undefined);
  assert.equal(plan.projectRoot, paths.projectRoot);
  assert.deepEqual(plan.frontend, { packageManager: "npm", template: "react-ts", frontendPort: DEFAULT_CONFIGURATION.frontendPort });
  assert.deepEqual(plan.gitignoreEntries, ["# Django", "db.sqlite3", "staticfiles/"]);
  assert.equal(plan.readmeHeaderNote, "Generated with the **Django REST API + Vite React + TypeScript** preset.");
  assert.deepEqual(plan.vscodeSettings, { "python.defaultInterpreterPath": `\${workspaceFolder}/${paths.venvInterpreterPathWorkspaceRelative}` });
  // No "Location"/"Git repository" lines here - both generic, owned by the wizard (CREATE-ARCH-1B.1).
  assert.deepEqual(plan.confirmationSummary, [
    "Preset: Django REST API + Vite React + TypeScript",
    `Python: ${restInputs.basePython.executablePath}`,
    "Virtual environment: backend/.venv",
    "Django package: config",
    "Starter app: billing",
    "Package manager: npm"
  ]);

  const requirementsContent = writer.files.get(path.resolve(path.join(paths.backendRoot, "requirements.txt")));
  assert.equal(requirementsContent, "Django==6.1.1\ndjangorestframework==3.15.2\n");

  assert.deepEqual(
    new Set(result.createdPaths),
    new Set([path.resolve(paths.backendRoot), path.resolve(path.join(paths.backendRoot, "requirements.txt"))])
  );
});

void test("the Django-only preset builds a plan with no frontend request and never spawns npm", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const djangoOnlyInputs = djangoInputs({ preset: findPreset("django-only"), packageManager: undefined });
  const context = scaffoldContext(spawner, writer);

  spawner.queueAutoSuccess(); // create-venv
  spawner.queueAutoSuccess(); // upgrade-pip
  spawner.queueAutoSuccess(); // install-django
  spawner.queueAutoSuccess({ code: 0, signal: null }, "Version: 6.1.1\n"); // read-django-version
  spawner.queueAutoSuccess(); // django-startproject

  const plan = buildDjangoCreatePlan(context, djangoOnlyInputs);
  const result = await executeScaffoldSteps(plan.steps);

  assert.equal(result.failedStep, undefined);
  assert.equal(plan.frontend, undefined);
  assert.ok(!spawner.spawnCalls.some((call) => call.executable === "npm"));
  assert.deepEqual(plan.confirmationSummary, [
    "Preset: Django only",
    `Python: ${djangoOnlyInputs.basePython.executablePath}`,
    "Virtual environment: backend/.venv",
    "Django package: config"
  ]);
});

void test("stops at the failing step and does not write requirements.txt", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const context = scaffoldContext(spawner, writer);
  const inputs = djangoInputs();
  const paths = resolveDjangoProjectPaths(context, inputs);

  spawner.queueAutoSuccess(); // create-venv
  spawner.queueAutoSuccess(); // upgrade-pip
  spawner.queueAutoSuccess({ code: 1, signal: null }); // install-django fails

  const plan = buildDjangoCreatePlan(context, inputs);
  const result = await executeScaffoldSteps(plan.steps);

  assert.equal(result.failedStep?.id, "install-django");
  assert.deepEqual(result.createdPaths, [path.resolve(paths.backendRoot)]);
  assert.equal(writer.files.has(path.resolve(path.join(paths.backendRoot, "requirements.txt"))), false);
});
