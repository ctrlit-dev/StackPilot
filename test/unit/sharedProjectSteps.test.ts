import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import { buildSharedProjectSteps } from "../../src/project/sharedProjectSteps";
import { executeScaffoldSteps } from "../../src/project/scaffoldStep";
import { FakeProcessSpawner } from "./fakes/fakeProcessSpawner";
import { InMemoryProjectFileWriter } from "./fakes/inMemoryProjectFileWriter";

const projectRoot = path.resolve("pc-test-fixtures", "new-project", "kunden-portal");

void test("writes docs, .vscode, .gitignore, README, and initializes git, in order", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  let gitStatus: string | undefined;

  const steps = buildSharedProjectSteps({
    writer,
    spawner,
    projectRoot,
    gitignoreContent: "# gitignore\n",
    readmeContent: () => "# readme\n",
    vscodeSettingsContent: "{}\n",
    initializeGit: true,
    onGitStatus: (status) => {
      gitStatus = status;
    }
  });

  assert.deepEqual(steps.map((step) => step.id), ["docs-dir", "docs-readme", "vscode-dir", "vscode-settings", "gitignore", "readme", "git-init"]);

  spawner.queueAutoSuccess(); // git init
  const result = await executeScaffoldSteps(steps);

  assert.equal(result.failedStep, undefined);
  assert.equal(gitStatus, "initialized");
  assert.equal(writer.files.get(path.resolve(path.join(projectRoot, ".gitignore"))), "# gitignore\n");
  assert.equal(writer.files.get(path.resolve(path.join(projectRoot, "README.md"))), "# readme\n");
  assert.ok(writer.files.has(path.resolve(path.join(projectRoot, "docs", "README.md"))));
  assert.ok(writer.files.has(path.resolve(path.join(projectRoot, ".vscode", "settings.json"))));
});

void test("omits git-init entirely when git was not requested", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();

  const steps = buildSharedProjectSteps({
    writer,
    spawner,
    projectRoot,
    gitignoreContent: "# gitignore\n",
    readmeContent: () => "# readme\n",
    vscodeSettingsContent: "{}\n",
    initializeGit: false
  });

  assert.ok(!steps.some((step) => step.id === "git-init"));
  const result = await executeScaffoldSteps(steps);
  assert.equal(result.failedStep, undefined);
  assert.equal(spawner.spawnCalls.length, 0);
});

void test("a Git-unavailable environment does not fail the overall scaffold (spec §32)", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();
  let gitStatus: string | undefined;

  const steps = buildSharedProjectSteps({
    writer,
    spawner,
    projectRoot,
    gitignoreContent: "# gitignore\n",
    readmeContent: () => "# readme\n",
    vscodeSettingsContent: "{}\n",
    initializeGit: true,
    onGitStatus: (status) => {
      gitStatus = status;
    }
  });

  spawner.queueFailure(new Error("spawn git ENOENT"));
  const result = await executeScaffoldSteps(steps);

  assert.equal(result.failedStep, undefined, "a missing git must not fail the whole scaffold");
  assert.equal(gitStatus, "unavailable");
});
