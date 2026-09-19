import * as path from "node:path";
import type { PackageManager } from "../../../detection/packageManagerDetector";
import { buildViteScaffoldCommand, type ViteTemplate } from "../../../execution/viteScaffoldCommand";
import type { ProjectFileWriter } from "../../projectFileWriter";
import type { ScaffoldStep } from "../../scaffoldStep";
import { commandStep, viteScaffoldStep } from "../../scaffoldSteps";
import type { ProjectCreateContext, ProjectCreatePlan } from "../projectCreateModule";

/**
 * React + Vite's own answers, collected by viteReactCreateInputs.ts and kept
 * entirely private to this module - never exposed on ProjectCreateModule or
 * ProjectCreatePlan (plan §13.1). Only two real decisions exist for a
 * standalone Vite scaffold - template and package manager - which does not
 * warrant a preset table the way Django's/FastAPI's multi-axis presets do
 * (docs/VITE_CREATE_CODE_TRUTH_AND_IMPLEMENTATION_PLAN.md §8).
 */
export interface ViteReactInputs {
  readonly template: ViteTemplate;
  readonly packageManager: PackageManager;
}

export interface ViteReactProjectPaths {
  readonly projectRoot: string;
}

/** Only the facts this module's pure planning half actually reads - mirrors django/fastapi's own ScaffoldContext types. */
export type ViteReactScaffoldContext = Pick<ProjectCreateContext, "parentDirectory" | "projectName" | "projectFileWriter" | "spawner" | "onOutput" | "configuration">;

/**
 * Root, project-level layout - no `frontend/` nesting. `frontendDetector.ts`
 * already checks the workspace root itself (its "." candidate directory) as
 * a valid frontend location, so scaffolding directly into the project root,
 * rather than a subfolder, is what the existing, unmodified detector needs
 * to find this project (empirically verified via a real `create-vite .` run,
 * see docs/VITE_CREATE_1A1_ARCHITECTURE_REVALIDATION.md §12).
 */
export function resolveViteReactProjectPaths(context: ViteReactScaffoldContext): ViteReactProjectPaths {
  return { projectRoot: path.join(context.parentDirectory, context.projectName) };
}

const CREATE_VITE_OWNED_ROOT_FILES = ["README.md", ".gitignore"] as const;

/**
 * `create-vite` writes its own README.md/.gitignore directly into the
 * scaffold target when run at the project root (verified empirically -
 * docs/VITE_CREATE_1A1_ARCHITECTURE_REVALIDATION.md §12) - paths that
 * collide exactly with the two files StackPilot's own sharedProjectSteps.ts
 * canonically owns and writes later in the same run. Nested Django/FastAPI+Vite
 * scaffolds never hit this: create-vite's own output there lands under
 * `frontend/`, never at the project root.
 *
 * `writeFileStep()`'s "never overwrite an existing file" behavior (a
 * deliberate, already-tested product decision - scaffoldSteps.test.ts) means
 * StackPilot's own composed README/.gitignore would otherwise be silently
 * discarded in favor of create-vite's generic template ones. This step
 * removes exactly those two known, scaffold-owned files - nothing else, and
 * only inside `projectRoot` - so the later shared steps can write
 * StackPilot's own canonical versions instead. If either removal fails, this
 * step fails, which stops the whole run (scaffoldStep.ts's
 * executeScaffoldSteps stops at the first failure): a partial removal must
 * never silently let create-vite's own files stand in for StackPilot's.
 */
function removeCreateViteOwnedRootFilesStep(writer: ProjectFileWriter, projectRoot: string): ScaffoldStep {
  return {
    id: "remove-create-vite-root-files",
    label: "Remove create-vite's own README.md/.gitignore",
    execute: async () => {
      for (const fileName of CREATE_VITE_OWNED_ROOT_FILES) {
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
            errorMessage: `Could not remove create-vite's own ${fileName} before writing StackPilot's own: ${error instanceof Error ? error.message : "Unknown error"}`
          };
        }
      }
      return { succeeded: true, createdPaths: [] };
    }
  };
}

/**
 * Scaffolds Vite directly into `projectRoot` (project name "." - see
 * buildViteScaffoldCommand()) rather than into a `frontend/` subfolder.
 * viteFrontendSteps.ts's own viteScaffoldStep() call (via
 * buildViteFrontendSteps()) is unsuitable to reuse unchanged here, because it
 * unconditionally reports its target as a newly created path; `projectRoot`
 * is already tracked by the generic composer's own `project-root` step
 * (projectStepsComposition.ts), so reporting it a second time would
 * duplicate cleanup entries (docs/VITE_CREATE_1A1_ARCHITECTURE_REVALIDATION.md
 * §11). This wraps the exact same, already-tested viteScaffoldStep()
 * (identical exit-code and package.json-existence validation - the
 * empirically-verified "exit 0 but nothing created" quirk check) and only
 * overrides its createdPaths - viteScaffoldStep() itself, and the nested
 * Django/FastAPI+Vite case that still calls it directly, are unchanged.
 */
