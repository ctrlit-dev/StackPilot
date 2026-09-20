import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import { djangoBackendDetection } from "../../src/adapters/djangoBackendDetection";
import { fastApiBackendDetection } from "../../src/adapters/fastApiBackendDetection";
import { viteFrontendDetection } from "../../src/adapters/viteFrontendDetection";
import { planFrontendStart } from "../../src/commands/startPlans";
import { DEFAULT_CONFIGURATION } from "../../src/config/configurationModel";
import { getBackendService, getFrontendService, getNodeRuntime } from "../../src/detection/detectedProject";
import { detectProject } from "../../src/detection/projectDetector";
import { composeProjectSteps } from "../../src/project/create/projectStepsComposition";
import { buildViteReactCreatePlan, type ViteReactInputs, type ViteReactScaffoldContext } from "../../src/project/create/vitereact/viteReactScaffoldPlan";
import { executeScaffoldSteps } from "../../src/project/scaffoldStep";
import { FRONTEND_SERVICE_ID } from "../../src/serviceId";
import { FakeProcessSpawner } from "./fakes/fakeProcessSpawner";
import { InMemoryFileSystemProbe } from "./fakes/inMemoryFileSystem";
import { InMemoryProjectFileWriter } from "./fakes/inMemoryProjectFileWriter";

/**
 * The mandatory Create -> Detect -> Start architecture proof
 * (docs/VITE_CREATE_CODE_TRUTH_AND_IMPLEMENTATION_PLAN.md §25), mirroring
 * fastApiScaffoldDetectionIntegration.test.ts: exercises standalone React +
 * Vite Create's actual output (via the full generic composer, exactly as the
 * wizard runs it) against the real, unmodified detectProject()/
 * viteFrontendDetection/planFrontendStart() - not mocks of any of them -
 * proving the scaffold's root-level output is exactly the evidence shape the
 * already-shipped runtime layer requires, with zero changes to detection,
 * adapters, or the start-planning layer.
 */

const parentDirectory = path.resolve("pc-test-fixtures", "vite-react-create-detect-start");
const projectName = "storefront";
const workspaceRootPath = path.join(parentDirectory, projectName);

function scaffoldContext(spawner: FakeProcessSpawner, writer: InMemoryProjectFileWriter): ViteReactScaffoldContext {
  return {
    parentDirectory,
    projectName,
    projectFileWriter: writer,
    spawner,
    onOutput: () => undefined,
    configuration: DEFAULT_CONFIGURATION
  };
}

void test("standalone React + Vite Create's output is detected as a frontend-only project by the real detectProject()/viteFrontendDetection, and started via the real planFrontendStart(), unmodified", async () => {
  // 1. Build and execute a real React + Vite plan, through the same generic
  // composer the wizard itself calls (composeProjectSteps), against fake
  // spawner/writer.
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const inputs: ViteReactInputs = { template: "react-ts", packageManager: "npm" };
  const context = scaffoldContext(spawner, writer);
  const plan = buildViteReactCreatePlan(context, inputs);

  spawner.queueAutoSuccess(); // scaffold-vite-root
  spawner.queueAutoSuccess(); // install-dependencies

  const steps = composeProjectSteps(spawner, writer, plan, { initializeGit: false });
  const result = await executeScaffoldSteps(steps, (step) => {
    if (step.id === "scaffold-vite-root") {
      // Mirrors real create-vite react-ts output (verified empirically -
      // docs/VITE_CREATE_1A1_ARCHITECTURE_REVALIDATION.md §12), including
      // the package-lock.json a real `npm install` produces, which
      // detectPackageManager's own lockfile-based detection needs.
      writer.preExistingFile(
        path.join(workspaceRootPath, "package.json"),
        JSON.stringify({ name: projectName, private: true, scripts: { dev: "vite", build: "tsc -b && vite build", preview: "vite preview" } })
      );
      writer.preExistingFile(path.join(workspaceRootPath, "vite.config.ts"), "export default {};\n");
      writer.preExistingFile(path.join(workspaceRootPath, "index.html"), "<!doctype html>\n");
      writer.preExistingFile(path.join(workspaceRootPath, "src", "App.tsx"), "export default function App() {}\n");
      writer.preExistingFile(path.join(workspaceRootPath, "README.md"), "# React + TypeScript + Vite\n");
      writer.preExistingFile(path.join(workspaceRootPath, ".gitignore"), "node_modules\ndist\n");
      writer.preExistingFile(path.join(workspaceRootPath, "package-lock.json"), "{}");
    }
  });
  assert.equal(result.failedStep, undefined);

  // 2. Feed the actual written files into a fake FileSystemProbe, the same
  // interface detectProject()/detectFrontendProject() consume.
  const fakeFs = new InMemoryFileSystemProbe();
  for (const [filePath, content] of writer.files) {
    fakeFs.addFile(filePath, content);
  }
  for (const directoryPath of writer.directories) {
    fakeFs.addDirectory(directoryPath);
  }

  // 3. Run the real, unmodified detector, wired exactly as extension.ts wires
  // it (Django and FastAPI backend detections registered, Vite frontend
  // detection registered) - no backend evidence exists anywhere in this
  // workspace.
  const detectedProject = await detectProject(fakeFs, workspaceRootPath, DEFAULT_CONFIGURATION, [djangoBackendDetection, fastApiBackendDetection], [viteFrontendDetection]);

  assert.equal(detectedProject.services.length, 1);
  const [service] = detectedProject.services;
  assert.equal(service?.id, FRONTEND_SERVICE_ID);
  assert.equal(service?.frameworkId, "vite");
  assert.equal(service?.rootPath, workspaceRootPath);
  assert.equal(service?.runtime?.kind, "node");
  const packageManager = getNodeRuntime(service)?.packageManager;
  assert.equal(packageManager?.kind, "detected");
  assert.equal(packageManager?.kind === "detected" ? packageManager.manager : undefined, "npm");

  assert.equal(getBackendService(detectedProject), undefined);
  assert.notEqual(getFrontendService(detectedProject), undefined);

  // 4. Call the real, unmodified start-planning function.
  const plan2 = planFrontendStart(detectedProject, DEFAULT_CONFIGURATION);
  assert.equal(plan2.kind, "ready");
  if (plan2.kind !== "ready") {
    return;
  }
  assert.equal(plan2.command.executable, "npm");
  assert.deepEqual(plan2.command.args, ["run", "dev"]);
  assert.equal(plan2.command.cwd, workspaceRootPath);
  assert.equal(plan2.command.expectedPort, DEFAULT_CONFIGURATION.frontendPort);
});
