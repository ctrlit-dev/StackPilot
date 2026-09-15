import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import { DEFAULT_CONFIGURATION } from "../../src/config/configurationModel";
import type { PythonEnvironment } from "../../src/detection/pythonDetector";
import { findFastApiPreset } from "../../src/project/create/fastapi/fastApiNewProjectPresets";
import {
  buildFastApiCreatePlan,
  resolveFastApiProjectPaths,
  type FastApiInputs,
  type FastApiScaffoldContext
} from "../../src/project/create/fastapi/fastApiScaffoldPlan";
import { executeScaffoldSteps } from "../../src/project/scaffoldStep";
import { FakeProcessSpawner } from "./fakes/fakeProcessSpawner";
import { InMemoryProjectFileWriter } from "./fakes/inMemoryProjectFileWriter";

const parentDirectory = path.resolve("pc-test-fixtures", "new-project");

function basePython(): PythonEnvironment {
  return { executablePath: "C:\\Python313\\python.exe", source: "path", validation: "exists" };
}

function fastApiInputs(overrides: Partial<FastApiInputs> = {}): FastApiInputs {
  return {
    preset: findFastApiPreset("fastapi-vite-react-ts"),
    basePython: basePython(),
    venvDirectoryName: ".venv",
    packageManager: "npm",
    ...overrides
  };
}

function scaffoldContext(spawner: FakeProcessSpawner, writer: InMemoryProjectFileWriter, projectName = "kunden-api"): FastApiScaffoldContext {
  return {
    parentDirectory,
    projectName,
    projectFileWriter: writer,
    spawner,
    onOutput: () => undefined,
    configuration: DEFAULT_CONFIGURATION
  };
}

void test("resolveFastApiProjectPaths lays out the venv flat at the project root, with no backend/ nesting", () => {
  const context = scaffoldContext(new FakeProcessSpawner(), new InMemoryProjectFileWriter());
  const paths = resolveFastApiProjectPaths(context, fastApiInputs());
  assert.equal(paths.projectRoot, path.join(parentDirectory, "kunden-api"));
  assert.equal(paths.venvPath, path.join(parentDirectory, "kunden-api", ".venv"));
  assert.equal(paths.venvInterpreterPathWorkspaceRelative.startsWith("backend/"), false);
  assert.equal(paths.venvInterpreterPathWorkspaceRelative.startsWith(".venv/"), true);
});

void test("a full fastapi-vite-react-ts run completes every step and returns a matching plan", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const inputs = fastApiInputs();
  const context = scaffoldContext(spawner, writer);
  const paths = resolveFastApiProjectPaths(context, inputs);

  // Queued in the exact order buildFastApiCreatePlan's steps issue spawn() calls.
  spawner.queueAutoSuccess(); // create-venv
  spawner.queueAutoSuccess(); // upgrade-pip
  spawner.queueAutoSuccess(); // install-fastapi
  spawner.queueAutoSuccess({ code: 0, signal: null }, "Name: fastapi\nVersion: 0.115.0\n"); // read-fastapi-version
  spawner.queueAutoSuccess(); // install-uvicorn
  spawner.queueAutoSuccess({ code: 0, signal: null }, "Name: uvicorn\nVersion: 0.30.6\n"); // read-uvicorn-version

  const plan = buildFastApiCreatePlan(context, inputs);
  const result = await executeScaffoldSteps(plan.steps);

  assert.equal(result.failedStep, undefined);
  assert.equal(plan.projectRoot, paths.projectRoot);
  assert.deepEqual(plan.frontend, { packageManager: "npm", template: "react-ts", frontendPort: DEFAULT_CONFIGURATION.frontendPort });
  assert.deepEqual(plan.gitignoreEntries, []);
  assert.equal(plan.readmeHeaderNote, "Generated with the **FastAPI + Vite React + TypeScript** preset.");
  assert.deepEqual(plan.vscodeSettings, { "python.defaultInterpreterPath": `\${workspaceFolder}/${paths.venvInterpreterPathWorkspaceRelative}` });
  // No "Location"/"Git repository" lines here - both generic, owned by the wizard (CREATE-ARCH-1B.1).
  assert.deepEqual(plan.confirmationSummary, [
    "Preset: FastAPI + Vite React + TypeScript",
    `Python: ${inputs.basePython.executablePath}`,
    "Virtual environment: .venv",
    "Package manager: npm"
  ]);

  const mainPyContent = writer.files.get(path.resolve(path.join(paths.projectRoot, "main.py")));
  assert.equal(mainPyContent?.includes("FastAPI("), true);
  assert.equal(mainPyContent?.includes("@app.get(\"/\")"), true);

  const requirementsContent = writer.files.get(path.resolve(path.join(paths.projectRoot, "requirements.txt")));
  assert.equal(requirementsContent, "fastapi==0.115.0\nuvicorn==0.30.6\n");
});

