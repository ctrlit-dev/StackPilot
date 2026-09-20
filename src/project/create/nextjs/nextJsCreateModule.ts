import type { ProjectCreateModule } from "../projectCreateModule";
import { buildNextJsCreatePlan } from "./nextJsScaffoldPlan";

/**
 * The one registered object for Next.js - thin, no scaffold details
 * duplicated here (they live in nextJsCreateInputs.ts/nextJsScaffoldPlan.ts).
 * Mirrors express/expressCreateModule.ts exactly, including the lazy
 * import of its presentation half for the same reason: keeps this file
 * (and therefore the registry, projectCreateModules.ts) importable by
 * plain unit tests with no vscode runtime present.
 *
 * A standalone root `ProjectCreateModule`, the same architectural role the
 * standalone React+Vite Create module already proves - not a nested
 * `.frontend` companion, not a backend creator, not a new registry
 * (docs/NEXTJS_CODE_TRUTH_AND_IMPLEMENTATION_PLAN.md §18).
 */
export const nextJsCreateModule: ProjectCreateModule = {
  id: "nextjs",
  label: "Next.js",
  description: "React framework with the App Router, server rendering, and TypeScript - scaffolded with create-next-app.",

  async prepare(context) {
    const { collectNextJsInputs } = await import("./nextJsCreateInputs.js");
    const inputs = await collectNextJsInputs();
    if (inputs === undefined) {
      return undefined;
    }

    return buildNextJsCreatePlan(context, inputs);
  }
};
