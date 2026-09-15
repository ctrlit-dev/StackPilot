import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import { buildViteFrontendSteps, buildViteReadmeSection } from "../../src/project/viteFrontendSteps";
import { executeScaffoldSteps } from "../../src/project/scaffoldStep";
import { FakeProcessSpawner } from "./fakes/fakeProcessSpawner";
import { InMemoryProjectFileWriter } from "./fakes/inMemoryProjectFileWriter";

const projectRoot = path.resolve("pc-test-fixtures", "new-project", "kunden-portal");
const frontendRoot = path.join(projectRoot, "frontend");

void test("buildViteFrontendSteps scaffolds via create-vite then installs dependencies", async () => {
  const spawner = new FakeProcessSpawner();
  const writer = new InMemoryProjectFileWriter();

  const steps = buildViteFrontendSteps({ spawner, writer, packageManager: "npm", template: "react-ts", projectRoot, frontendRoot });
  assert.deepEqual(steps.map((step) => step.id), ["scaffold-frontend", "install-frontend-deps"]);

  spawner.queueAutoSuccess();
  spawner.queueAutoSuccess();

  const result = await executeScaffoldSteps(steps, (step) => {
    if (step.id === "scaffold-frontend") {
      writer.preExistingFile(path.join(frontendRoot, "package.json"), "{}");
    }
  });

  assert.equal(result.failedStep, undefined);
  assert.equal(spawner.spawnCalls[0]?.executable, "npm");
  assert.deepEqual(spawner.spawnCalls[1], { executable: "npm", args: ["install"], cwd: frontendRoot, env: undefined });
  assert.deepEqual(result.createdPaths, [path.resolve(frontendRoot)]);
});

void test("buildViteReadmeSection describes the frontend tree, setup commands, and default URL", () => {
  const section = buildViteReadmeSection({ packageManager: "npm", template: "react-ts", frontendPort: 5173 });
  assert.deepEqual(section.treeLines, ["├── frontend/", "│   ├── src/", "│   └── package.json"]);
  assert.deepEqual(section.setupCommands, ["cd frontend", "npm install", "npm run dev"]);
  assert.equal(section.defaultUrlLine, "- Frontend: http://127.0.0.1:5173/ (Vite may choose a different port if this one is busy)");
});

void test("buildViteReadmeSection uses the bare script name for non-npm package managers", () => {
  const section = buildViteReadmeSection({ packageManager: "pnpm", template: "react", frontendPort: 5173 });
  assert.deepEqual(section.setupCommands, ["cd frontend", "pnpm install", "pnpm dev"]);
});
