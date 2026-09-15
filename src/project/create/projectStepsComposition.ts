import * as path from "node:path";
import type { ProcessSpawner } from "../../execution/processSpawner";
import { composeGitignoreContent, composeReadmeContent, composeVSCodeSettingsContent } from "../generatedFiles";
import type { ProjectFileWriter } from "../projectFileWriter";
import type { ScaffoldStep } from "../scaffoldStep";
import { createDirectoryStep } from "../scaffoldSteps";
import { buildSharedProjectSteps } from "../sharedProjectSteps";
import { buildViteFrontendSteps, buildViteReadmeSection } from "../viteFrontendSteps";
import type { ProjectCreatePlan } from "./projectCreateModule";

/**
 * The one generic composition point (plan §13.5/§17). Holds no framework
 * knowledge: it only ever reads ProjectCreatePlan's generic shape and calls
 * the two shared, framework-agnostic helpers - never a concrete project
 * module. Fixed, documented step order: project-root, then the module's
 * own steps, then an optional Vite frontend, then the shared root files
 * (git init last, inside buildSharedProjectSteps).
 *
 * `initializeGit` is supplied here, by the generic caller, rather than read
 * off `projectPlan` - it is a generic project-creation decision, not a
 * module-specific fact (CREATE-ARCH-1B.1 correction).
 */
export interface ComposeProjectStepsOptions {
  readonly initializeGit: boolean;
  readonly onOutput?: (chunk: string, stream: "stdout" | "stderr") => void;
  readonly onGitStatus?: (status: "initialized" | "unavailable" | "failed", detail?: string) => void;
}

export function composeProjectSteps(
  spawner: ProcessSpawner,
  writer: ProjectFileWriter,
  projectPlan: ProjectCreatePlan,
  options: ComposeProjectStepsOptions
): ScaffoldStep[] {
  const frontendRoot = path.join(projectPlan.projectRoot, "frontend");
  const frontendSteps =
    projectPlan.frontend === undefined
      ? []
      : buildViteFrontendSteps({
          spawner,
          writer,
          packageManager: projectPlan.frontend.packageManager,
          template: projectPlan.frontend.template,
          projectRoot: projectPlan.projectRoot,
          frontendRoot,
          onOutput: options.onOutput
        });
  const frontendReadmeSection = projectPlan.frontend === undefined ? undefined : buildViteReadmeSection(projectPlan.frontend);

  const sharedSteps = buildSharedProjectSteps({
    writer,
    spawner,
    projectRoot: projectPlan.projectRoot,
    gitignoreContent: composeGitignoreContent(projectPlan.gitignoreEntries),
    readmeContent: () =>
      composeReadmeContent({
        projectName: path.basename(projectPlan.projectRoot),
        headerNote: projectPlan.readmeHeaderNote,
        backendSection: projectPlan.readmeSection,
        backendNotes: projectPlan.readmeNotes,
        frontendSection: frontendReadmeSection
      }),
    vscodeSettingsContent: composeVSCodeSettingsContent(projectPlan.vscodeSettings),
    initializeGit: options.initializeGit,
    onGitStatus: options.onGitStatus,
    onOutput: options.onOutput
  });

  return [createDirectoryStep(writer, "project-root", "Create project folder", projectPlan.projectRoot), ...projectPlan.steps, ...frontendSteps, ...sharedSteps];
}
