import * as path from "node:path";
import type { PackageManager } from "../detection/packageManagerDetector";
import type { PythonEnvironment } from "../detection/pythonDetector";
import type { ProcessSpawner } from "../execution/processSpawner";
import { buildViteScaffoldCommand } from "../execution/viteScaffoldCommand";
import {
  buildDocsReadmeContent,
  buildGitignoreContent,
  buildReadmeContent,
  buildRequirementsTxtContent,
  buildVSCodeSettingsContent
} from "./generatedFiles";
import type { NewProjectPreset } from "./newProjectPresets";
import { parseInstalledVersion } from "./pipVersionParsing";
import type { ProjectFileWriter } from "./projectFileWriter";
import type { ScaffoldStep } from "./scaffoldStep";
import { commandCaptureStep, commandStep, createDirectoryStep, optionalGitInitStep, viteScaffoldStep, writeFileStep } from "./scaffoldSteps";

export interface NewProjectAnswers {
  readonly parentDirectory: string;
  readonly projectName: string;
  readonly preset: NewProjectPreset;
  readonly basePython: PythonEnvironment;
  readonly venvDirectoryName: string;
  readonly djangoPackageName: string;
  readonly starterAppName?: string;
  readonly packageManager?: PackageManager;
  readonly backendHost: string;
  readonly backendPort: number;
  readonly frontendPort: number;
}

export interface NewProjectPaths {
  readonly projectRoot: string;
  readonly backendRoot: string;
  readonly venvPath: string;
  readonly venvInterpreterPathWorkspaceRelative: string;
  readonly frontendRoot?: string;
}

export function resolveNewProjectPaths(answers: NewProjectAnswers): NewProjectPaths {
  const projectRoot = path.join(answers.parentDirectory, answers.projectName);
  const backendRoot = path.join(projectRoot, "backend");
  const venvPath = path.join(backendRoot, answers.venvDirectoryName);
  const venvInterpreterPathWorkspaceRelative = [
    "backend",
    answers.venvDirectoryName,
    process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? "python.exe" : "python"
  ].join("/");

  return {
    projectRoot,
    backendRoot,
    venvPath,
    venvInterpreterPathWorkspaceRelative,
    frontendRoot: answers.preset.includesFrontend ? path.join(projectRoot, "frontend") : undefined
  };
}

/**
 * Builds the full, ordered scaffold step list for the chosen answers (spec
 * §27/§28/§29/§32-§35). Pure given its dependencies (spawner, file writer)
 * are injected - the actual filesystem/process side effects only happen when
 * the returned steps are executed by executeScaffoldSteps().
 */
export interface BuildNewProjectStepsOptions {
  readonly initializeGit: boolean;
  readonly onOutput?: (chunk: string, stream: "stdout" | "stderr") => void;
  readonly onGitStatus?: (status: "initialized" | "unavailable" | "failed", detail?: string) => void;
}

