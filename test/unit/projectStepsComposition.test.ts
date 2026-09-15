import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import { DEFAULT_CONFIGURATION } from "../../src/config/configurationModel";
import type { PythonEnvironment } from "../../src/detection/pythonDetector";
import type { BackendCreatePlan } from "../../src/project/create/backendCreateModule";
import { composeProjectSteps } from "../../src/project/create/projectStepsComposition";
import { findPreset } from "../../src/project/create/django/djangoNewProjectPresets";
import { buildDjangoCreatePlan, type DjangoScaffoldContext } from "../../src/project/create/django/djangoScaffoldPlan";
import { executeScaffoldSteps } from "../../src/project/scaffoldStep";
import { commandStep, createDirectoryStep } from "../../src/project/scaffoldSteps";
import { FakeProcessSpawner } from "./fakes/fakeProcessSpawner";
import { InMemoryProjectFileWriter } from "./fakes/inMemoryProjectFileWriter";

const projectRoot = path.resolve("pc-test-fixtures", "new-project", "kunden-portal");

/**
 * A plausible, entirely non-Django-shaped BackendCreatePlan - no import of
 * any Django type. Proves composeProjectSteps/buildSharedProjectSteps/
 * buildViteFrontendSteps hold no Django dependency (plan §28, "composer
 * isolation").
 */
function fakeBackendPlan(spawner: FakeProcessSpawner, writer: InMemoryProjectFileWriter, overrides: Partial<BackendCreatePlan> = {}): BackendCreatePlan {
  return {
    projectRoot,
    steps: [
      createDirectoryStep(writer, "backend-dir", "Create backend directory", path.join(projectRoot, "backend")),
      commandStep(spawner, "install-fake-framework", "Install fake framework", { executable: "fake", args: ["install"], cwd: path.join(projectRoot, "backend") }, undefined)
    ],
    gitignoreEntries: ["# Fake", "fake.log"],
    readmeHeaderNote: "Generated with the **Fake** preset.",
    readmeSection: { treeLines: ["├── backend/"], setupCommands: ["fake run"], defaultUrlLine: "- Backend: http://127.0.0.1:9000/" },
    readmeNotes: ["- Fake notes."],
    vscodeSettings: { "fake.setting": "value" },
    confirmationSummary: ["Fake: setting"],
    ...overrides
  };
}

void test("composes project-root, backend steps, then shared steps, in order, when no frontend is requested", () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const plan = fakeBackendPlan(spawner, writer);

  const steps = composeProjectSteps(spawner, writer, plan, { initializeGit: false });

  assert.deepEqual(steps.map((step) => step.id), [
    "project-root",
    "backend-dir",
    "install-fake-framework",
    "docs-dir",
    "docs-readme",
    "vscode-dir",
    "vscode-settings",
    "gitignore",
    "readme"
  ]);
});

void test("inserts frontend steps between backend steps and shared steps only when requested, with git init last", () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const plan = fakeBackendPlan(spawner, writer, {
    frontend: { packageManager: "npm", template: "react-ts", frontendPort: 5173 }
  });

  const steps = composeProjectSteps(spawner, writer, plan, { initializeGit: true });

  assert.deepEqual(steps.map((step) => step.id), [
    "project-root",
    "backend-dir",
    "install-fake-framework",
    "scaffold-frontend",
    "install-frontend-deps",
    "docs-dir",
    "docs-readme",
    "vscode-dir",
    "vscode-settings",
    "gitignore",
    "readme",
    "git-init"
  ]);
});

void test("no duplicate step ids in a full-featured composed run", () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const plan = fakeBackendPlan(spawner, writer, {
    frontend: { packageManager: "npm", template: "react-ts", frontendPort: 5173 }
  });

  const ids = composeProjectSteps(spawner, writer, plan, { initializeGit: true }).map((step) => step.id);
  assert.equal(new Set(ids).size, ids.length);
});

void test("the composed README/gitignore/vscode-settings content matches the backend and frontend contributions", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const plan = fakeBackendPlan(spawner, writer, { frontend: { packageManager: "npm", template: "react-ts", frontendPort: 5173 } });

  spawner.queueAutoSuccess(); // install-fake-framework
  spawner.queueAutoSuccess(); // scaffold-frontend
  spawner.queueAutoSuccess(); // install-frontend-deps

  const steps = composeProjectSteps(spawner, writer, plan, { initializeGit: false });
  const result = await executeScaffoldSteps(steps, (step) => {
    if (step.id === "scaffold-frontend") {
      writer.preExistingFile(path.join(projectRoot, "frontend", "package.json"), "{}");
    }
  });

  assert.equal(result.failedStep, undefined);

  const gitignore = writer.files.get(path.resolve(path.join(projectRoot, ".gitignore")));
  assert.ok(gitignore?.includes("# Fake"));
  assert.ok(gitignore?.includes("fake.log"));

  const readme = writer.files.get(path.resolve(path.join(projectRoot, "README.md")));
  assert.ok(readme?.includes("Generated with the **Fake** preset."));
  assert.ok(readme?.includes("fake run"));
  assert.ok(readme?.includes("cd frontend"));
  assert.ok(readme?.includes("- Fake notes."));

  const vscodeSettings = writer.files.get(path.resolve(path.join(projectRoot, ".vscode", "settings.json")));
  assert.equal(vscodeSettings, '{\n  "fake.setting": "value"\n}\n');
});

function djangoScaffoldContext(spawner: FakeProcessSpawner, writer: InMemoryProjectFileWriter): DjangoScaffoldContext {
  return {
    parentDirectory: path.resolve("pc-test-fixtures", "new-project"),
    projectName: "kunden-portal",
    projectFileWriter: writer,
    spawner,
    onOutput: () => undefined,
    configuration: DEFAULT_CONFIGURATION
  };
}

void test("Django's real plan recomposes into the same step order the pre-CREATE-ARCH-1B monolithic function produced", () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const context = djangoScaffoldContext(spawner, writer);
  const basePython: PythonEnvironment = { executablePath: "C:\\Python313\\python.exe", source: "path", validation: "exists" };

  const djangoPlan = buildDjangoCreatePlan(context, {
    preset: findPreset("django-rest-vite-react-ts"),
    basePython,
    venvDirectoryName: ".venv",
    djangoPackageName: "config",
    starterAppName: "billing",
    packageManager: "npm"
  });

  const steps = composeProjectSteps(spawner, writer, djangoPlan, { initializeGit: true, onGitStatus: () => undefined });

  assert.deepEqual(steps.map((step) => step.id), [
    "project-root",
    "backend-dir",
    "create-venv",
    "upgrade-pip",
    "install-django",
    "read-django-version",
    "install-drf",
    "read-drf-version",
    "django-startproject",
    "django-startapp",
    "requirements-txt",
    "scaffold-frontend",
    "install-frontend-deps",
    "docs-dir",
    "docs-readme",
    "vscode-dir",
    "vscode-settings",
    "gitignore",
    "readme",
    "git-init"
  ]);
});
