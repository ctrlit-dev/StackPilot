import type { ProjectCreateModule } from "../projectCreateModule";
import { buildViteReactCreatePlan } from "./viteReactScaffoldPlan";

/**
 * The one registered object for standalone React + Vite - thin, no scaffold
 * details duplicated here (they live in viteReactCreateInputs.ts/
 * viteReactScaffoldPlan.ts). Mirrors django/djangoCreateModule.ts and
 * fastapi/fastApiCreateModule.ts exactly, including the lazy import of its
 * presentation half for the same reason: keeps this file (and therefore the
 * registry, projectCreateModules.ts) importable by plain unit tests with no
 * vscode runtime present.
 *
 * A ProjectCreateModule, not a "backend" of any kind - React + Vite is a
 * project type, the same as Django or FastAPI, not a framework layered onto
 * one. Nothing about the ProjectCreateModule/ProjectCreatePlan contract is
 * backend-specific (docs/VITE_CREATE_1A1_ARCHITECTURE_REVALIDATION.md §3-§6);
 * this module simply never populates the Python-/venv-shaped fields no
 * ProjectCreatePlan field actually requires.
 */
export const viteReactCreateModule: ProjectCreateModule = {
  id: "vite-react",
  label: "React + Vite",
  description: "Standalone React frontend, scaffolded with Vite - no backend.",

  async prepare(context) {
    const { collectViteReactInputs } = await import("./viteReactCreateInputs.js");
    const inputs = await collectViteReactInputs();
    if (inputs === undefined) {
      return undefined;
    }

    return buildViteReactCreatePlan(context, inputs);
  }
};
