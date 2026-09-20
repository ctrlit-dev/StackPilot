import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import { expressBackendAdapter } from "../../src/adapters/expressBackendAdapter";
import { expressBackendDetection } from "../../src/adapters/expressBackendDetection";
import { viteFrontendDetection } from "../../src/adapters/viteFrontendDetection";
import { DEFAULT_CONFIGURATION } from "../../src/config/configurationModel";
import { getBackendService, getFrontendService, getNodeRuntime, type DetectedService } from "../../src/detection/detectedProject";
import { detectPackageManager, type PackageManager } from "../../src/detection/packageManagerDetector";
import { detectProject } from "../../src/detection/projectDetector";
import { findExpressPreset } from "../../src/project/create/express/expressNewProjectPresets";
import { buildExpressCreatePlan, type ExpressInputs, type ExpressScaffoldContext } from "../../src/project/create/express/expressScaffoldPlan";
import { executeScaffoldSteps } from "../../src/project/scaffoldStep";
import { FakeProcessSpawner } from "./fakes/fakeProcessSpawner";
import { InMemoryFileSystemProbe } from "./fakes/inMemoryFileSystem";
import { InMemoryProjectFileWriter } from "./fakes/inMemoryProjectFileWriter";

/**
 * The mandatory Create -> Detect -> Start architecture proof (EXPRESS-1D-B,
 * plan §15/§16/§19): exercises Express Create's actual output against the
 * real, unmodified expressBackendDetection.detect() and
 * expressBackendAdapter.buildStartCommand() - not mocks of either - proving
 * the scaffold's output is exactly the evidence shape the already-shipped
 * EXPRESS-1B runtime layer requires, with zero changes to detection or the
 * start adapter. Mirrors fastApiScaffoldDetectionIntegration.test.ts's own
 * established pattern.
 */

const parentDirectory = path.resolve("pc-test-fixtures", "express-create-detect-start");
const projectName = "orders-api";
const workspaceRootPath = path.join(parentDirectory, projectName);

function scaffoldContext(spawner: FakeProcessSpawner, writer: InMemoryProjectFileWriter): ExpressScaffoldContext {
  return {
    parentDirectory,
    projectName,
    projectFileWriter: writer,
    spawner,
    onOutput: () => undefined,
    configuration: DEFAULT_CONFIGURATION
  };
}

/** Materializes a writer's own files/directories into a fresh, independent read-only detection fake - the same pattern fastApiScaffoldDetectionIntegration.test.ts uses. */
function materializeIntoFileSystemProbe(writer: InMemoryProjectFileWriter): InMemoryFileSystemProbe {
  const fakeFs = new InMemoryFileSystemProbe();
  for (const [filePath, content] of writer.files) {
    fakeFs.addFile(filePath, content);
  }
  for (const directoryPath of writer.directories) {
    fakeFs.addDirectory(directoryPath);
  }
  return fakeFs;
}

/** The lockfile each package manager's own real `install` run would naturally produce (packageManagerDetector.ts's own LOCKFILES table) - added manually since the fake spawner never actually runs a real install. */
const LOCKFILE_BY_MANAGER: Record<PackageManager, string> = {
  npm: "package-lock.json",
  pnpm: "pnpm-lock.yaml",
  yarn: "yarn.lock",
  bun: "bun.lock"
};

async function buildAndMaterializeExpressOnly(packageManager: PackageManager): Promise<InMemoryFileSystemProbe> {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const inputs: ExpressInputs = { preset: findExpressPreset("express-only"), packageManager };
  const context = scaffoldContext(spawner, writer);

  spawner.queueAutoSuccess(); // install-dependencies

  const plan = buildExpressCreatePlan(context, inputs);
  const result = await executeScaffoldSteps(plan.steps);
  assert.equal(result.failedStep, undefined);

  const fakeFs = materializeIntoFileSystemProbe(writer);
  fakeFs.addFile(path.join(workspaceRootPath, LOCKFILE_BY_MANAGER[packageManager]));
  return fakeFs;
}

void test("Express Create's output is detected by the real, unmodified expressBackendDetection", async () => {
  const fakeFs = await buildAndMaterializeExpressOnly("npm");

  const detection = await expressBackendDetection.detect(fakeFs, workspaceRootPath, "");
  assert.equal(detection.candidates.length, 1);
  assert.equal(detection.candidates[0]?.rootPath, workspaceRootPath);
  assert.equal(detection.candidates[0]?.frameworkEntryPath, path.join(workspaceRootPath, "index.js"));
  assert.equal(detection.candidates[0]?.evidence, "index.js");
  assert.equal(expressBackendDetection.frameworkId, "express");
});

