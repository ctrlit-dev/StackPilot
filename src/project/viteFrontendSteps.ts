import type { FrontendScaffoldRequest, ReadmeSection } from "./create/projectCreateModule";
import type { PackageManager } from "../detection/packageManagerDetector";
import type { ProcessSpawner } from "../execution/processSpawner";
import { buildViteScaffoldCommand, type ViteTemplate } from "../execution/viteScaffoldCommand";
import type { ProjectFileWriter } from "./projectFileWriter";
import type { ScaffoldStep } from "./scaffoldStep";
import { commandStep, viteScaffoldStep } from "./scaffoldSteps";

/**
 * Extracted, behavior-preserving, from the pre-CREATE-ARCH-1B
 * newProjectScaffoldPlan.ts's inline scaffold-frontend/install-frontend-deps
 * steps - same step ids, same commandStep/viteScaffoldStep calls. Called
 * only by the generic composer (projectStepsComposition.ts), never by a
 * backend module directly - see
 * docs/CREATE_ARCH_MODULAR_PROJECT_CREATION_PLAN.md §13.2/§32.9.
 */
export interface ViteFrontendStepsOptions {
  readonly spawner: ProcessSpawner;
  readonly writer: ProjectFileWriter;
  readonly packageManager: PackageManager;
  readonly template: ViteTemplate;
  readonly projectRoot: string;
  readonly frontendRoot: string;
  readonly onOutput?: (chunk: string, stream: "stdout" | "stderr") => void;
}

export function buildViteFrontendSteps(options: ViteFrontendStepsOptions): ScaffoldStep[] {
  return [
    viteScaffoldStep(
      options.spawner,
      options.writer,
      "scaffold-frontend",
      "Scaffold Vite frontend",
      buildViteScaffoldCommand(options.packageManager, "frontend", options.template, options.projectRoot),
      options.frontendRoot,
      options.onOutput
    ),
    commandStep(
      options.spawner,
      "install-frontend-deps",
      "Install frontend dependencies",
      { executable: options.packageManager, args: ["install"], cwd: options.frontendRoot },
      undefined,
      options.onOutput
    )
  ];
}

/**
 * The frontend's own small contribution to the shared README - needed now
 * that no backend module builds a finished README itself (plan §18).
 */
export function buildViteReadmeSection(request: FrontendScaffoldRequest): ReadmeSection {
  return {
    heading: "Frontend setup",
    treeLines: ["├── frontend/", "│   ├── src/", "│   └── package.json"],
    setupCommands: [
      "cd frontend",
      `${request.packageManager} install`,
      `${request.packageManager}${request.packageManager === "npm" ? " run" : ""} dev`
    ],
    defaultUrlLine: `- Frontend: http://127.0.0.1:${request.frontendPort}/ (Vite may choose a different port if this one is busy)`
  };
}