export function buildNewProjectSteps(
  spawner: ProcessSpawner,
  writer: ProjectFileWriter,
  answers: NewProjectAnswers,
  options: BuildNewProjectStepsOptions = { initializeGit: false }
): ScaffoldStep[] {
  const paths = resolveNewProjectPaths(answers);
  const venvInterpreterPath = path.join(paths.venvPath, process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python");
  const installedVersions: { django?: string; drf?: string } = {};
  const steps: ScaffoldStep[] = [];

  steps.push(createDirectoryStep(writer, "project-root", "Create project folder", paths.projectRoot));
  steps.push(createDirectoryStep(writer, "backend-dir", "Create backend directory", paths.backendRoot));
  steps.push(
    commandStep(
      spawner,
      "create-venv",
      "Create virtual environment",
      { executable: answers.basePython.executablePath, args: ["-m", "venv", paths.venvPath], cwd: paths.backendRoot },
      undefined,
      options.onOutput
    )
  );
  steps.push(
    commandStep(
      spawner,
      "upgrade-pip",
      "Upgrade pip",
      { executable: venvInterpreterPath, args: ["-m", "pip", "install", "--upgrade", "pip"], cwd: paths.backendRoot },
      undefined,
      options.onOutput
    )
  );
  steps.push(
    commandStep(
      spawner,
      "install-django",
      "Install Django",
      { executable: venvInterpreterPath, args: ["-m", "pip", "install", "Django"], cwd: paths.backendRoot },
      undefined,
      options.onOutput
    )
  );
  steps.push(
    commandCaptureStep(
      spawner,
      "read-django-version",
      "Read installed Django version",
      { executable: venvInterpreterPath, args: ["-m", "pip", "show", "django"], cwd: paths.backendRoot },
      (stdout) => {
        installedVersions.django = parseInstalledVersion(stdout);
      }
    )
  );

  if (answers.preset.includesRestFramework) {
    steps.push(
      commandStep(
        spawner,
        "install-drf",
        "Install Django REST Framework",
        { executable: venvInterpreterPath, args: ["-m", "pip", "install", "djangorestframework"], cwd: paths.backendRoot },
        undefined,
        options.onOutput
      )
    );
    steps.push(
      commandCaptureStep(
        spawner,
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
      spawner,
      "django-startproject",
      "Create Django project",
      { executable: venvInterpreterPath, args: ["-m", "django", "startproject", answers.djangoPackageName, paths.backendRoot], cwd: paths.backendRoot },
      undefined,
      options.onOutput
    )
  );

  if (answers.starterAppName !== undefined) {
    steps.push(
      commandStep(
        spawner,
        "django-startapp",
        `Create starter app "${answers.starterAppName}"`,
        { executable: venvInterpreterPath, args: [path.join(paths.backendRoot, "manage.py"), "startapp", answers.starterAppName], cwd: paths.backendRoot },
        undefined,
        options.onOutput
      )
    );
  }

  steps.push(
    writeFileStep(writer, "requirements-txt", "Write requirements.txt", path.join(paths.backendRoot, "requirements.txt"), () =>
      buildRequirementsTxtContent(
        [
          installedVersions.django === undefined ? undefined : { name: "Django", version: installedVersions.django },
          installedVersions.drf === undefined ? undefined : { name: "djangorestframework", version: installedVersions.drf }
        ].filter((entry): entry is { name: string; version: string } => entry !== undefined)
      )
    )
  );

  if (answers.preset.includesFrontend && answers.packageManager !== undefined && paths.frontendRoot !== undefined && answers.preset.viteTemplate !== undefined) {
    const frontendRoot = paths.frontendRoot;
    steps.push(
      viteScaffoldStep(
        spawner,
        writer,
        "scaffold-frontend",
        "Scaffold Vite frontend",
        buildViteScaffoldCommand(answers.packageManager, "frontend", answers.preset.viteTemplate, paths.projectRoot),
        frontendRoot,
        options.onOutput
      )
    );
    steps.push(
      commandStep(
        spawner,
        "install-frontend-deps",
        "Install frontend dependencies",
        { executable: answers.packageManager, args: ["install"], cwd: frontendRoot },
        undefined,
        options.onOutput
      )
    );
  }

  steps.push(createDirectoryStep(writer, "docs-dir", "Create docs directory", path.join(paths.projectRoot, "docs")));
  steps.push(writeFileStep(writer, "docs-readme", "Write docs/README.md", path.join(paths.projectRoot, "docs", "README.md"), buildDocsReadmeContent()));

  steps.push(createDirectoryStep(writer, "vscode-dir", "Create .vscode directory", path.join(paths.projectRoot, ".vscode")));
  steps.push(
    writeFileStep(
      writer,
      "vscode-settings",
      "Write .vscode/settings.json",
      path.join(paths.projectRoot, ".vscode", "settings.json"),
      buildVSCodeSettingsContent(paths.venvInterpreterPathWorkspaceRelative)
    )
  );

  steps.push(writeFileStep(writer, "gitignore", "Write .gitignore", path.join(paths.projectRoot, ".gitignore"), buildGitignoreContent()));
  steps.push(
    writeFileStep(writer, "readme", "Write README.md", path.join(paths.projectRoot, "README.md"), () =>
      buildReadmeContent({
        projectName: answers.projectName,
        preset: answers.preset,
        venvDirectoryName: answers.venvDirectoryName,
        packageManager: answers.packageManager,
        backendHost: answers.backendHost,
        backendPort: answers.backendPort,
        frontendPort: answers.frontendPort
      })
    )
  );

  if (options.initializeGit) {
    steps.push(
      optionalGitInitStep(
        spawner,
        "git-init",
        "Initialize Git repository",
        paths.projectRoot,
        options.onGitStatus ?? (() => undefined),
        options.onOutput
      )
    );
  }

  return steps;
}
