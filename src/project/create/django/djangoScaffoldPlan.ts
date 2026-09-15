import * as path from "node:path";
import type { PackageManager } from "../../../detection/packageManagerDetector";
import type { PythonEnvironment } from "../../../detection/pythonDetector";
import { buildRequirementsTxtContent } from "../../generatedFiles";
import { parseInstalledVersion } from "../../pipVersionParsing";
import type { ScaffoldStep } from "../../scaffoldStep";
import { commandCaptureStep, commandStep, createDirectoryStep, writeFileStep } from "../../scaffoldSteps";
import type { ProjectCreateContext, ProjectCreatePlan } from "../projectCreateModule";
import type { NewProjectPreset } from "./djangoNewProjectPresets";

/**
 * Django's own answers, collected by djangoCreateInputs.ts and kept
 * entirely private to Django's module - never exposed on ProjectCreateModule
 * or ProjectCreatePlan (plan §13.1). Deliberately carries no `initializeGit` -
 * that is a generic project-creation decision, collected and owned by the
 * generic wizard (CREATE-ARCH-1B.1 correction), not a Django input.
 */
export interface DjangoInputs {
  readonly preset: NewProjectPreset;
  readonly basePython: PythonEnvironment;
  readonly venvDirectoryName: string;
  readonly djangoPackageName: string;
  readonly starterAppName?: string;
  readonly packageManager?: PackageManager;
}

export interface DjangoProjectPaths {
  readonly projectRoot: string;
  readonly backendRoot: string;
  readonly venvPath: string;
  readonly venvInterpreterPathWorkspaceRelative: string;
}

/** Only the facts Django's pure planning half actually reads - keeps this file's own tests free of an unused fileSystem/outputChannel fake. */
export type DjangoScaffoldContext = Pick<ProjectCreateContext, "parentDirectory" | "projectName" | "projectFileWriter" | "spawner" | "onOutput" | "configuration">;

export function resolveDjangoProjectPaths(context: DjangoScaffoldContext, inputs: DjangoInputs): DjangoProjectPaths {
  const projectRoot = path.join(context.parentDirectory, context.projectName);
  const backendRoot = path.join(projectRoot, "backend");
  const venvPath = path.join(backendRoot, inputs.venvDirectoryName);
  const venvInterpreterPathWorkspaceRelative = [
    "backend",
    inputs.venvDirectoryName,
    process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? "python.exe" : "python"
  ].join("/");

  return { projectRoot, backendRoot, venvPath, venvInterpreterPathWorkspaceRelative };
}

/**
 * Django's pure scaffold planning - moved, behavior-preserving, from the
 * pre-CREATE-ARCH-1B newProjectScaffoldPlan.ts's buildNewProjectSteps().
 * Builds only Django's own steps (venv/pip/startproject/startapp/
 * requirements) and Django's own content contributions; the project-root
 * directory, any Vite frontend, and the shared root files are no longer
 * built here - the generic composer (projectStepsComposition.ts) handles
 * those from this function's returned ProjectCreatePlan. No vscode import.
 */
