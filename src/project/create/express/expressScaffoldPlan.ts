import * as path from "node:path";
import type { PackageManager } from "../../../detection/packageManagerDetector";
import type { ScaffoldStep } from "../../scaffoldStep";
import { commandStep, writeFileStep } from "../../scaffoldSteps";
import type { ProjectCreateContext, ProjectCreatePlan } from "../projectCreateModule";
import type { ExpressPreset } from "./expressNewProjectPresets";

/**
 * Express's own answers, collected by expressCreateInputs.ts and kept
 * entirely private to Express's module - never exposed on ProjectCreateModule
 * or ProjectCreatePlan (plan §13.1). No package/module-name field exists -
 * package.json's own "name" is derived from the project name itself
 * (normalizeNpmPackageName() below), never prompted for separately, the same
 * "nothing analogous to name needs asking" reasoning FastAPI's own module
 * already established for its flat main.py layout.
 *
 * `packageManager` is unconditionally required here (unlike FastAPI's own
 * optional field, only present when its Vite preset is chosen) - Express's
 * own backend always needs one, for its own `<packageManager> install` step,
 * regardless of whether a frontend is also being scaffolded (see
 * docs/EXPRESS_1D_CODE_TRUTH_AND_IMPLEMENTATION_PLAN.md §5).
 */
export interface ExpressInputs {
  readonly preset: ExpressPreset;
  readonly packageManager: PackageManager;
}

export interface ExpressProjectPaths {
  readonly projectRoot: string;
}

/** Only the facts Express's pure planning half actually reads - mirrors django/fastapi/vitereact's own ScaffoldContext types. */
export type ExpressScaffoldContext = Pick<ProjectCreateContext, "parentDirectory" | "projectName" | "projectFileWriter" | "spawner" | "onOutput" | "configuration">;

/**
 * Flat, project-root layout - no `backend/` nesting. `expressBackendDetection.ts`
 * always resolves an Express candidate's rootPath to the workspace root
 * itself, never `dirname(entryPath)`, so `package.json`/`index.js` must both
 * live directly at the project root for the existing, unmodified detector to
 * find them (mirrors FastAPI's own root-layout reasoning exactly).
 */
export function resolveExpressProjectPaths(context: ExpressScaffoldContext): ExpressProjectPaths {
  return { projectRoot: path.join(context.parentDirectory, context.projectName) };
}

/**
 * The one genuinely new mechanism this module introduces (no equivalent
 * exists anywhere else in the codebase - Django/FastAPI have no
 * `package.json`; the existing Vite module delegates this entirely to
 * `create-vite`'s own internal sanitization, see
 * docs/VITE_CREATE_1A1_ARCHITECTURE_REVALIDATION.md §12/§21). Deliberately
 * local to Express's own module, not a shared/generic validation framework -
 * `validateFolderName()` (used for the project's actual folder name) stays
 * untouched and permissive; this only ever normalizes the separate
 * `package.json` "name" field. Never read back by
 * `expressBackendDetection.ts`/`expressBackendAdapter.ts` (neither inspects
 * this field at all) - this exists for `<packageManager> install` hygiene
 * across all four supported package managers, not for Create -> Detect ->
 * Start correctness.
 *
 * The dash-stripping pass is applied both before AND after the 214-char
 * slice: a name whose 214th character lands exactly inside what would
 * otherwise be a trailing separator run must not leave a dangling "-".
 */
export function normalizeNpmPackageName(projectName: string): string {
  const normalized = projectName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-._~]+/g, "-")
    .replace(/^[._]+/, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 214)
    .replace(/-+$/, "");

  return normalized.length > 0 ? normalized : "express-app";
}

/**
 * Minimal, real, startable Express app - no routers/middleware/demo routes
 * beyond "/". Contains the literal binding-aware evidence
 * `expressBackendDetection.ts`'s own evidence rule requires: a
 * `require("express")` binding, later called as `express()`. Reads
 * `process.env.PORT`/`process.env.HOST` (with development-only fallbacks)
 * because `expressBackendAdapter.ts` already injects both via
 * `StartProcessOptions.env` at spawn time - no `.env` file, no `dotenv`
 * dependency needed for this to work.
 */
function buildExpressIndexJsContent(): string {
  return `const express = require("express");

const app = express();

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3000);

app.get("/", (_req, res) => {
  res.send("Hello from your new StackPilot Express project");
});

app.listen(port, host, () => {
  console.log(\`Server running at http://\${host}:\${port}\`);
});
`;
}

