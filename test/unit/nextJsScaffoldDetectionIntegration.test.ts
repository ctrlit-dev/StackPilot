import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import { expressBackendDetection } from "../../src/adapters/expressBackendDetection";
import { nextFrontendDetection } from "../../src/adapters/nextFrontendDetection";
import { viteFrontendDetection } from "../../src/adapters/viteFrontendDetection";
import { planFrontendStart } from "../../src/commands/startPlans";
import { DEFAULT_CONFIGURATION } from "../../src/config/configurationModel";
import { getBackendService, getFrontendService, getNodeRuntime } from "../../src/detection/detectedProject";
import { detectProject } from "../../src/detection/projectDetector";
import { composeProjectSteps } from "../../src/project/create/projectStepsComposition";
import { buildNextJsCreatePlan, type NextJsInputs, type NextJsScaffoldContext } from "../../src/project/create/nextjs/nextJsScaffoldPlan";
import { findNextJsPreset } from "../../src/project/create/nextjs/nextJsNewProjectPresets";
import { executeScaffoldSteps } from "../../src/project/scaffoldStep";
import { FRONTEND_SERVICE_ID } from "../../src/serviceId";
import { FakeProcessSpawner } from "./fakes/fakeProcessSpawner";
import { InMemoryFileSystemProbe } from "./fakes/inMemoryFileSystem";
import { InMemoryProjectFileWriter } from "./fakes/inMemoryProjectFileWriter";

/**
 * The mandatory Create -> Detect -> Start architecture proof
 * (docs/NEXTJS_CODE_TRUTH_AND_IMPLEMENTATION_PLAN.md §21, NEXTJS-1D §26/§27),
 * mirroring viteReactScaffoldDetectionIntegration.test.ts: exercises
 * standalone Next.js Create's actual output (via the full generic composer,
 * exactly as the wizard runs it) against the real, unmodified
 * detectProject()/nextFrontendDetection/planFrontendStart() from the
 * already-shipped (and here, protected/untouched) NEXTJS-1B - not mocks of
 * any of them - proving the scaffold's root-level output is exactly the
 * evidence shape the runtime layer requires, with zero changes to
 * detection, adapters, or the start-planning layer, and with no accidental
 * Express backend registered at the same root.
 */

const parentDirectory = path.resolve("pc-test-fixtures", "nextjs-create-detect-start");
const projectName = "storefront";
const workspaceRootPath = path.join(parentDirectory, projectName);

function scaffoldContext(spawner: FakeProcessSpawner, writer: InMemoryProjectFileWriter): NextJsScaffoldContext {
  return {
    parentDirectory,
    projectName,
    projectFileWriter: writer,
    spawner,
    onOutput: () => undefined,
    configuration: DEFAULT_CONFIGURATION
  };
}

void test("standalone Next.js Create's output is detected as a frontend-only project by the real, unmodified NEXTJS-1B detectProject()/nextFrontendDetection, and started via the real, unmodified planFrontendStart()", async () => {
  // 1. Build and execute a real Next.js plan, through the same generic
  // composer the wizard itself calls (composeProjectSteps), against fake
  // spawner/writer.
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const inputs: NextJsInputs = { preset: findNextJsPreset("nextjs-typescript"), packageManager: "npm" };
  const context = scaffoldContext(spawner, writer);
  const plan = buildNextJsCreatePlan(context, inputs);

  spawner.queueAutoSuccess(); // scaffold-nextjs-root

  const steps = composeProjectSteps(spawner, writer, plan, { initializeGit: false });
  const result = await executeScaffoldSteps(steps, (step) => {
    if (step.id === "scaffold-nextjs-root") {
      // Mirrors real create-next-app 16.3.5 output (empirically verified -
      // docs/NEXTJS_CODE_TRUTH_AND_IMPLEMENTATION_PLAN.md), including the
      // package-lock.json a real `npm install` produces, which
      // detectPackageManager's own lockfile-based detection needs.
      writer.preExistingFile(
        path.join(workspaceRootPath, "package.json"),
        JSON.stringify({
          name: projectName,
          version: "0.1.0",
          private: true,
          scripts: { dev: "next dev", build: "next build", start: "next start", lint: "eslint" },
          dependencies: { next: "16.3.5", react: "19.2.8", "react-dom": "19.2.8" },
          devDependencies: { typescript: "^5" }
        })
      );
      writer.preExistingFile(path.join(workspaceRootPath, "next.config.ts"), "export default {};\n");
      writer.preExistingFile(path.join(workspaceRootPath, "src", "app", "page.tsx"), "export default function Page() {}\n");
      writer.preExistingFile(path.join(workspaceRootPath, "README.md"), "This is a Next.js project bootstrapped with `create-next-app`.\n");
      writer.preExistingFile(path.join(workspaceRootPath, ".gitignore"), "/node_modules\n/.next/\n");
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

  // 3. Run the real, unmodified NEXTJS-1B detector, wired exactly as
  // extension.ts wires it (Express backend detection registered - proving
  // no accidental backend collision; Vite AND Next.js frontend detections
  // registered together).
  const detectedProject = await detectProject(fakeFs, workspaceRootPath, DEFAULT_CONFIGURATION, [expressBackendDetection], [
    viteFrontendDetection,
    nextFrontendDetection
  ]);

  assert.equal(detectedProject.services.length, 1);
  const [service] = detectedProject.services;
  assert.equal(service?.id, FRONTEND_SERVICE_ID);
  assert.equal(service?.frameworkId, "next");
  assert.equal(service?.rootPath, workspaceRootPath);
  assert.equal(service?.runtime?.kind, "node");
  const packageManager = getNodeRuntime(service)?.packageManager;
  assert.equal(packageManager?.kind, "detected");
  assert.equal(packageManager?.kind === "detected" ? packageManager.manager : undefined, "npm");

  assert.equal(getBackendService(detectedProject), undefined);
  assert.notEqual(getFrontendService(detectedProject), undefined);

  // 4. Call the real, unmodified start-planning function.
  const startPlan = planFrontendStart(detectedProject, DEFAULT_CONFIGURATION);
  assert.equal(startPlan.kind, "ready");
  if (startPlan.kind !== "ready") {
    return;
  }
  assert.equal(startPlan.command.executable, "npm");
  assert.deepEqual(startPlan.command.args, ["run", "dev"]);
  assert.equal(startPlan.command.cwd, workspaceRootPath);
  assert.equal(startPlan.command.expectedPort, DEFAULT_CONFIGURATION.frontendPort);
});