export function buildDjangoCreatePlan(context: DjangoScaffoldContext, inputs: DjangoInputs): ProjectCreatePlan {
  const paths = resolveDjangoProjectPaths(context, inputs);
  const venvInterpreterPath = path.join(paths.venvPath, process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python");
  const installedVersions: { django?: string; drf?: string } = {};
  const steps: ScaffoldStep[] = [];

  steps.push(createDirectoryStep(context.projectFileWriter, "backend-dir", "Create backend directory", paths.backendRoot));
  steps.push(
    commandStep(
      context.spawner,
      "create-venv",
      "Create virtual environment",
      { executable: inputs.basePython.executablePath, args: ["-m", "venv", paths.venvPath], cwd: paths.backendRoot },
      undefined,
      context.onOutput
    )
  );
  steps.push(
    commandStep(
      context.spawner,
      "upgrade-pip",
      "Upgrade pip",
      { executable: venvInterpreterPath, args: ["-m", "pip", "install", "--upgrade", "pip"], cwd: paths.backendRoot },
      undefined,
      context.onOutput
    )
  );
  steps.push(
    commandStep(
      context.spawner,
      "install-django",
      "Install Django",
      { executable: venvInterpreterPath, args: ["-m", "pip", "install", "Django"], cwd: paths.backendRoot },
      undefined,
      context.onOutput
    )
  );
  steps.push(
    commandCaptureStep(
      context.spawner,
      "read-django-version",
      "Read installed Django version",
      { executable: venvInterpreterPath, args: ["-m", "pip", "show", "django"], cwd: paths.backendRoot },
      (stdout) => {
        installedVersions.django = parseInstalledVersion(stdout);
      }
    )
  );

  if (inputs.preset.includesRestFramework) {
    steps.push(
      commandStep(
        context.spawner,
        "install-drf",
        "Install Django REST Framework",
        { executable: venvInterpreterPath, args: ["-m", "pip", "install", "djangorestframework"], cwd: paths.backendRoot },
        undefined,
        context.onOutput
      )
    );
    steps.push(
      commandCaptureStep(
        context.spawner,
        "read-drf-version",
        "Read installed Django REST Framework version",
        { executable: venvInterpreterPath, args: ["-m", "pip", "show", "djangorestframework"], cwd: paths.backendRoot },
        (stdout) => {
          installedVersions.drf = parseInstalledVersion(stdout);
        }
      )
    );
  }

  steps.push(
    commandStep(
      context.spawner,
      "django-startproject",
      "Create Django project",
      { executable: venvInterpreterPath, args: ["-m", "django", "startproject", inputs.djangoPackageName, paths.backendRoot], cwd: paths.backendRoot },
      undefined,
      context.onOutput
    )
  );

  if (inputs.starterAppName !== undefined) {
    steps.push(
      commandStep(
        context.spawner,
        "django-startapp",
        `Create starter app "${inputs.starterAppName}"`,
        { executable: venvInterpreterPath, args: [path.join(paths.backendRoot, "manage.py"), "startapp", inputs.starterAppName], cwd: paths.backendRoot },
        undefined,
        context.onOutput
      )
    );
  }

  steps.push(
    writeFileStep(context.projectFileWriter, "requirements-txt", "Write requirements.txt", path.join(paths.backendRoot, "requirements.txt"), () =>
      buildRequirementsTxtContent(
        [
          installedVersions.django === undefined ? undefined : { name: "Django", version: installedVersions.django },
          installedVersions.drf === undefined ? undefined : { name: "djangorestframework", version: installedVersions.drf }
        ].filter((entry): entry is { name: string; version: string } => entry !== undefined)
      )
    )
  );

  return {
    projectRoot: paths.projectRoot,
    steps,
    gitignoreEntries: ["# Django", "db.sqlite3", "staticfiles/"],
    readmeHeaderNote: `Generated with the **${inputs.preset.label}** preset.`,
    readmeSection: {
      heading: "Backend setup",
      treeLines: ["├── backend/", `│   ├── ${inputs.venvDirectoryName}/`, "│   ├── manage.py", "│   └── requirements.txt"],
      setupCommands: [
        "cd backend",
        `${inputs.venvDirectoryName}\\Scripts\\activate   # Windows`,
        `source ${inputs.venvDirectoryName}/bin/activate  # macOS/Linux`,
        "python manage.py migrate",
        `python manage.py runserver ${context.configuration.backendHost}:${context.configuration.backendPort}`
      ],
      defaultUrlLine: `- Backend: http://${context.configuration.backendHost}:${context.configuration.backendPort}/`
    },
    readmeNotes: [`- The backend's virtual environment lives at \`backend/${inputs.venvDirectoryName}\` and is not committed to Git.`],
    vscodeSettings: { "python.defaultInterpreterPath": `\${workspaceFolder}/${paths.venvInterpreterPathWorkspaceRelative}` },
    frontend:
      inputs.preset.includesFrontend && inputs.packageManager !== undefined && inputs.preset.viteTemplate !== undefined
        ? { packageManager: inputs.packageManager, template: inputs.preset.viteTemplate, frontendPort: context.configuration.frontendPort }
        : undefined,
    confirmationSummary: buildDjangoConfirmationSummary(inputs)
  };
}

/**
 * Django's own confirmation lines - the exact fields the pre-CREATE-ARCH-1B.1
 * confirmSummary() showed, minus "Location" and "Git repository" (both
 * generic, now owned by the wizard). Order and conditional presence
 * (starter app / package manager) are unchanged.
 */
function buildDjangoConfirmationSummary(inputs: DjangoInputs): readonly string[] {
  return [
    `Preset: ${inputs.preset.label}`,
    `Python: ${inputs.basePython.executablePath}`,
    `Virtual environment: backend/${inputs.venvDirectoryName}`,
    `Django package: ${inputs.djangoPackageName}`,
    inputs.starterAppName === undefined ? undefined : `Starter app: ${inputs.starterAppName}`,
    inputs.preset.includesFrontend ? `Package manager: ${inputs.packageManager}` : undefined
  ].filter((line): line is string => line !== undefined);
}