/**
 * Structured JSON serialization (JSON.stringify), never hand-built/concatenated
 * JSON text - the same discipline `generatedFiles.ts#composeVSCodeSettingsContent`
 * already uses. `dependencies.express` here is exactly what
 * `expressBackendDetection.ts`'s own dependency-evidence check requires; both
 * `dev` and `start` point at the identical command so StackPilot's own
 * preferred script (`dev`) and a user's own `npm start` both work identically
 * - no nodemon/dev-tooling exists to differentiate them, deliberately.
 */
function buildExpressPackageJsonContent(name: string): string {
  const packageJson = {
    name,
    version: "1.0.0",
    private: true,
    scripts: {
      dev: "node index.js",
      start: "node index.js"
    },
    dependencies: {
      express: "^5.0.0"
    }
  };
  return `${JSON.stringify(packageJson, null, 2)}\n`;
}

/** Same `<manager> [run] <script>` shape viteReactScaffoldPlan.ts's own resolveDevCommandText() already uses - duplicated locally, not imported, to keep Express's own module free of any concrete Vite Create module dependency (plan §13.1/§20). */
function resolveDevCommandText(packageManager: PackageManager): string {
  return `${packageManager}${packageManager === "npm" ? " run" : ""} dev`;
}

/**
 * Express's pure scaffold planning - mirrors django/fastapi/vitereact's own
 * buildXCreatePlan() in shape, simplest in content: no Python, no venv, no
 * dependency-version capture (npm's own `^` range convention resolves and
 * locks the actual installed version into the package manager's own
 * lockfile, the inverse of FastAPI's pip-then-freeze order - package.json
 * must be written *before* `<packageManager> install` runs, since install
 * reads it). Builds only Express's own steps (write package.json, write
 * index.js, install) and its own content contributions; any Vite frontend
 * and the shared root files are composed generically from this function's
 * returned ProjectCreatePlan, exactly like FastAPI's own "+ Vite" preset. No
 * vscode import.
 */
export function buildExpressCreatePlan(context: ExpressScaffoldContext, inputs: ExpressInputs): ProjectCreatePlan {
  const paths = resolveExpressProjectPaths(context);
  const packageName = normalizeNpmPackageName(context.projectName);

  const steps: ScaffoldStep[] = [
    writeFileStep(
      context.projectFileWriter,
      "write-package-json",
      "Write package.json",
      path.join(paths.projectRoot, "package.json"),
      buildExpressPackageJsonContent(packageName)
    ),
    writeFileStep(
      context.projectFileWriter,
      "write-index-js",
      "Write index.js",
      path.join(paths.projectRoot, "index.js"),
      buildExpressIndexJsContent()
    ),
    commandStep(
      context.spawner,
      "install-dependencies",
      "Install dependencies",
      { executable: inputs.packageManager, args: ["install"], cwd: paths.projectRoot },
      undefined,
      context.onOutput
    )
  ];

  return {
    projectRoot: paths.projectRoot,
    steps,
    // No Express-specific ignore entries are needed - the generic Node block
    // composeGitignoreContent() always includes (node_modules/) already
    // covers this project, exactly like FastAPI's own "no ignore entries
    // needed" precedent for the always-present Python block.
    gitignoreEntries: [],
    readmeHeaderNote: `Generated with the **${inputs.preset.label}** preset.`,
    readmeSection: {
      heading: "Backend setup",
      treeLines: ["├── package.json", "├── index.js"],
      setupCommands: [`${inputs.packageManager} install`, resolveDevCommandText(inputs.packageManager)],
      defaultUrlLine: `- Backend: http://${context.configuration.backendHost}:${context.configuration.backendPort}/`
    },
    readmeNotes: [`- Dependencies are installed automatically; re-run \`${inputs.packageManager} install\` if \`node_modules/\` is ever removed.`],
    // No Node-equivalent to Python's python.defaultInterpreterPath exists.
    vscodeSettings: {},
    frontend:
      inputs.preset.includesFrontend && inputs.preset.viteTemplate !== undefined
        ? { packageManager: inputs.packageManager, template: inputs.preset.viteTemplate, frontendPort: context.configuration.frontendPort }
        : undefined,
    confirmationSummary: buildExpressConfirmationSummary(inputs)
  };
}

function buildExpressConfirmationSummary(inputs: ExpressInputs): readonly string[] {
  return [`Preset: ${inputs.preset.label}`, `Package manager: ${inputs.packageManager}`];
}