void test("the fastapi-only preset builds a plan with no frontend request and never spawns npm", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const fastApiOnlyInputs = fastApiInputs({ preset: findFastApiPreset("fastapi-only"), packageManager: undefined });
  const context = scaffoldContext(spawner, writer);

  spawner.queueAutoSuccess(); // create-venv
  spawner.queueAutoSuccess(); // upgrade-pip
  spawner.queueAutoSuccess(); // install-fastapi
  spawner.queueAutoSuccess({ code: 0, signal: null }, "Version: 0.115.0\n"); // read-fastapi-version
  spawner.queueAutoSuccess(); // install-uvicorn
  spawner.queueAutoSuccess({ code: 0, signal: null }, "Version: 0.30.6\n"); // read-uvicorn-version

  const plan = buildFastApiCreatePlan(context, fastApiOnlyInputs);
  const result = await executeScaffoldSteps(plan.steps);

  assert.equal(result.failedStep, undefined);
  assert.equal(plan.frontend, undefined);
  assert.ok(!spawner.spawnCalls.some((call) => call.executable === "npm"));
  assert.deepEqual(plan.confirmationSummary, [
    "Preset: FastAPI only",
    `Python: ${fastApiOnlyInputs.basePython.executablePath}`,
    "Virtual environment: .venv"
  ]);
});

void test("no step in the plan ever spawns git, or performs any git-repository action", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const inputs = fastApiInputs({ preset: findFastApiPreset("fastapi-only"), packageManager: undefined });
  const context = scaffoldContext(spawner, writer);

  spawner.queueAutoSuccess(); // create-venv
  spawner.queueAutoSuccess(); // upgrade-pip
  spawner.queueAutoSuccess(); // install-fastapi
  spawner.queueAutoSuccess({ code: 0, signal: null }, "Version: 0.115.0\n"); // read-fastapi-version
  spawner.queueAutoSuccess(); // install-uvicorn
  spawner.queueAutoSuccess({ code: 0, signal: null }, "Version: 0.30.6\n"); // read-uvicorn-version

  const plan = buildFastApiCreatePlan(context, inputs);
  await executeScaffoldSteps(plan.steps);

  assert.ok(!spawner.spawnCalls.some((call) => call.executable === "git"));
  assert.ok(!plan.steps.some((step) => step.id === "git-init"));
});

void test("every command uses the venv's own python interpreter, structured argv, never a composed shell string", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const inputs = fastApiInputs({ preset: findFastApiPreset("fastapi-only"), packageManager: undefined });
  const context = scaffoldContext(spawner, writer);
  const paths = resolveFastApiProjectPaths(context, inputs);
  const venvInterpreterPath = path.join(paths.venvPath, process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python");

  spawner.queueAutoSuccess(); // create-venv
  spawner.queueAutoSuccess(); // upgrade-pip
  spawner.queueAutoSuccess(); // install-fastapi
  spawner.queueAutoSuccess({ code: 0, signal: null }, "Version: 0.115.0\n"); // read-fastapi-version
  spawner.queueAutoSuccess(); // install-uvicorn
  spawner.queueAutoSuccess({ code: 0, signal: null }, "Version: 0.30.6\n"); // read-uvicorn-version

  const plan = buildFastApiCreatePlan(context, inputs);
  await executeScaffoldSteps(plan.steps);

  assert.equal(spawner.spawnCalls[0]?.executable, inputs.basePython.executablePath);
  assert.deepEqual(spawner.spawnCalls[0]?.args, ["-m", "venv", paths.venvPath]);
  assert.equal(spawner.spawnCalls[0]?.cwd, paths.projectRoot);
  for (const call of spawner.spawnCalls.slice(1)) {
    assert.equal(call.executable, venvInterpreterPath);
    assert.ok(Array.isArray(call.args));
    assert.ok(call.args.every((arg) => typeof arg === "string"));
  }
});

void test("stops at the failing step and does not write requirements.txt or main.py", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const inputs = fastApiInputs();
  const context = scaffoldContext(spawner, writer);
  const paths = resolveFastApiProjectPaths(context, inputs);

  spawner.queueAutoSuccess(); // create-venv
  spawner.queueAutoSuccess(); // upgrade-pip
  spawner.queueAutoSuccess({ code: 1, signal: null }); // install-fastapi fails

  const plan = buildFastApiCreatePlan(context, inputs);
  const result = await executeScaffoldSteps(plan.steps);

  assert.equal(result.failedStep?.id, "install-fastapi");
  assert.equal(writer.files.has(path.resolve(path.join(paths.projectRoot, "main.py"))), false);
  assert.equal(writer.files.has(path.resolve(path.join(paths.projectRoot, "requirements.txt"))), false);
});

void test("step ordering matches the specified backend-owned sequence", () => {
  const context = scaffoldContext(new FakeProcessSpawner(), new InMemoryProjectFileWriter());
  const plan = buildFastApiCreatePlan(context, fastApiInputs());

  assert.deepEqual(
    plan.steps.map((step) => step.id),
    ["create-venv", "upgrade-pip", "install-fastapi", "read-fastapi-version", "install-uvicorn", "read-uvicorn-version", "write-main-py", "requirements-txt"]
  );
});
