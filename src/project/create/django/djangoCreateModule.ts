import type { BackendCreateModule } from "../backendCreateModule";
import { buildDjangoCreatePlan } from "./djangoScaffoldPlan";

/**
 * The one registered object for Django - thin, no scaffold details
 * duplicated here (they live in djangoCreateInputs.ts/djangoScaffoldPlan.ts).
 *
 * djangoCreateInputs.ts (the vscode-calling presentation half) is imported
 * lazily, inside prepare(), rather than at this module's top level - it is
 * the only vscode dependency Django's module has, and deferring it keeps
 * this file (and therefore the registry, backendCreateModules.ts) importable
 * by plain unit tests with no vscode runtime present, matching every other
 * file this codebase already unit-tests. Not a plugin-discovery mechanism -
 * BACKEND_CREATE_MODULES still lists this module via a plain static import.
 */
export const djangoCreateModule: BackendCreateModule = {
  id: "django",
  label: "Django",
  description: "Full-featured Python web framework with an ORM and admin site.",

  async prepare(context) {
    const { collectDjangoInputs } = await import("./djangoCreateInputs.js");
    const inputs = await collectDjangoInputs(context);
    if (inputs === undefined) {
      return undefined;
    }

    return buildDjangoCreatePlan(context, inputs);
  }
};
