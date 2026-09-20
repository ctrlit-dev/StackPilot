import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import { DEFAULT_CONFIGURATION } from "../../src/config/configurationModel";
import type { PackageManager } from "../../src/detection/packageManagerDetector";
import { composeProjectSteps } from "../../src/project/create/projectStepsComposition";
import {
  buildNextJsCreatePlan,
  resolveNextJsProjectPaths,
  type NextJsInputs,
  type NextJsScaffoldContext
} from "../../src/project/create/nextjs/nextJsScaffoldPlan";
import { findNextJsPreset } from "../../src/project/create/nextjs/nextJsNewProjectPresets";
import { cleanupCreatedPaths } from "../../src/project/projectCollision";
import { executeScaffoldSteps } from "../../src/project/scaffoldStep";
import { FakeProcessSpawner } from "./fakes/fakeProcessSpawner";
import { InMemoryProjectFileWriter } from "./fakes/inMemoryProjectFileWriter";

const parentDirectory = path.resolve("pc-test-fixtures", "new-project");
const projectName = "my-app";
const projectRoot = path.join(parentDirectory, projectName);

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

function inputs(overrides: Partial<NextJsInputs> = {}): NextJsInputs {
  return { preset: findNextJsPreset("nextjs-typescript"), packageManager: "npm", ...overrides };
}

