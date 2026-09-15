import * as path from "node:path";
import type { ProcessSpawner } from "../../execution/processSpawner";
import { composeGitignoreContent, composeReadmeContent, composeVSCodeSettingsContent } from "../generatedFiles";
import type { ProjectFileWriter } from "../projectFileWriter";
import type { ScaffoldStep } from "../scaffoldStep";
import { createDirectoryStep } from "../scaffoldSteps";
import { buildSharedProjectSteps } from "../sharedProjectSteps";
import { buildViteFrontendSteps, buildViteReadmeSection } from "../viteFrontendSteps";
import type { BackendCreatePlan } from "./backendCreateModule";

/**
 * The one generic composition point (plan §13.5/§17). Holds no framework
 * knowledge: it only ever reads BackendCreatePlan's generic shape and calls
 * the two shared, backend-agnostic helpers - never a concrete backend
 * module. Fixed, documented step order: project-root, then the backend's
 * own steps, then an optional Vite frontend, then the shared root files
 * (git init last, inside buildSharedProjectSteps).
 *
 * `initializeGit` is supplied here, by the generic caller, rather than read
 * off `backendPlan` - it is a generic project-creation decision, not a
 * backend-specific fact (CREATE-ARCH-1B.1 correction).
 */
export interface ComposeProjectStepsOptions {
  readonly initializeGit: boolean;
  readonly onOutput?: (chunk: string, stream: "stdout" | "stderr") => void;
  readonly onGitStatus?: (status: "initialized" | "unavailable" | "failed", detail?: string) => void;
}

export function composeProjectSteps(
  spawner: ProcessSpawner,
  writer: ProjectFileWriter,
  backendPlan: BackendCreatePlan,
  options: ComposeProjectStepsOptions
): ScaffoldStep[] {
  const frontendRoot = path.join(backendPlan.projectRoot, "frontend");
  const frontendSteps =
    backendPlan.frontend === undefined
      ? []
      : buildViteFrontendSteps({
          spawner,
          writer,
          packageManager: backendPlan.frontend.packageManager,
          template: backendPlan.frontend.template,
          projectRoot: backendPlan.projectRoot,
          frontendRoot,
          onOutput: options.onOutput
        });
  const frontendReadmeSection = backendPlan.frontend === undefined ? undefined : buildViteReadmeSection(backendPlan.frontend);

  const sharedSteps = buildSharedProjectSteps({
    writer,
    spawner,
    projectRoot: backendPlan.projectRoot,
    gitignoreContent: composeGitignoreContent(backendPlan.gitignoreEntries),
    readmeContent: () =>
      composeReadmeContent({
        projectName: path.basename(backendPlan.projectRoot),
        headerNote: backendPlan.readmeHeaderNote,
        backendSection: backendPlan.readmeSection,
        backendNotes: backendPlan.readmeNotes,
        frontendSection: frontendReadmeSection
      }),
    vscodeSettingsContent: composeVSCodeSettingsContent(backendPlan.vscodeSettings),
    initializeGit: options.initializeGit,
    onGitStatus: options.onGitStatus,
    onOutput: options.onOutput
  });

  return [createDirectoryStep(writer, "project-root", "Create project folder", backendPlan.projectRoot), ...backendPlan.steps, ...frontendSteps, ...sharedSteps];
}
