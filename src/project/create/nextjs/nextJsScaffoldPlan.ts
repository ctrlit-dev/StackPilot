import * as path from "node:path";
import type { PackageManager } from "../../../detection/packageManagerDetector";
import { buildNextScaffoldCommand } from "../../../execution/nextScaffoldCommand";
import type { ProjectFileWriter } from "../../projectFileWriter";
import type { ScaffoldStep } from "../../scaffoldStep";
import { viteScaffoldStep } from "../../scaffoldSteps";
import type { ProjectCreateContext, ProjectCreatePlan } from "../projectCreateModule";
import type { NextJsPreset } from "./nextJsNewProjectPresets";

/**
 * Next.js's own answers, collected by nextJsCreateInputs.ts and kept
 * entirely private to this module - never exposed on ProjectCreateModule
 * or ProjectCreatePlan. Only one preset currently exists
 * (nextJsNewProjectPresets.ts), so `preset` is carried through mainly for
 * the confirmation summary/README header note, mirroring Express's own
 * shape even though (unlike Express) there is no second preset to
 * distinguish yet.
 */
export interface NextJsInputs {
  readonly preset: NextJsPreset;
  readonly packageManager: PackageManager;
}

export interface NextJsProjectPaths {
  readonly projectRoot: string;
}

/** Only the facts this module's pure planning half actually reads - mirrors django/fastapi/express/vitereact's own ScaffoldContext types. */
export type NextJsScaffoldContext = Pick<ProjectCreateContext, "parentDirectory" | "projectName" | "projectFileWriter" | "spawner" | "onOutput" | "configuration">;

/**
 * Root, project-level layout - no `frontend/` nesting and no `.frontend`
 * companion-mechanism request (see `buildNextJsCreatePlan`'s own
 * `frontend: undefined` below). `detection/frontendDetector.ts`'s own `"."`
 * candidate directory already treats the workspace root itself as a valid
 * frontend location, and NEXTJS-1B's own detection evidence
 * (`dependencies.next`) is read directly from that root's `package.json` -
 * scaffolding directly into the project root, rather than a subfolder, is
 * exactly what the existing, unmodified NEXTJS-1B detector needs to find
 * this project. This is the identical architectural role
 * `vitereact/viteReactScaffoldPlan.ts` already proves for standalone
 * React+Vite.
 */
export function resolveNextJsProjectPaths(context: NextJsScaffoldContext): NextJsProjectPaths {
  return { projectRoot: path.join(context.parentDirectory, context.projectName) };
}

/**
 * `create-next-app` writes its own README.md/.gitignore directly into the
 * scaffold target (empirically confirmed - both a named-directory run and
 * a root `.`-target run produced identical README.md/.gitignore content,
 * docs/NEXTJS_CODE_TRUTH_AND_IMPLEMENTATION_PLAN.md's own empirical
 * verification) - paths that collide exactly with the two files
 * StackPilot's own `sharedProjectSteps.ts` canonically owns and writes
 * later in the same run. Deliberately NOT included here: `next.config.ts`,
 * `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`, `src/`,
 * `public/`, `package.json`, the lockfile, or `node_modules` - none of
 * those are ever StackPilot-owned, and `AGENTS.md`/`CLAUDE.md` are
 * deliberately excluded too (their generation was observed to be
 * environment-dependent, not a stable, deterministic part of
 * create-next-app's own output - StackPilot has no opinion on them either
 * way and must not delete files it did not itself decide to own).
 *
 * Mirrors `vitereact/viteReactScaffoldPlan.ts`'s own
 * `removeCreateViteOwnedRootFilesStep` exactly in shape and behavior
 * (including its "fail the whole scaffold rather than silently accept the
 * generator's own file" semantics) - only the owned-file list differs.
 */
const CREATE_NEXT_APP_OWNED_ROOT_FILES = ["README.md", ".gitignore"] as const;

function removeCreateNextAppOwnedRootFilesStep(writer: ProjectFileWriter, projectRoot: string): ScaffoldStep {
  return {
    id: "remove-create-next-app-root-files",
    label: "Remove create-next-app's own README.md/.gitignore",
    execute: async () => {
      for (const fileName of CREATE_NEXT_APP_OWNED_ROOT_FILES) {
        const targetPath = path.join(projectRoot, fileName);
        if (!(await writer.pathExists(targetPath))) {
          continue;
        }
        try {
          await writer.removePath(targetPath);
        } catch (error: unknown) {
          return {
            succeeded: false,
            createdPaths: [],
            errorMessage: `Could not remove create-next-app's own ${fileName} before writing StackPilot's own: ${error instanceof Error ? error.message : "Unknown error"}`
          };
        }
      }
      return { succeeded: true, createdPaths: [] };
    }
  };
}