/** Mirrors real create-next-app output, empirically captured against 16.3.5 (docs/NEXTJS_CODE_TRUTH_AND_IMPLEMENTATION_PLAN.md's own empirical verification), including dependencies already installed. */
function preExistingCreateNextAppOutput(writer: InMemoryProjectFileWriter): void {
  writer.preExistingFile(
    path.join(projectRoot, "package.json"),
    JSON.stringify({
      name: projectName,
      version: "0.1.0",
      private: true,
      scripts: { dev: "next dev", build: "next build", start: "next start", lint: "eslint" },
      dependencies: { next: "16.3.5", react: "19.2.8", "react-dom": "19.2.8" },
      devDependencies: { typescript: "^5", eslint: "^9", tailwindcss: "^4" }
    })
  );
  writer.preExistingFile(path.join(projectRoot, "next.config.ts"), "import type { NextConfig } from \"next\";\n\nconst nextConfig: NextConfig = {};\n\nexport default nextConfig;\n");
  writer.preExistingFile(path.join(projectRoot, "tsconfig.json"), "{}");
  writer.preExistingFile(path.join(projectRoot, "eslint.config.mjs"), "export default [];\n");
  writer.preExistingFile(path.join(projectRoot, "postcss.config.mjs"), "export default {};\n");
  writer.preExistingFile(path.join(projectRoot, "src", "app", "layout.tsx"), "export default function RootLayout() {}\n");
  writer.preExistingFile(path.join(projectRoot, "src", "app", "page.tsx"), "export default function Page() {}\n");
  writer.preExistingFile(path.join(projectRoot, "src", "app", "globals.css"), "");
  writer.preExistingDirectory(path.join(projectRoot, "public"));
  writer.preExistingFile(path.join(projectRoot, "README.md"), "This is a [Next.js](https://nextjs.org) project bootstrapped with `create-next-app`.\n");
  writer.preExistingFile(
    path.join(projectRoot, ".gitignore"),
    "# See https://help.github.com/articles/ignoring-files/ for more about ignoring files.\n\n# dependencies\n/node_modules\n\n# next.js\n/.next/\n/out/\n"
  );
  writer.preExistingFile(path.join(projectRoot, "package-lock.json"), "{}");
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

void test("resolveNextJsProjectPaths lays out the project flat at the project root", () => {
  const context = scaffoldContext(new FakeProcessSpawner(), new InMemoryProjectFileWriter());
  const paths = resolveNextJsProjectPaths(context);
  assert.equal(paths.projectRoot, projectRoot);
});

void test("step ordering: scaffold, then remove create-next-app's own root files - no separate install step", () => {
  const context = scaffoldContext(new FakeProcessSpawner(), new InMemoryProjectFileWriter());
  const plan = buildNextJsCreatePlan(context, inputs());
  assert.deepEqual(
    plan.steps.map((step) => step.id),
    ["scaffold-nextjs-root", "remove-create-next-app-root-files"]
  );
});

void test("no second dependency-install step is added - create-next-app already installs dependencies itself", () => {
  const context = scaffoldContext(new FakeProcessSpawner(), new InMemoryProjectFileWriter());
  const plan = buildNextJsCreatePlan(context, inputs());
  assert.ok(!plan.steps.some((step) => step.id.includes("install")));
});

void test("a full run completes every step and returns a matching plan", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const context = scaffoldContext(spawner, writer);
  const plan = buildNextJsCreatePlan(context, inputs());

  spawner.queueAutoSuccess(); // scaffold-nextjs-root

  const result = await executeScaffoldSteps(plan.steps, (step) => {
    if (step.id === "scaffold-nextjs-root") {
      preExistingCreateNextAppOutput(writer);
    }
  });

  assert.equal(result.failedStep, undefined);
  assert.equal(plan.projectRoot, projectRoot);
  assert.deepEqual(plan.gitignoreEntries, ["# Next.js", ".next/", "next-env.d.ts"]);
  assert.equal(plan.readmeHeaderNote, "Generated with the **Next.js + TypeScript** preset.");
  assert.equal(plan.readmeSection.heading, "Setup");
  assert.deepEqual(plan.readmeSection.treeLines, ["├── package.json", "├── next.config.ts", "├── src/", "│   └── app/"]);
  assert.deepEqual(plan.readmeSection.setupCommands, ["npm install", "npm run dev"]);
  assert.equal(plan.readmeSection.defaultUrlLine, "- Frontend: http://localhost:3000/ (Next.js may choose a different port if this one is busy)");
  assert.deepEqual(plan.vscodeSettings, {});
  assert.equal(plan.frontend, undefined);
  assert.deepEqual(plan.confirmationSummary, ["Preset: Next.js + TypeScript", "Package manager: npm"]);

  // The create-next-app invocation itself.
  assert.equal(spawner.spawnCalls[0]?.executable, "npx");
  assert.deepEqual(spawner.spawnCalls[0]?.args, [
    "--yes",
    "create-next-app@latest",
    ".",
    "--ts",
    "--tailwind",
    "--eslint",
    "--app",
    "--src-dir",
    "--import-alias",
    "@/*",
    "--disable-git",
    "--use-npm",
    "--yes"
  ]);
  assert.equal(spawner.spawnCalls[0]?.cwd, projectRoot);

  // No second spawn call for a redundant install.
  assert.equal(spawner.spawnCalls.length, 1);
});

void test("root createdPaths: the scaffold step reports no createdPaths of its own - projectRoot is already tracked by the generic project-root step", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const context = scaffoldContext(spawner, writer);
  const plan = buildNextJsCreatePlan(context, inputs());

  spawner.queueAutoSuccess();

  const result = await executeScaffoldSteps(plan.steps, (step) => {
    if (step.id === "scaffold-nextjs-root") {
      preExistingCreateNextAppOutput(writer);
    }
  });

  assert.equal(result.failedStep, undefined);
  assert.deepEqual(result.createdPaths, []);
});

void test("scaffold fails when create-next-app reports exit 0 but package.json was never created", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const context = scaffoldContext(spawner, writer);
  const plan = buildNextJsCreatePlan(context, inputs());

  spawner.queueAutoSuccess(); // scaffold-nextjs-root reports success, but no files are written

  const result = await executeScaffoldSteps(plan.steps);

  assert.equal(result.failedStep?.id, "scaffold-nextjs-root");
  assert.match(result.failedStep?.errorMessage ?? "", /did not create a package\.json/);
});

