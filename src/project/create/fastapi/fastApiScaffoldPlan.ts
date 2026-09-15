import * as path from "node:path";
import type { PackageManager } from "../../../detection/packageManagerDetector";
import type { PythonEnvironment } from "../../../detection/pythonDetector";
import { buildRequirementsTxtContent } from "../../generatedFiles";
import { parseInstalledVersion } from "../../pipVersionParsing";
import type { ScaffoldStep } from "../../scaffoldStep";
import { commandCaptureStep, commandStep, writeFileStep } from "../../scaffoldSteps";
import type { ProjectCreateContext, ProjectCreatePlan } from "../projectCreateModule";
import type { FastApiPreset } from "./fastApiNewProjectPresets";

/**
 * FastAPI's own answers, collected by fastApiCreateInputs.ts and kept
 * entirely private to FastAPI's module - never exposed on ProjectCreateModule
 * or ProjectCreatePlan (plan §13.1). No package/module-name field exists -
 * the flat main.py layout (§9/§11 of the revalidated FastAPI plan) has
 * nothing analogous to name, unlike Django's package/starter-app inputs.
 */
export interface FastApiInputs {
  readonly preset: FastApiPreset;
  readonly basePython: PythonEnvironment;
  readonly venvDirectoryName: string;
  readonly packageManager?: PackageManager;
}

export interface FastApiProjectPaths {
  readonly projectRoot: string;
  readonly venvPath: string;
  readonly venvInterpreterPathWorkspaceRelative: string;
}

/** Only the facts FastAPI's pure planning half actually reads - mirrors django/djangoScaffoldPlan.ts's DjangoScaffoldContext. */
export type FastApiScaffoldContext = Pick<ProjectCreateContext, "parentDirectory" | "projectName" | "projectFileWriter" | "spawner" | "onOutput" | "configuration">;

/**
 * Flat, project-root layout (revalidated FastAPI plan §9/§11): no backend/
 * nesting - fastApiBackendDetection.ts always resolves a FastAPI candidate's
 * rootPath to the workspace root itself, never dirname(entryPath), so the
 * venv, main.py, and requirements.txt must all live directly at the project
 * root for the existing, unmodified detector to find them.
 */
export function resolveFastApiProjectPaths(context: FastApiScaffoldContext, inputs: FastApiInputs): FastApiProjectPaths {
  const projectRoot = path.join(context.parentDirectory, context.projectName);
  const venvPath = path.join(projectRoot, inputs.venvDirectoryName);
  const venvInterpreterPathWorkspaceRelative = [
    inputs.venvDirectoryName,
    process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? "python.exe" : "python"
  ].join("/");

  return { projectRoot, venvPath, venvInterpreterPathWorkspaceRelative };
}

/**
 * FastAPI's pure scaffold planning - mirrors django/djangoScaffoldPlan.ts's
 * buildDjangoCreatePlan() in shape, simpler in content: no backend-dir step
 * (the project root itself is where main.py/requirements.txt/the venv all
 * live; that directory is already created generically, once, by
 * projectStepsComposition.ts's composeProjectSteps()), no package/starter-app
 * steps. Builds only FastAPI's own steps (venv/pip/install/write) and its own
 * content contributions; any Vite frontend and the shared root files are
 * composed generically from this function's returned ProjectCreatePlan. No
 * vscode import.
 */
