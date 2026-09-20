export type NextJsPresetId = "nextjs-typescript";

export interface NextJsPreset {
  readonly id: NextJsPresetId;
  readonly label: string;
  readonly description: string;
}

/**
 * Exactly the one preset NEXTJS-1D scopes (mirrors
 * express/expressNewProjectPresets.ts's own single-source-of-truth
 * pattern) - deliberately not more: no JavaScript variant, no Pages
 * Router option, no Tailwind/ESLint/src-dir/import-alias/bundler toggles
 * (docs/NEXTJS_CODE_TRUTH_AND_IMPLEMENTATION_PLAN.md §19.1 - one
 * canonical, deterministic preset, not a create-next-app options mirror).
 * Detecting an existing Pages Router (or JavaScript, or config-file-less)
 * Next.js project remains fully supported by the already-shipped
 * NEXTJS-1B detector; this module only ever creates the one App Router +
 * TypeScript preset. Next.js's own, private data - consumed only by
 * nextJsCreateInputs.ts; the wizard and the generic orchestrator never
 * read this table.
 */
export const NEXTJS_PRESETS: readonly NextJsPreset[] = [
  {
    id: "nextjs-typescript",
    label: "Next.js + TypeScript",
    description: "App Router, TypeScript, ESLint, Tailwind CSS, src/ directory."
  }
];

export const DEFAULT_NEXTJS_PRESET_ID: NextJsPresetId = "nextjs-typescript";

export function findNextJsPreset(id: NextJsPresetId): NextJsPreset {
  const preset = NEXTJS_PRESETS.find((candidate) => candidate.id === id);
  if (preset === undefined) {
    throw new Error(`Unknown preset id: ${id}`);
  }
  return preset;
}
