import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import { DEFAULT_CONFIGURATION } from "../../src/config/configurationModel";
import type { PackageManager } from "../../src/detection/packageManagerDetector";
import type { ViteTemplate } from "../../src/execution/viteScaffoldCommand";
import { composeProjectSteps } from "../../src/project/create/projectStepsComposition";
import {
  buildViteReactCreatePlan,
  resolveViteReactProjectPaths,
  type ViteReactInputs,
  type ViteReactScaffoldContext
} from "../../src/project/create/vitereact/viteReactScaffoldPlan";
import { cleanupCreatedPaths } from "../../src/project/projectCollision";
import { executeScaffoldSteps } from "../../src/project/scaffoldStep";
import { FakeProcessSpawner } from "./fakes/fakeProcessSpawner";
import { InMemoryProjectFileWriter } from "./fakes/inMemoryProjectFileWriter";

const parentDirectory = path.resolve("pc-test-fixtures", "new-project");
const projectName = "kunden-frontend";
const projectRoot = path.join(parentDirectory, projectName);

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

function inputs(overrides: Partial<ViteReactInputs> = {}): ViteReactInputs {
  return { template: "react-ts", packageManager: "npm", ...overrides };
}

/** Mirrors real create-vite react-ts output, verified empirically against the actual toolchain (docs/VITE_CREATE_1A1_ARCHITECTURE_REVALIDATION.md §12). */
function preExistingCreateViteOutput(writer: InMemoryProjectFileWriter): void {
  writer.preExistingFile(path.join(projectRoot, "package.json"), '{"name":"kunden-frontend","private":true}');
  writer.preExistingFile(path.join(projectRoot, "vite.config.ts"), "export default {};\n");
  writer.preExistingFile(path.join(projectRoot, "index.html"), "<!doctype html>\n");
  writer.preExistingFile(path.join(projectRoot, "src", "App.tsx"), "export default function App() {}\n");
  writer.preExistingFile(
    path.join(projectRoot, "README.md"),
    "# React + TypeScript + Vite\n\nThis template provides a minimal setup to get React working in Vite with HMR.\n"
  );
  writer.preExistingFile(path.join(projectRoot, ".gitignore"), "# Logs\nlogs\n*.log\n\nnode_modules\ndist\ndist-ssr\n*.local\n\n.vscode/*\n!.vscode/extensions.json\n.idea\n.DS_Store\n");
}

class ThrowingRemoveProjectFileWriter extends InMemoryProjectFileWriter {
  public constructor(private readonly failOnPath: string) {
    super();
  }

  public override removePath(targetPath: string): Promise<void> {
    if (path.resolve(targetPath) === path.resolve(this.failOnPath)) {
      return Promise.reject(new Error("Simulated permission error removing the file"));
    }
    return super.removePath(targetPath);
  }
}

void test("resolveViteReactProjectPaths lays out the project flat at the project root", () => {
  const context = scaffoldContext(new FakeProcessSpawner(), new InMemoryProjectFileWriter());
  const paths = resolveViteReactProjectPaths(context);
  assert.equal(paths.projectRoot, projectRoot);
});

void test("step ordering: scaffold, then remove create-vite's own root files, then install dependencies", () => {
  const context = scaffoldContext(new FakeProcessSpawner(), new InMemoryProjectFileWriter());
  const plan = buildViteReactCreatePlan(context, inputs());
  assert.deepEqual(
    plan.steps.map((step) => step.id),
    ["scaffold-vite-root", "remove-create-vite-root-files", "install-dependencies"]
  );
});