void test("scaffold fails on a non-zero exit code", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const context = scaffoldContext(spawner, writer);
  const plan = buildNextJsCreatePlan(context, inputs());

  spawner.queueAutoSuccess({ code: 1, signal: null });

  const result = await executeScaffoldSteps(plan.steps);

  assert.equal(result.failedStep?.id, "scaffold-nextjs-root");
});

void test("collision cleanup removes exactly create-next-app's own README.md/.gitignore, and only those two files, from within projectRoot", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const context = scaffoldContext(spawner, writer);
  const plan = buildNextJsCreatePlan(context, inputs());

  spawner.queueAutoSuccess();

  await executeScaffoldSteps(plan.steps, (step) => {
    if (step.id === "scaffold-nextjs-root") {
      preExistingCreateNextAppOutput(writer);
    }
  });

  assert.deepEqual(writer.removedPaths.sort(), [path.resolve(projectRoot, ".gitignore"), path.resolve(projectRoot, "README.md")].sort());
  // No destructive cleanup beyond the two confirmed shared-owned files.
  assert.equal(writer.files.has(path.resolve(projectRoot, "package.json")), true);
  assert.equal(writer.files.has(path.resolve(projectRoot, "next.config.ts")), true);
  assert.equal(writer.files.has(path.resolve(projectRoot, "tsconfig.json")), true);
  assert.equal(writer.files.has(path.resolve(projectRoot, "eslint.config.mjs")), true);
  assert.equal(writer.files.has(path.resolve(projectRoot, "postcss.config.mjs")), true);
  assert.equal(writer.files.has(path.resolve(projectRoot, "src", "app", "layout.tsx")), true);
  assert.equal(writer.files.has(path.resolve(projectRoot, "src", "app", "page.tsx")), true);
  assert.equal(writer.directories.has(path.resolve(projectRoot, "public")), true);
  assert.equal(writer.files.has(path.resolve(projectRoot, "package-lock.json")), true);
});