/**
 * Scaffolds Next.js directly into `projectRoot` (target "." - see
 * `buildNextScaffoldCommand`) rather than a `frontend/` subfolder.
 * Empirically confirmed (docs/NEXTJS_CODE_TRUTH_AND_IMPLEMENTATION_PLAN.md):
 * `create-next-app .` scaffolds directly into the current working
 * directory (reporting the real target path in its own output), not a
 * literal `./.` folder.
 *
 * Reuses `scaffoldSteps.ts`'s own `viteScaffoldStep()` unchanged, despite
 * its Vite-flavored name - its actual behavior (run a structured scaffold
 * command, then verify `package.json` now exists before declaring success,
 * catching a "tool reported success but wrote nothing" quirk) is already
 * fully generic, and is exactly the same defensive check this module needs
 * for `create-next-app`. Not empirically observed for create-next-app
 * itself, but costs nothing to keep and mirrors an already-proven,
 * already-tested pattern rather than inventing a second one.
 *
 * `createdPaths` is overridden to `[]` for the same reason
 * `viteReactScaffoldPlan.ts`'s own `scaffoldViteRootStep` overrides it:
 * `projectRoot` is already tracked once by the generic composer's own
 * `project-root` step (`projectStepsComposition.ts`), so reporting it a
 * second time would duplicate cleanup entries.
 */
function scaffoldNextJsRootStep(context: NextJsScaffoldContext, inputs: NextJsInputs, projectRoot: string): ScaffoldStep {
  const inner = viteScaffoldStep(
    context.spawner,
    context.projectFileWriter,
    "scaffold-nextjs-root",
    "Scaffold Next.js project",
    buildNextScaffoldCommand(inputs.packageManager, projectRoot),
    projectRoot,
    context.onOutput
  );
  return {
    id: inner.id,
    label: inner.label,
    execute: async () => {
      const result = await inner.execute();
      return { ...result, createdPaths: [] };
    }
  };
}

/** Same `<manager> [run] <script>` shape express/expressScaffoldPlan.ts's own resolveDevCommandText() already uses - duplicated locally, not imported, to keep this module free of any concrete sibling Create module dependency. */
function resolveDevCommandText(packageManager: PackageManager): string {
  return `${packageManager}${packageManager === "npm" ? " run" : ""} dev`;
}

/**
 * Next.js's pure scaffold planning - mirrors vitereact/viteReactScaffoldPlan.ts's
 * own buildViteReactCreatePlan() in shape: no nested `.frontend` request
 * (this module's entire output already is the root project), and -
 * unlike Vite React, which needs a separate `installDependenciesStep` -
 * no dependency-install step at all, because `create-next-app` itself
 * already installs dependencies as part of scaffolding (empirically
 * confirmed - docs/NEXTJS_CODE_TRUTH_AND_IMPLEMENTATION_PLAN.md), and
 * adding a second, redundant install step here would contradict that
 * ownership. No vscode import.
 */
export function buildNextJsCreatePlan(context: NextJsScaffoldContext, inputs: NextJsInputs): ProjectCreatePlan {
  const paths = resolveNextJsProjectPaths(context);

  const steps: ScaffoldStep[] = [
    scaffoldNextJsRootStep(context, inputs, paths.projectRoot),
    removeCreateNextAppOwnedRootFilesStep(context.projectFileWriter, paths.projectRoot)
  ];

  return {
    projectRoot: paths.projectRoot,
    steps,
    // ".next/" (Next.js's own build/cache output directory) and
    // "next-env.d.ts" (an auto-generated TypeScript declaration file
    // Next.js itself manages) are the two genuinely Next.js-specific
    // entries the always-present generic Node block
    // (composeGitignoreContent()'s "node_modules/"/"dist/") does not
    // already cover - matching create-next-app's own official template
    // gitignore for both.
    gitignoreEntries: ["# Next.js", ".next/", "next-env.d.ts"],
    readmeHeaderNote: `Generated with the **${inputs.preset.label}** preset.`,
    readmeSection: {
      heading: "Setup",
      treeLines: ["├── package.json", "├── next.config.ts", "├── src/", "│   └── app/"],
      setupCommands: [`${inputs.packageManager} install`, resolveDevCommandText(inputs.packageManager)],
      // Next.js's own actual default port (3000), not StackPilot's
      // Vite-flavored configured `frontendPort` default (5173) - stating
      // the configured value here would be misleading for a freshly
      // created Next.js project, since Start never forces a --port flag
      // (NEXTJS-1B) and the real dev server binds to its own default.
      defaultUrlLine: "- Frontend: http://localhost:3000/ (Next.js may choose a different port if this one is busy)"
    },
    readmeNotes: [`- Dependencies are installed automatically; re-run \`${inputs.packageManager} install\` if \`node_modules/\` is ever removed.`],
    // No Node-equivalent to Python's python.defaultInterpreterPath exists.
    vscodeSettings: {},
    // This module's entire output already is the root project - it never
    // requests the generic nested-companion mechanism the way Django's/
    // FastAPI's/Express's own "+ Vite" presets do.
    frontend: undefined,
    confirmationSummary: buildNextJsConfirmationSummary(inputs)
  };
}

function buildNextJsConfirmationSummary(inputs: NextJsInputs): readonly string[] {
  return [`Preset: ${inputs.preset.label}`, `Package manager: ${inputs.packageManager}`];
}