void test("a full run completes every step and returns a matching plan", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const context = scaffoldContext(spawner, writer);
  const plan = buildViteReactCreatePlan(context, inputs());

  spawner.queueAutoSuccess(); // scaffold-vite-root
  spawner.queueAutoSuccess(); // install-dependencies

  const result = await executeScaffoldSteps(plan.steps, (step) => {
    if (step.id === "scaffold-vite-root") {
      preExistingCreateViteOutput(writer);
    }
  });

  assert.equal(result.failedStep, undefined);
  assert.equal(plan.projectRoot, projectRoot);
  assert.deepEqual(plan.gitignoreEntries, ["*.local"]);
  assert.equal(plan.readmeHeaderNote, "Generated with the **React + TypeScript + Vite** project type.");
  assert.equal(plan.readmeSection.heading, "Setup");
  assert.deepEqual(plan.readmeSection.treeLines, ["├── package.json", "├── vite.config.*", "├── index.html", "├── src/"]);
  assert.deepEqual(plan.readmeSection.setupCommands, ["npm install", "npm run dev"]);
  assert.equal(plan.readmeSection.defaultUrlLine, `- Frontend: http://127.0.0.1:${DEFAULT_CONFIGURATION.frontendPort}/ (Vite may choose a different port if this one is busy)`);
  assert.deepEqual(plan.vscodeSettings, {});
  assert.equal(plan.frontend, undefined);
  assert.deepEqual(plan.confirmationSummary, ["Project type: React + Vite", "Template: React + TypeScript", "Package manager: npm"]);

  // The create-vite invocation itself.
  assert.equal(spawner.spawnCalls[0]?.executable, "npm");
  assert.deepEqual(spawner.spawnCalls[0]?.args, ["create", "vite@latest", ".", "--yes", "--", "--template", "react-ts", "--no-interactive"]);
  assert.equal(spawner.spawnCalls[0]?.cwd, projectRoot);

  // The dependency install.
  assert.equal(spawner.spawnCalls[1]?.executable, "npm");
  assert.deepEqual(spawner.spawnCalls[1]?.args, ["install"]);
  assert.equal(spawner.spawnCalls[1]?.cwd, projectRoot);
});

void test("root createdPaths: the scaffold step reports no createdPaths of its own - projectRoot is already tracked by the generic project-root step", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const context = scaffoldContext(spawner, writer);
  const plan = buildViteReactCreatePlan(context, inputs());

  spawner.queueAutoSuccess(); // scaffold-vite-root
  spawner.queueAutoSuccess(); // install-dependencies

  const result = await executeScaffoldSteps(plan.steps, (step) => {
    if (step.id === "scaffold-vite-root") {
      preExistingCreateViteOutput(writer);
    }
  });

  assert.equal(result.failedStep, undefined);
  assert.deepEqual(result.createdPaths, []);
});

void test("scaffold fails when create-vite reports exit 0 but package.json was never created (the empirically-verified quirk)", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const context = scaffoldContext(spawner, writer);
  const plan = buildViteReactCreatePlan(context, inputs());

  spawner.queueAutoSuccess(); // scaffold-vite-root reports success, but no files are written

  const result = await executeScaffoldSteps(plan.steps);

  assert.equal(result.failedStep?.id, "scaffold-vite-root");
  assert.match(result.failedStep?.errorMessage ?? "", /did not create a package\.json/);
});

void test("scaffold fails on a non-zero exit code", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const context = scaffoldContext(spawner, writer);
  const plan = buildViteReactCreatePlan(context, inputs());

  spawner.queueAutoSuccess({ code: 1, signal: null });

  const result = await executeScaffoldSteps(plan.steps);

  assert.equal(result.failedStep?.id, "scaffold-vite-root");
});

void test("collision cleanup removes exactly create-vite's own README.md/.gitignore, and only those two files, from within projectRoot", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const context = scaffoldContext(spawner, writer);
  const plan = buildViteReactCreatePlan(context, inputs());

  spawner.queueAutoSuccess(); // scaffold-vite-root
  spawner.queueAutoSuccess(); // install-dependencies

  await executeScaffoldSteps(plan.steps, (step) => {
    if (step.id === "scaffold-vite-root") {
      preExistingCreateViteOutput(writer);
    }
  });

  assert.deepEqual(
    writer.removedPaths.sort(),
    [path.resolve(projectRoot, ".gitignore"), path.resolve(projectRoot, "README.md")].sort()
  );
  assert.equal(writer.files.has(path.resolve(projectRoot, "package.json")), true);
  assert.equal(writer.files.has(path.resolve(projectRoot, "vite.config.ts")), true);
  assert.equal(writer.files.has(path.resolve(projectRoot, "src", "App.tsx")), true);
});

void test("collision cleanup is a no-op, not a failure, when create-vite did not produce a README.md/.gitignore", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const context = scaffoldContext(spawner, writer);
  const plan = buildViteReactCreatePlan(context, inputs());

  spawner.queueAutoSuccess(); // scaffold-vite-root
  spawner.queueAutoSuccess(); // install-dependencies

  const result = await executeScaffoldSteps(plan.steps, (step) => {
    if (step.id === "scaffold-vite-root") {
      // Only the file the postcondition actually checks for - no README/.gitignore this time.
      writer.preExistingFile(path.join(projectRoot, "package.json"), "{}");
    }
  });

  assert.equal(result.failedStep, undefined);
  assert.deepEqual(writer.removedPaths, []);
});