export function buildFastApiCreatePlan(context: FastApiScaffoldContext, inputs: FastApiInputs): ProjectCreatePlan {
  const paths = resolveFastApiProjectPaths(context, inputs);
  const venvInterpreterPath = path.join(paths.venvPath, process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python");
  const installedVersions: { fastapi?: string; uvicorn?: string } = {};
  const steps: ScaffoldStep[] = [];

  steps.push(
    commandStep(
      context.spawner,
      "create-venv",
      "Create virtual environment",
      { executable: inputs.basePython.executablePath, args: ["-m", "venv", paths.venvPath], cwd: paths.projectRoot },
      undefined,
      context.onOutput
    )
  );
  steps.push(
    commandStep(
      context.spawner,
      "upgrade-pip",
      "Upgrade pip",
      { executable: venvInterpreterPath, args: ["-m", "pip", "install", "--upgrade", "pip"], cwd: paths.projectRoot },
      undefined,
      context.onOutput
    )
  );
  steps.push(
    commandStep(
      context.spawner,
      "install-fastapi",
      "Install FastAPI",
      { executable: venvInterpreterPath, args: ["-m", "pip", "install", "fastapi"], cwd: paths.projectRoot },
      undefined,
      context.onOutput
    )
  );
  steps.push(
    commandCaptureStep(
      context.spawner,
      "read-fastapi-version",
      "Read installed FastAPI version",
      { executable: venvInterpreterPath, args: ["-m", "pip", "show", "fastapi"], cwd: paths.projectRoot },
      (stdout) => {
        installedVersions.fastapi = parseInstalledVersion(stdout);
      }
    )
  );
  steps.push(
    commandStep(
      context.spawner,
      "install-uvicorn",
      "Install Uvicorn",
      { executable: venvInterpreterPath, args: ["-m", "pip", "install", "uvicorn"], cwd: paths.projectRoot },
      undefined,
      context.onOutput
    )
  );
  steps.push(
    commandCaptureStep(
      context.spawner,
      "read-uvicorn-version",
      "Read installed Uvicorn version",
      { executable: venvInterpreterPath, args: ["-m", "pip", "show", "uvicorn"], cwd: paths.projectRoot },
      (stdout) => {
        installedVersions.uvicorn = parseInstalledVersion(stdout);
      }
    )
  );
  steps.push(writeFileStep(context.projectFileWriter, "write-main-py", "Write main.py", path.join(paths.projectRoot, "main.py"), buildFastApiMainPyContent()));
  steps.push(
    writeFileStep(context.projectFileWriter, "requirements-txt", "Write requirements.txt", path.join(paths.projectRoot, "requirements.txt"), () =>
      buildRequirementsTxtContent(
        [
          installedVersions.fastapi === undefined ? undefined : { name: "fastapi", version: installedVersions.fastapi },
          installedVersions.uvicorn === undefined ? undefined : { name: "uvicorn", version: installedVersions.uvicorn }
        ].filter((entry): entry is { name: string; version: string } => entry !== undefined)
      )
    )
  );

  return {
    projectRoot: paths.projectRoot,
    steps,
    // No FastAPI-specific ignore entries are needed - the generic Python/Node/Editor
    // blocks composeGitignoreContent() always includes already cover main.py's own venv.
    gitignoreEntries: [],
    readmeHeaderNote: `Generated with the **${inputs.preset.label}** preset.`,
    readmeSection: {
      heading: "Backend setup",
      treeLines: ["├── main.py", "├── requirements.txt", `├── ${inputs.venvDirectoryName}/`],
      setupCommands: [
        `${inputs.venvDirectoryName}\\Scripts\\activate   # Windows`,
        `source ${inputs.venvDirectoryName}/bin/activate  # macOS/Linux`,
        `python -m uvicorn main:app --reload --host ${context.configuration.backendHost} --port ${context.configuration.backendPort}`
      ],
      defaultUrlLine: `- Backend: http://${context.configuration.backendHost}:${context.configuration.backendPort}/`
    },
    readmeNotes: [`- The virtual environment lives at \`${inputs.venvDirectoryName}\` and is not committed to Git.`],
    vscodeSettings: { "python.defaultInterpreterPath": `\${workspaceFolder}/${paths.venvInterpreterPathWorkspaceRelative}` },
    frontend:
      inputs.preset.includesFrontend && inputs.packageManager !== undefined && inputs.preset.viteTemplate !== undefined
        ? { packageManager: inputs.packageManager, template: inputs.preset.viteTemplate, frontendPort: context.configuration.frontendPort }
        : undefined,
    confirmationSummary: buildFastApiConfirmationSummary(inputs)
  };
}

/**
 * FastAPI's own confirmation lines - no version numbers (fastapi/uvicorn's
 * installed versions are only known after pip show runs during execution,
 * after the confirmation dialog is already shown - matching Django's own
 * precedent, which shows no "Django: <version>" line either).
 */
function buildFastApiConfirmationSummary(inputs: FastApiInputs): readonly string[] {
  return [
    `Preset: ${inputs.preset.label}`,
    `Python: ${inputs.basePython.executablePath}`,
    `Virtual environment: ${inputs.venvDirectoryName}`,
    inputs.preset.includesFrontend ? `Package manager: ${inputs.packageManager}` : undefined
  ].filter((line): line is string => line !== undefined);
}

/**
 * Minimal, real, startable FastAPI app - no routers/models/settings/CORS, no
 * demo endpoints beyond "/". Contains the literal "FastAPI(" substring
 * fastApiBackendDetection.ts's own evidence rule requires.
 */
function buildFastApiMainPyContent(): string {
  return `from fastapi import FastAPI

app = FastAPI()


@app.get("/")
def root():
    return {"message": "Hello from StackPilot"}
`;
}