void test("collision cleanup is a no-op, not a failure, when create-next-app did not produce a README.md/.gitignore", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const context = scaffoldContext(spawner, writer);
  const plan = buildNextJsCreatePlan(context, inputs());

  spawner.queueAutoSuccess();

  const result = await executeScaffoldSteps(plan.steps, (step) => {
    if (step.id === "scaffold-nextjs-root") {
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
  const plan = buildNextJsCreatePlan(context, inputs());

  spawner.queueAutoSuccess();

  const result = await executeScaffoldSteps(plan.steps, (step) => {
    if (step.id === "scaffold-nextjs-root") {
      preExistingCreateNextAppOutput(writer);
    }
  });

  assert.equal(result.failedStep?.id, "remove-create-next-app-root-files");
  assert.match(result.failedStep?.errorMessage ?? "", /Could not remove create-next-app's own README\.md/);
});

const PACKAGE_MANAGERS: readonly PackageManager[] = ["npm", "pnpm", "yarn", "bun"];
const CREATE_NEXT_APP_ARGV_SHAPE: Readonly<Record<PackageManager, readonly string[]>> = {
  npm: ["--yes", "create-next-app@latest", ".", "--ts", "--tailwind", "--eslint", "--app", "--src-dir", "--import-alias", "@/*", "--disable-git", "--use-npm", "--yes"],
  pnpm: ["create", "next-app", ".", "--ts", "--tailwind", "--eslint", "--app", "--src-dir", "--import-alias", "@/*", "--disable-git", "--use-pnpm", "--yes"],
  yarn: ["create", "next-app", ".", "--ts", "--tailwind", "--eslint", "--app", "--src-dir", "--import-alias", "@/*", "--disable-git", "--use-yarn", "--yes"],
  bun: ["create", "next-app", ".", "--ts", "--tailwind", "--eslint", "--app", "--src-dir", "--import-alias", "@/*", "--disable-git", "--use-bun", "--yes"]
};
const EXECUTABLE_BY_MANAGER: Readonly<Record<PackageManager, string>> = { npm: "npx", pnpm: "pnpm", yarn: "yarn", bun: "bun" };

for (const packageManager of PACKAGE_MANAGERS) {
  void test(`builds the correct root scaffold command for ${packageManager}, with no second install step (npm empirically verified; others verified at the command-construction level)`, async () => {
    const spawner = new FakeProcessSpawner();
    const writer = new InMemoryProjectFileWriter();
    const context = scaffoldContext(spawner, writer);
    const plan = buildNextJsCreatePlan(context, inputs({ packageManager }));

    spawner.queueAutoSuccess();

    const result = await executeScaffoldSteps(plan.steps, (step) => {
      if (step.id === "scaffold-nextjs-root") {
        writer.preExistingFile(path.join(projectRoot, "package.json"), "{}");
      }
    });

    assert.equal(result.failedStep, undefined);
    assert.equal(spawner.spawnCalls[0]?.executable, EXECUTABLE_BY_MANAGER[packageManager]);
    assert.deepEqual(spawner.spawnCalls[0]?.args, CREATE_NEXT_APP_ARGV_SHAPE[packageManager]);
    assert.equal(spawner.spawnCalls[0]?.cwd, projectRoot);
    assert.equal(spawner.spawnCalls.length, 1);
  });
}

void test("root ownership: the final README.md/.gitignore composed by the generic composer are StackPilot's own, not create-next-app's defaults, and the real scaffold files remain untouched", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const context = scaffoldContext(spawner, writer);
  const plan = buildNextJsCreatePlan(context, inputs());

  spawner.queueAutoSuccess();

  const steps = composeProjectSteps(spawner, writer, plan, { initializeGit: false });
  const result = await executeScaffoldSteps(steps, (step) => {
    if (step.id === "scaffold-nextjs-root") {
      preExistingCreateNextAppOutput(writer);
    }
  });

  assert.equal(result.failedStep, undefined);

  const readme = writer.files.get(path.resolve(projectRoot, "README.md"));
  assert.ok(readme?.includes("## Setup"));
  assert.ok(readme?.includes("npm install"));
  assert.ok(readme?.includes("npm run dev"));
  assert.ok(!readme?.includes("bootstrapped with `create-next-app`"));

  const gitignore = writer.files.get(path.resolve(projectRoot, ".gitignore"));
  assert.ok(gitignore?.includes(".next/"));
  assert.ok(gitignore?.includes("next-env.d.ts"));
  assert.ok(gitignore?.includes("node_modules/"));
  assert.ok(!gitignore?.includes("help.github.com"));

  assert.equal(writer.files.get(path.resolve(projectRoot, "package.json"))?.includes("\"next\""), true);
  assert.equal(writer.files.has(path.resolve(projectRoot, "next.config.ts")), true);
  assert.equal(writer.files.has(path.resolve(projectRoot, "src", "app", "page.tsx")), true);
});

void test("root createdPaths via the full composer: projectRoot appears exactly once, not duplicated by the root scaffold step", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const context = scaffoldContext(spawner, writer);
  const plan = buildNextJsCreatePlan(context, inputs());

  spawner.queueAutoSuccess();

  const steps = composeProjectSteps(spawner, writer, plan, { initializeGit: false });
  const result = await executeScaffoldSteps(steps, (step) => {
    if (step.id === "scaffold-nextjs-root") {
      preExistingCreateNextAppOutput(writer);
    }
  });

  assert.equal(result.failedStep, undefined);
  const occurrences = result.createdPaths.filter((createdPath) => createdPath === path.resolve(projectRoot));
  assert.equal(occurrences.length, 1);
});

void test("failure after a successful scaffold: createdPaths still names projectRoot exactly once, and cleanup removes the whole project without touching the parent directory", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new ThrowingRemoveProjectFileWriter(path.join(projectRoot, ".gitignore"));
  writer.preExistingDirectory(parentDirectory);
  writer.preExistingFile(path.join(parentDirectory, "unrelated-sibling-project", "package.json"), "{}");
  const context = scaffoldContext(spawner, writer);
  const plan = buildNextJsCreatePlan(context, inputs());

  spawner.queueAutoSuccess(); // scaffold-nextjs-root succeeds; the later collision-cleanup step then fails

  const steps = composeProjectSteps(spawner, writer, plan, { initializeGit: false });
  const result = await executeScaffoldSteps(steps, (step) => {
    if (step.id === "scaffold-nextjs-root") {
      preExistingCreateNextAppOutput(writer);
    }
  });

  assert.equal(result.failedStep?.id, "remove-create-next-app-root-files");
  const occurrences = result.createdPaths.filter((createdPath) => createdPath === path.resolve(projectRoot));
  assert.equal(occurrences.length, 1);

  await cleanupCreatedPaths(writer, result.createdPaths);

  assert.equal(writer.directories.has(path.resolve(projectRoot)), false);
  // The parent directory and an unrelated sibling project must survive untouched.
  assert.equal(writer.directories.has(path.resolve(parentDirectory)), true);
  assert.equal(writer.files.has(path.resolve(parentDirectory, "unrelated-sibling-project", "package.json")), true);
});