void test("collision cleanup failure fails the whole scaffold - StackPilot's own README/.gitignore must never be silently skipped", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new ThrowingRemoveProjectFileWriter(path.join(projectRoot, "README.md"));
  const context = scaffoldContext(spawner, writer);
  const plan = buildViteReactCreatePlan(context, inputs());

  spawner.queueAutoSuccess(); // scaffold-vite-root

  const result = await executeScaffoldSteps(plan.steps, (step) => {
    if (step.id === "scaffold-vite-root") {
      preExistingCreateViteOutput(writer);
    }
  });

  assert.equal(result.failedStep?.id, "remove-create-vite-root-files");
  assert.match(result.failedStep?.errorMessage ?? "", /Could not remove create-vite's own README\.md/);
  // install-dependencies must never have run once cleanup failed.
  assert.equal(spawner.spawnCalls.length, 1);
});

const PACKAGE_MANAGERS: readonly PackageManager[] = ["npm", "pnpm", "yarn", "bun"];
const CREATE_VITE_ARGV_SHAPE: Readonly<Record<PackageManager, readonly string[]>> = {
  npm: ["create", "vite@latest", ".", "--yes", "--", "--template", "react-ts", "--no-interactive"],
  pnpm: ["create", "vite", ".", "--template", "react-ts", "--no-interactive"],
  yarn: ["create", "vite", ".", "--template", "react-ts", "--no-interactive"],
  bun: ["create", "vite", ".", "--template", "react-ts", "--no-interactive"]
};

for (const packageManager of PACKAGE_MANAGERS) {
  void test(`builds the correct root scaffold and install commands for ${packageManager} (npm empirically verified via a real create-vite . run; others verified at the command-construction level, matching buildViteScaffoldCommand's own existing test coverage)`, async () => {
    const spawner = new FakeProcessSpawner();
    const writer = new InMemoryProjectFileWriter();
    const context = scaffoldContext(spawner, writer);
    const plan = buildViteReactCreatePlan(context, inputs({ packageManager }));

    spawner.queueAutoSuccess();
    spawner.queueAutoSuccess();

    const result = await executeScaffoldSteps(plan.steps, (step) => {
      if (step.id === "scaffold-vite-root") {
        writer.preExistingFile(path.join(projectRoot, "package.json"), "{}");
      }
    });

    assert.equal(result.failedStep, undefined);
    assert.equal(spawner.spawnCalls[0]?.executable, packageManager);
    assert.deepEqual(spawner.spawnCalls[0]?.args, CREATE_VITE_ARGV_SHAPE[packageManager]);
    assert.equal(spawner.spawnCalls[0]?.cwd, projectRoot);
    assert.equal(spawner.spawnCalls[1]?.executable, packageManager);
    assert.deepEqual(spawner.spawnCalls[1]?.args, ["install"]);
  });
}

void test("describes both supported templates correctly in the confirmation summary and README header note", () => {
  const jsContext = scaffoldContext(new FakeProcessSpawner(), new InMemoryProjectFileWriter());
  const jsPlan = buildViteReactCreatePlan(jsContext, inputs({ template: "react" as ViteTemplate }));
  assert.equal(jsPlan.readmeHeaderNote, "Generated with the **React + JavaScript + Vite** project type.");
  assert.deepEqual(jsPlan.confirmationSummary, ["Project type: React + Vite", "Template: React + JavaScript", "Package manager: npm"]);
});

void test("root ownership: the final README.md/.gitignore composed by the generic composer are StackPilot's own, not create-vite's defaults, and the real scaffold files remain untouched", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const context = scaffoldContext(spawner, writer);
  const plan = buildViteReactCreatePlan(context, inputs());

  spawner.queueAutoSuccess(); // scaffold-vite-root
  spawner.queueAutoSuccess(); // install-dependencies

  const steps = composeProjectSteps(spawner, writer, plan, { initializeGit: false });
  const result = await executeScaffoldSteps(steps, (step) => {
    if (step.id === "scaffold-vite-root") {
      preExistingCreateViteOutput(writer);
    }
  });

  assert.equal(result.failedStep, undefined);

  const readme = writer.files.get(path.resolve(projectRoot, "README.md"));
  assert.ok(readme?.includes("## Setup"));
  assert.ok(readme?.includes("npm install"));
  assert.ok(readme?.includes("npm run dev"));
  assert.ok(!readme?.includes("This template provides a minimal setup"));
  assert.ok(!readme?.includes("## Backend setup"));

  const gitignore = writer.files.get(path.resolve(projectRoot, ".gitignore"));
  assert.ok(gitignore?.includes("*.local"));
  assert.ok(gitignore?.includes("node_modules/"));
  assert.ok(!gitignore?.includes("# Logs"));
  assert.ok(!gitignore?.includes(".vscode/*"));

  assert.equal(writer.files.get(path.resolve(projectRoot, "package.json")), '{"name":"kunden-frontend","private":true}');
  assert.equal(writer.files.get(path.resolve(projectRoot, "vite.config.ts")), "export default {};\n");
  assert.equal(writer.files.has(path.resolve(projectRoot, "src", "App.tsx")), true);
});

