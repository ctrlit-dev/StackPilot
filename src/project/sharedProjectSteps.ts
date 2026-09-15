import * as path from "node:path";
import type { ProcessSpawner } from "../execution/processSpawner";
import { buildDocsReadmeContent } from "./generatedFiles";
import type { ProjectFileWriter } from "./projectFileWriter";
import type { ScaffoldStep } from "./scaffoldStep";
import { createDirectoryStep, optionalGitInitStep, writeFileStep } from "./scaffoldSteps";

/**
 * Extracted, behavior-preserving, from the pre-CREATE-ARCH-1B
 * newProjectScaffoldPlan.ts's inline docs-dir/docs-readme/vscode-dir/
 * vscode-settings/gitignore/readme/git-init steps - same step ids, same
 * ordering. The sole writer of docs/, .vscode/, .gitignore, README.md, and
 * git init - no backend module writes any of these paths itself (plan §18).
 * Content is supplied as already-composed strings by the caller (the
 * generic composer, projectStepsComposition.ts) rather than built here.
 */
export interface SharedProjectStepsOptions {
  readonly writer: ProjectFileWriter;
  readonly spawner: ProcessSpawner;
  readonly projectRoot: string;
  readonly gitignoreContent: string;
  readonly readmeContent: () => string;
  readonly vscodeSettingsContent: string;
  readonly initializeGit: boolean;
  readonly onGitStatus?: (status: "initialized" | "unavailable" | "failed", detail?: string) => void;
  readonly onOutput?: (chunk: string, stream: "stdout" | "stderr") => void;
}

export function buildSharedProjectSteps(options: SharedProjectStepsOptions): ScaffoldStep[] {
  const steps: ScaffoldStep[] = [];

  steps.push(createDirectoryStep(options.writer, "docs-dir", "Create docs directory", path.join(options.projectRoot, "docs")));
  steps.push(writeFileStep(options.writer, "docs-readme", "Write docs/README.md", path.join(options.projectRoot, "docs", "README.md"), buildDocsReadmeContent()));

  steps.push(createDirectoryStep(options.writer, "vscode-dir", "Create .vscode directory", path.join(options.projectRoot, ".vscode")));
  steps.push(
    writeFileStep(options.writer, "vscode-settings", "Write .vscode/settings.json", path.join(options.projectRoot, ".vscode", "settings.json"), options.vscodeSettingsContent)
  );

  steps.push(writeFileStep(options.writer, "gitignore", "Write .gitignore", path.join(options.projectRoot, ".gitignore"), options.gitignoreContent));
  steps.push(writeFileStep(options.writer, "readme", "Write README.md", path.join(options.projectRoot, "README.md"), options.readmeContent));

  if (options.initializeGit) {
    steps.push(
      optionalGitInitStep(options.spawner, "git-init", "Initialize Git repository", options.projectRoot, options.onGitStatus ?? (() => undefined), options.onOutput)
    );
  }

  return steps;
}