function scaffoldViteRootStep(context: ViteReactScaffoldContext, inputs: ViteReactInputs, projectRoot: string): ScaffoldStep {
  const inner = viteScaffoldStep(
    context.spawner,
    context.projectFileWriter,
    "scaffold-vite-root",
    "Scaffold Vite + React project",
    buildViteScaffoldCommand(inputs.packageManager, ".", inputs.template, projectRoot),
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

function installDependenciesStep(context: ViteReactScaffoldContext, inputs: ViteReactInputs, projectRoot: string): ScaffoldStep {
  return commandStep(
    context.spawner,
    "install-dependencies",
    "Install dependencies",
    { executable: inputs.packageManager, args: ["install"], cwd: projectRoot },
    undefined,
    context.onOutput
  );
}

/** User-facing template label - mirrors how Django/FastAPI describe their own preset choice in the README header note and confirmation summary. */
export function describeViteTemplate(template: ViteTemplate): string {
  return template === "react-ts" ? "React + TypeScript" : "React + JavaScript";
}

/** Same `<manager> [run] <script>` shape buildViteReadmeSection() already uses for the nested-companion case (viteFrontendSteps.ts), applied to the root case's own setup commands. */
function resolveDevCommandText(packageManager: PackageManager): string {
  return `${packageManager}${packageManager === "npm" ? " run" : ""} dev`;
}

/**
 * React + Vite's pure scaffold planning - mirrors django/fastapi's own
 * buildXCreatePlan() in shape, simpler in content: no Python, no venv, no
 * dependency-version capture. `steps` builds the entire project directly at
 * `projectRoot` (no backend-dir-equivalent step; the project root itself is
 * already created generically, once, by projectStepsComposition.ts's
 * composeProjectSteps()). `frontend` is deliberately left undefined - this
 * module's entire output already is a frontend, so it does not request the
 * generic nested-companion mechanism buildViteFrontendSteps() implements for
 * Django's/FastAPI's own "+ Vite" presets (see
 * docs/VITE_CREATE_1A1_ARCHITECTURE_REVALIDATION.md §7). No vscode import.
 */
export function buildViteReactCreatePlan(context: ViteReactScaffoldContext, inputs: ViteReactInputs): ProjectCreatePlan {
  const paths = resolveViteReactProjectPaths(context);
  const templateLabel = describeViteTemplate(inputs.template);

  const steps: ScaffoldStep[] = [
    scaffoldViteRootStep(context, inputs, paths.projectRoot),
    removeCreateViteOwnedRootFilesStep(context.projectFileWriter, paths.projectRoot),
    installDependenciesStep(context, inputs, paths.projectRoot)
  ];

  return {
    projectRoot: paths.projectRoot,
    steps,
    // The one genuinely missing, genuinely necessary entry for a functional
    // Vite project: node_modules/dist/.DS_Store are already covered by
    // composeGitignoreContent()'s always-present generic blocks (unchanged
    // by this package, per VITE-CREATE-1A.1's DEFER decision); *.local
    // (Vite's own .env.local/.env.*.local convention, confirmed present in
    // create-vite's own react-ts template .gitignore) is not, and protects
    // real local secrets. Not a blind copy of create-vite's own template
    // gitignore - see docs/VITE_CREATE_1A1_ARCHITECTURE_REVALIDATION.md §12.
    gitignoreEntries: ["*.local"],
    readmeHeaderNote: `Generated with the **${templateLabel} + Vite** project type.`,
    readmeSection: {
      heading: "Setup",
      treeLines: ["├── package.json", "├── vite.config.*", "├── index.html", "├── src/"],
      setupCommands: [`${inputs.packageManager} install`, resolveDevCommandText(inputs.packageManager)],
      defaultUrlLine: `- Frontend: http://127.0.0.1:${context.configuration.frontendPort}/ (Vite may choose a different port if this one is busy)`
    },
    readmeNotes: [`- Dependencies are installed automatically; re-run \`${inputs.packageManager} install\` if \`node_modules/\` is ever removed.`],
    vscodeSettings: {},
    frontend: undefined,
    confirmationSummary: buildViteReactConfirmationSummary(inputs)
  };
}

function buildViteReactConfirmationSummary(inputs: ViteReactInputs): readonly string[] {
  return ["Project type: React + Vite", `Template: ${describeViteTemplate(inputs.template)}`, `Package manager: ${inputs.packageManager}`];
}