void test("root createdPaths via the full composer: projectRoot appears exactly once, not duplicated by the root scaffold step", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const context = scaffoldContext(spawner, writer);
  const plan = buildViteReactCreatePlan(context, inputs());

  spawner.queueAutoSuccess();
  spawner.queueAutoSuccess();

  const steps = composeProjectSteps(spawner, writer, plan, { initializeGit: false });
  const result = await executeScaffoldSteps(steps, (step) => {
    if (step.id === "scaffold-vite-root") {
      preExistingCreateViteOutput(writer);
    }
  });

  assert.equal(result.failedStep, undefined);
  const occurrences = result.createdPaths.filter((createdPath) => createdPath === path.resolve(projectRoot));
  assert.equal(occurrences.length, 1);
});

void test("failure after a successful scaffold: createdPaths still names projectRoot exactly once, and cleanup removes the whole project without touching the parent directory", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  writer.preExistingDirectory(parentDirectory);
  writer.preExistingFile(path.join(parentDirectory, "unrelated-sibling-project", "package.json"), "{}");
  const context = scaffoldContext(spawner, writer);
  const plan = buildViteReactCreatePlan(context, inputs());

  spawner.queueAutoSuccess(); // scaffold-vite-root succeeds
  spawner.queueAutoSuccess({ code: 1, signal: null }); // install-dependencies fails

  const steps = composeProjectSteps(spawner, writer, plan, { initializeGit: false });
  const result = await executeScaffoldSteps(steps, (step) => {
    if (step.id === "scaffold-vite-root") {
      preExistingCreateViteOutput(writer);
    }
  });

  assert.equal(result.failedStep?.id, "install-dependencies");
  const occurrences = result.createdPaths.filter((createdPath) => createdPath === path.resolve(projectRoot));
  assert.equal(occurrences.length, 1);

  await cleanupCreatedPaths(writer, result.createdPaths);

  assert.equal(writer.files.has(path.resolve(projectRoot, "package.json")), false);
  assert.equal(writer.directories.has(path.resolve(projectRoot)), false);
  // The parent directory and an unrelated sibling project must survive untouched.
  assert.equal(writer.directories.has(path.resolve(parentDirectory)), true);
  assert.equal(writer.files.has(path.resolve(parentDirectory, "unrelated-sibling-project", "package.json")), true);
});

void test("collision cleanup failure through the full composer: shared project files are never written - no partial success", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new ThrowingRemoveProjectFileWriter(path.join(projectRoot, ".gitignore"));
  const context = scaffoldContext(spawner, writer);
  const plan = buildViteReactCreatePlan(context, inputs());

  spawner.queueAutoSuccess(); // scaffold-vite-root

  const steps = composeProjectSteps(spawner, writer, plan, { initializeGit: false });
  const result = await executeScaffoldSteps(steps, (step) => {
    if (step.id === "scaffold-vite-root") {
      preExistingCreateViteOutput(writer);
    }
  });

  assert.equal(result.failedStep?.id, "remove-create-vite-root-files");
  // The shared steps (docs/.vscode/README/gitignore) never ran - StackPilot's
  // own canonical README/.gitignore were never written.
  assert.equal(writer.files.has(path.resolve(projectRoot, "docs", "README.md")), false);
  assert.equal(writer.files.has(path.resolve(projectRoot, ".vscode", "settings.json")), false);
  // README.md (processed first) was already removed before .gitignore's removal
  // threw - a real, order-dependent partial state, but not a hidden one: the
  // scaffold as a whole still failed (asserted above), so the wizard's own
  // failure/cleanup path (never a silent "success") takes over from here, and
  // "Clean Up Created Files" removes the entire projectRoot regardless of
  // which of the two files individually survived.
  assert.equal(writer.files.has(path.resolve(projectRoot, "README.md")), false);
  // .gitignore's own removal is exactly what threw, so it is still create-vite's
  // original file - never silently accepted as StackPilot's canonical one.
  assert.equal(writer.files.get(path.resolve(projectRoot, ".gitignore"))?.includes("# Logs"), true);
});