for (const manager of ["npm", "pnpm", "yarn", "bun"] as const) {
  void test(`Express Create's output is started via the real, unmodified expressBackendAdapter with the correct '${manager}' command`, async () => {
    const fakeFs = await buildAndMaterializeExpressOnly(manager);

    const detection = await expressBackendDetection.detect(fakeFs, workspaceRootPath, "");
    assert.equal(detection.candidates.length, 1);

    const packageManagerDetection = await detectPackageManager(fakeFs, workspaceRootPath, "auto");
    assert.equal(packageManagerDetection.kind, "detected");

    const packageJsonContent = await fakeFs.readTextFile(path.join(workspaceRootPath, "package.json"));
    const scripts = (JSON.parse(packageJsonContent) as { scripts: Record<string, string> }).scripts;

    // Hand-construct a DetectedService from those real detection outputs
    // (mirrors fastApiScaffoldDetectionIntegration.test.ts's own step 5) and
    // call the real, unmodified start adapter.
    const service: DetectedService = {
      id: "backend",
      rootPath: detection.candidates[0]?.rootPath ?? "",
      frameworkId: "express",
      runtime: {
        kind: "node",
        packageManager: packageManagerDetection,
        packageJsonPath: path.join(workspaceRootPath, "package.json"),
        scripts
      },
      score: 80,
      evidence: [detection.candidates[0]?.evidence ?? ""]
    };

    assert.equal(getNodeRuntime(service)?.packageManager.kind, "detected");

    const command = expressBackendAdapter.buildStartCommand(service, DEFAULT_CONFIGURATION.backendHost, DEFAULT_CONFIGURATION.backendPort);

    const expectedArgsByManager: Record<PackageManager, readonly string[]> = {
      npm: ["run", "dev"],
      pnpm: ["dev"],
      yarn: ["dev"],
      bun: ["run", "dev"]
    };

    assert.equal(command.executable, manager);
    assert.deepEqual(command.args, expectedArgsByManager[manager]);
    assert.equal(command.cwd, workspaceRootPath);
    assert.equal(command.expectedPort, DEFAULT_CONFIGURATION.backendPort);
    assert.deepEqual(command.env, { PORT: String(DEFAULT_CONFIGURATION.backendPort), HOST: DEFAULT_CONFIGURATION.backendHost });
  });
}

void test("Express + Vite Create requests a nested frontend via the generic .frontend mechanism, and the two resulting services remain independently isolated after real detection", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const inputs: ExpressInputs = { preset: findExpressPreset("express-vite-react-ts"), packageManager: "npm" };
  const context = scaffoldContext(spawner, writer);

  spawner.queueAutoSuccess(); // install-dependencies (Express's own)

  const plan = buildExpressCreatePlan(context, inputs);
  assert.deepEqual(plan.frontend, { packageManager: "npm", template: "react-ts", frontendPort: DEFAULT_CONFIGURATION.frontendPort });

  // Express's own plan.steps only ever scaffold the backend - the nested
  // Vite frontend is the generic composer's (projectStepsComposition.ts)
  // responsibility, already proven elsewhere (viteFrontendSteps tests,
  // FastAPI's own +Vite tests) to call create-vite correctly. This test's
  // own claim is SERVICE ISOLATION after Create, so the frontend's
  // realistic post-create shape is materialized directly here.
  const result = await executeScaffoldSteps(plan.steps);
  assert.equal(result.failedStep, undefined);

  const fakeFs = materializeIntoFileSystemProbe(writer);
  fakeFs.addFile(path.join(workspaceRootPath, "package-lock.json"));

  const frontendRoot = path.join(workspaceRootPath, "frontend");
  fakeFs.addFile(path.join(frontendRoot, "package.json"), JSON.stringify({ name: "frontend", scripts: { dev: "vite" } }));
  fakeFs.addFile(path.join(frontendRoot, "vite.config.ts"));
  fakeFs.addFile(path.join(frontendRoot, "package-lock.json"));

  const detectedProject = await detectProject(fakeFs, workspaceRootPath, DEFAULT_CONFIGURATION, [expressBackendDetection], viteFrontendDetection);

  const backend = getBackendService(detectedProject);
  const frontend = getFrontendService(detectedProject);

  assert.equal(backend?.frameworkId, "express");
  assert.equal(backend?.runtime?.kind, "node");
  assert.equal(backend?.rootPath, workspaceRootPath);

  assert.equal(frontend?.frameworkId, "vite");
  assert.equal(frontend?.rootPath, frontendRoot);

  // Isolation: neither service's root is the other's; the backend's own
  // root package.json was not misdetected as a spurious duplicate frontend
  // (EXPRESS-1B's own fix), and exactly two services exist, not more.
  assert.notEqual(backend?.rootPath, frontend?.rootPath);
  assert.equal(detectedProject.services.length, 2);
});
