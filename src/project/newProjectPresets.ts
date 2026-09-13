export type NewProjectPresetId = "django-only" | "django-vite-react" | "django-vite-react-ts" | "django-rest-vite-react-ts";

export interface NewProjectPreset {
  readonly id: NewProjectPresetId;
  readonly label: string;
  readonly description: string;
  readonly includesFrontend: boolean;
  readonly viteTemplate?: "react" | "react-ts";
  readonly includesRestFramework: boolean;
}

/**
 * The four presets spec §26 names, deliberately not more ("Do not
 * over-engineer presets in V1"). Order matters: DEFAULT_PRESET_ID is listed
 * first since it is "the strongest default for a modern full-stack setup".
 */
export const NEW_PROJECT_PRESETS: readonly NewProjectPreset[] = [
  {
    id: "django-vite-react-ts",
    label: "Django + Vite React + TypeScript",
    description: "Recommended: full-stack with a typed React frontend.",
    includesFrontend: true,
    viteTemplate: "react-ts",
    includesRestFramework: false
  },
  {
    id: "django-vite-react",
    label: "Django + Vite React",
    description: "Full-stack with a plain JavaScript React frontend.",
    includesFrontend: true,
    viteTemplate: "react",
    includesRestFramework: false
  },
  {
    id: "django-rest-vite-react-ts",
    label: "Django REST API + Vite React + TypeScript",
    description: "Full-stack with Django REST Framework installed on the backend.",
    includesFrontend: true,
    viteTemplate: "react-ts",
    includesRestFramework: true
  },
  {
    id: "django-only",
    label: "Django only",
    description: "Backend only, no frontend scaffold.",
    includesFrontend: false,
    includesRestFramework: false
  }
];

export const DEFAULT_PRESET_ID: NewProjectPresetId = "django-vite-react-ts";

export function findPreset(id: NewProjectPresetId): NewProjectPreset {
  const preset = NEW_PROJECT_PRESETS.find((candidate) => candidate.id === id);
  if (preset === undefined) {
    throw new Error(`Unknown preset id: ${id}`);
  }
  return preset;
}
