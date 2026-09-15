import type { BackendCreateModule } from "../backendCreateModule";
import { buildFastApiCreatePlan } from "./fastApiScaffoldPlan";

/**
 * The one registered object for FastAPI - thin, no scaffold details
 * duplicated here (they live in fastApiCreateInputs.ts/fastApiScaffoldPlan.ts).
 * Mirrors django/djangoCreateModule.ts exactly, including the lazy import of
 * its presentation half for the same reason: keeps this file (and therefore
 * the registry, backendCreateModules.ts) importable by plain unit tests with
 * no vscode runtime present.
 */
export const fastApiCreateModule: BackendCreateModule = {
  id: "fastapi",
  label: "FastAPI",
  description: "Lightweight, high-performance Python web framework for building APIs.",

  async prepare(context) {
    const { collectFastApiInputs } = await import("./fastApiCreateInputs.js");
    const inputs = await collectFastApiInputs(context);
    if (inputs === undefined) {
      return undefined;
    }

    return buildFastApiCreatePlan(context, inputs);
  }
};