void test("collision cleanup failure through the full composer: shared project files are never written - no partial success", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new ThrowingRemoveProjectFileWriter(path.join(projectRoot, ".gitignore"));
  const context = scaffoldContext(spawner, writer);
  const plan = buildNextJsCreatePlan(context, inputs());

  spawner.queueAutoSuccess();

  const steps = composeProjectSteps(spawner, writer, plan, { initializeGit: false });
  const result = await executeScaffoldSteps(steps, (step) => {
    if (step.id === "scaffold-nextjs-root") {
      preExistingCreateNextAppOutput(writer);
    }
  });

  assert.equal(result.failedStep?.id, "remove-create-next-app-root-files");
  assert.equal(writer.files.has(path.resolve(projectRoot, "docs", "README.md")), false);
  assert.equal(writer.files.has(path.resolve(projectRoot, ".vscode", "settings.json")), false);
});

void test("generic Git-init step ownership: create-next-app's --disable-git means StackPilot's own optional git-init step is the only thing that can initialize Git", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const context = scaffoldContext(spawner, writer);
  const plan = buildNextJsCreatePlan(context, inputs());

  spawner.queueAutoSuccess(); // scaffold-nextjs-root
  spawner.queueAutoSuccess(); // git-init

  const steps = composeProjectSteps(spawner, writer, plan, { initializeGit: true });
  const result = await executeScaffoldSteps(steps, (step) => {
    if (step.id === "scaffold-nextjs-root") {
      preExistingCreateNextAppOutput(writer);
    }
  });

  assert.equal(result.failedStep, undefined);
  // Exactly one spawn beyond the scaffold itself: the generic git-init step.
  assert.equal(spawner.spawnCalls.length, 2);
  assert.equal(spawner.spawnCalls[1]?.executable, "git");
  assert.deepEqual(spawner.spawnCalls[1]?.args, ["init"]);
});

void test("Git option OFF: no git-init step runs, and create-next-app itself was already told not to initialize Git", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  const context = scaffoldContext(spawner, writer);
  const plan = buildNextJsCreatePlan(context, inputs());

  spawner.queueAutoSuccess(); // scaffold-nextjs-root only

  const steps = composeProjectSteps(spawner, writer, plan, { initializeGit: false });
  const result = await executeScaffoldSteps(steps, (step) => {
    if (step.id === "scaffold-nextjs-root") {
      preExistingCreateNextAppOutput(writer);
    }
  });

  assert.equal(result.failedStep, undefined);
  assert.equal(spawner.spawnCalls.length, 1);
  assert.ok(spawner.spawnCalls[0]?.args.includes("--disable-git"));
});
