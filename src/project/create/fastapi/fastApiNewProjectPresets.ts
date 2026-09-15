export type FastApiPresetId = "fastapi-vite-react-ts" | "fastapi-only";

export interface FastApiPreset {
  readonly id: FastApiPresetId;
  readonly label: string;
  readonly description: string;
  readonly includesFrontend: boolean;
  readonly viteTemplate?: "react-ts";
}

/**
 * Exactly the two presets FASTAPI-CREATE-1B scopes (deliberately not more -
 * no Vue/Svelte/plain-JS-React templates, no per-preset scaffold
 * implementation). FastAPI's own, private data (mirrors
 * django/djangoNewProjectPresets.ts's ownership pattern) - consumed only by
 * fastApiCreateInputs.ts; the wizard and the generic orchestrator never read
 * this table.
 */
export const FASTAPI_PRESETS: readonly FastApiPreset[] = [
  {
    id: "fastapi-vite-react-ts",
    label: "FastAPI + Vite React + TypeScript",
    description: "Recommended: FastAPI backend with a typed React frontend.",
    includesFrontend: true,
    viteTemplate: "react-ts"
  },
  {
    id: "fastapi-only",
    label: "FastAPI only",
    description: "Backend only, no frontend scaffold.",
    includesFrontend: false
  }
];

export const DEFAULT_FASTAPI_PRESET_ID: FastApiPresetId = "fastapi-vite-react-ts";

export function findFastApiPreset(id: FastApiPresetId): FastApiPreset {
  const preset = FASTAPI_PRESETS.find((candidate) => candidate.id === id);
  if (preset === undefined) {
    throw new Error(`Unknown preset id: ${id}`);
  }
  return preset;
}
