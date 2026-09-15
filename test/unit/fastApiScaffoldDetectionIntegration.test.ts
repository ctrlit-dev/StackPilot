import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import { DEFAULT_CONFIGURATION } from "../../src/config/configurationModel";
import { deriveFastApiAppImport, fastApiBackendDetection } from "../../src/adapters/fastApiBackendDetection";
import { fastApiBackendAdapter } from "../../src/adapters/fastApiBackendAdapter";
import type { DetectedService } from "../../src/detection/detectedProject";
import type { PythonEnvironment } from "../../src/detection/pythonDetector";
import { findFastApiPreset } from "../../src/project/create/fastapi/fastApiNewProjectPresets";
import { buildFastApiCreatePlan, type FastApiInputs, type FastApiScaffoldContext } from "../../src/project/create/fastapi/fastApiScaffoldPlan";
import { executeScaffoldSteps } from "../../src/project/scaffoldStep";
import { FakeProcessSpawner } from "./fakes/fakeProcessSpawner";
import { InMemoryFileSystemProbe } from "./fakes/inMemoryFileSystem";
import { InMemoryProjectFileWriter } from "./fakes/inMemoryProjectFileWriter";

/**
 * The mandatory Create -> Detect -> Start architecture proof (FASTAPI-CREATE-1B
 * §34): exercises FastAPI Create's actual output against the real, unmodified
 * fastApiBackendDetection.detect() and fastApiBackendAdapter.buildStartCommand()
 * - not mocks of either - proving the scaffold's output is exactly the
 * evidence shape the already-shipped runtime layer requires, with zero
 * changes to detection or the start adapter.
 */

const parentDirectory = path.resolve("pc-test-fixtures", "fastapi-create-detect-start");
const projectName = "orders-api";
const workspaceRootPath = path.join(parentDirectory, projectName);

function basePython(): PythonEnvironment {
  return { executablePath: "C:\\Python313\\python.exe", source: "path", validation: "exists" };
}

function scaffoldContext(spawner: FakeProcessSpawner, writer: InMemoryProjectFileWriter): FastApiScaffoldContext {
  return {
    parentDirectory,
    projectName,
    projectFileWriter: writer,
    spawner,
    onOutput: () => undefined,
    configuration: DEFAULT_CONFIGURATION
  };
}

void test("FastAPI Create's output is detected by the real fastApiBackendDetection and started via the real fastApiBackendAdapter, unmodified", async () => {
  // 1. Build and execute a FastAPI-only plan against fake spawner/writer.
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const inputs: FastApiInputs = {
    preset: findFastApiPreset("fastapi-only"),
    basePython: basePython(),
    venvDirectoryName: ".venv"
  };
  const context = scaffoldContext(spawner, writer);

  spawner.queueAutoSuccess(); // create-venv
  spawner.queueAutoSuccess(); // upgrade-pip
  spawner.queueAutoSuccess(); // install-fastapi
  spawner.queueAutoSuccess({ code: 0, signal: null }, "Name: fastapi\nVersion: 0.115.0\n"); // read-fastapi-version
  spawner.queueAutoSuccess(); // install-uvicorn
  spawner.queueAutoSuccess({ code: 0, signal: null }, "Name: uvicorn\nVersion: 0.30.6\n"); // read-uvicorn-version

  const plan = buildFastApiCreatePlan(context, inputs);
  const result = await executeScaffoldSteps(plan.steps);
  assert.equal(result.failedStep, undefined);

  // 2. Feed the actual written files into a fake FileSystemProbe, the same
  // interface fastApiBackendDetection.detect() consumes.
  const fakeFs = new InMemoryFileSystemProbe();
  for (const [filePath, content] of writer.files) {
    fakeFs.addFile(filePath, content);
  }
  for (const directoryPath of writer.directories) {
    fakeFs.addDirectory(directoryPath);
  }

  // 3. Run the real, unmodified detector.
  const detection = await fastApiBackendDetection.detect(fakeFs, workspaceRootPath, "");
  assert.equal(detection.candidates.length, 1);
  assert.equal(detection.candidates[0]?.rootPath, workspaceRootPath);
  assert.equal(detection.candidates[0]?.frameworkEntryPath, path.join(workspaceRootPath, "main.py"));
  assert.equal(fastApiBackendDetection.frameworkId, "fastapi");

  // 4. Derive appImport via the real, unmodified helper.
  const appImport = deriveFastApiAppImport(detection.candidates[0]?.rootPath ?? "", detection.candidates[0]?.frameworkEntryPath ?? "");
  assert.equal(appImport, "main:app");

  // 5. Hand-construct a DetectedService from those real outputs and call the
  // real, unmodified start adapter.
  const python: PythonEnvironment = { executablePath: path.join(workspaceRootPath, ".venv", "Scripts", "python.exe"), source: "venv", validation: "exists" };
  const service: DetectedService = {
    id: "backend",
    rootPath: detection.candidates[0]?.rootPath ?? "",
    frameworkId: "fastapi",
    runtime: { kind: "python", detection: { candidates: [python], selected: python, diagnostics: [] } },
    frameworkMetadata: { kind: "fastapi", appImport },
    score: 80,
    evidence: [detection.candidates[0]?.evidence ?? ""]
  };

  const command = fastApiBackendAdapter.buildStartCommand(python, service, DEFAULT_CONFIGURATION.backendHost, DEFAULT_CONFIGURATION.backendPort);

  // 6. Assert the exact argv/cwd the existing, unmodified adapter produces.
  assert.equal(command.executable, python.executablePath);
  assert.deepEqual(command.args, ["-m", "uvicorn", "main:app", "--host", DEFAULT_CONFIGURATION.backendHost, "--port", String(DEFAULT_CONFIGURATION.backendPort)]);
  assert.equal(command.cwd, workspaceRootPath);
});
