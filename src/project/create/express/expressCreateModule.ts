import type { ProjectCreateModule } from "../projectCreateModule";
import { buildExpressCreatePlan } from "./expressScaffoldPlan";

/**
 * The one registered object for Express - thin, no scaffold details
 * duplicated here (they live in expressCreateInputs.ts/expressScaffoldPlan.ts).
 * Mirrors fastapi/fastApiCreateModule.ts exactly, including the lazy import
 * of its presentation half for the same reason: keeps this file (and
 * therefore the registry, projectCreateModules.ts) importable by plain unit
 * tests with no vscode runtime present.
 */
export const expressCreateModule: ProjectCreateModule = {
  id: "express",
  label: "Express",
  description: "Minimal, unopinionated Node.js web framework for building APIs and backends.",

  async prepare(context) {
    const { collectExpressInputs } = await import("./expressCreateInputs.js");
    const inputs = await collectExpressInputs();
    if (inputs === undefined) {
      return undefined;
    }

    return buildExpressCreatePlan(context, inputs);
  }
};
