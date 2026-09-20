export type ExpressPresetId = "express-vite-react-ts" | "express-only";

export interface ExpressPreset {
  readonly id: ExpressPresetId;
  readonly label: string;
  readonly description: string;
  readonly includesFrontend: boolean;
  readonly viteTemplate?: "react-ts";
}

/**
 * Exactly the two presets EXPRESS-1D scopes (mirrors
 * fastapi/fastApiNewProjectPresets.ts's own ownership pattern) - deliberately
 * not more: no Vue/Svelte/plain-JS-React templates, no Express TypeScript
 * variant (Express itself stays JavaScript/CommonJS - see
 * docs/EXPRESS_1D_CODE_TRUTH_AND_IMPLEMENTATION_PLAN.md §6, the detector has
 * no `.ts` entry candidate at all). Express's own, private data - consumed
 * only by expressCreateInputs.ts; the wizard and the generic orchestrator
 * never read this table.
 */
export const EXPRESS_PRESETS: readonly ExpressPreset[] = [
  {
    id: "express-vite-react-ts",
    label: "Express + Vite React + TypeScript",
    description: "Recommended: Express backend with a typed React frontend.",
    includesFrontend: true,
    viteTemplate: "react-ts"
  },
  {
    id: "express-only",
    label: "Express only",
    description: "Backend only, no frontend scaffold.",
    includesFrontend: false
  }
];

export const DEFAULT_EXPRESS_PRESET_ID: ExpressPresetId = "express-vite-react-ts";

export function findExpressPreset(id: ExpressPresetId): ExpressPreset {
  const preset = EXPRESS_PRESETS.find((candidate) => candidate.id === id);
  if (preset === undefined) {
    throw new Error(`Unknown preset id: ${id}`);
  }
  return preset;
}
