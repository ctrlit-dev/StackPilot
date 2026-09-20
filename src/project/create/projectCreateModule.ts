import type * as vscode from "vscode";
import type { StackPilotConfiguration } from "../../config/configurationModel";
import type { PackageManager } from "../../detection/packageManagerDetector";
import type { FileSystemProbe } from "../../detection/fileSystem";
import type { ProcessSpawner } from "../../execution/processSpawner";
import type { ViteTemplate } from "../../execution/viteScaffoldCommand";
import type { ProjectFileWriter } from "../projectFileWriter";
import type { ScaffoldStep } from "../scaffoldStep";

/** Widens to "nestjs" as that package lands - never unioned with FrameworkAdapterId
 *  (see docs/CREATE_ARCH_MODULAR_PROJECT_CREATION_PLAN.md §32.3). */
export type ProjectCreateId = "django" | "fastapi" | "vite-react" | "express" | "nextjs";

/** Framework-agnostic - buildViteFrontendSteps()/buildViteReadmeSection() take exactly these facts. */
export interface FrontendScaffoldRequest {
  readonly packageManager: PackageManager;
  readonly template: ViteTemplate;
  readonly frontendPort: number;
}

/**
 * Structured, module-supplied fragments the generic composer assembles into
 * the single shared README.md - never a finished file (see plan §18 for why
 * fragments, not finished strings, are the right shape). `heading` is the
 * section's own `##` heading text (e.g. Django's/FastAPI's "Backend setup") -
 * composeReadmeContent() reads it rather than assuming every module
 * represents a backend (see docs/VITE_CREATE_1A1_ARCHITECTURE_REVALIDATION.md §9).
 */
export interface ReadmeSection {
  readonly heading: string;
  readonly treeLines: readonly string[];
  readonly setupCommands: readonly string[];
  readonly defaultUrlLine: string;
}

/**
 * The generic result a ProjectCreateModule hands back to the orchestrator -
 * a composition DTO, not a universal project model. Every field here is
 * universally meaningful to every module (steps to run, content to
 * contribute, display lines to show); none is framework-specific-and-optional
 * the way a djangoPackageName?/fastApiModule? field would be.
 *
 * Deliberately carries no `initializeGit` - "should Git be initialized" has
 * no module-specific meaning at all (Django, FastAPI, Express, and NestJS
 * would all answer the same generic prompt the same way), so it is
 * collected and threaded through entirely by the generic wizard/composer
 * (see docs/CREATE_ARCH_MODULAR_PROJECT_CREATION_PLAN.md §32.1/§18 and the
 * CREATE-ARCH-1B.1 correction) rather than being a property of the plan a
 * module produces.
 */
export interface ProjectCreatePlan {
  readonly projectRoot: string;
  readonly steps: readonly ScaffoldStep[];
  readonly gitignoreEntries: readonly string[];
  readonly readmeHeaderNote: string;
  readonly readmeSection: ReadmeSection;
  readonly readmeNotes: readonly string[];
  readonly vscodeSettings: Readonly<Record<string, string>>;
  /**
   * Optional, nested-only companion frontend a module may request (e.g.
   * Django's/FastAPI's own "+ Vite" presets) - buildViteFrontendSteps()
   * always scaffolds it under a `frontend/` subfolder, never at the project
   * root. A module whose entire output is itself a frontend must not use
   * this field - it builds its own scaffold steps directly in `steps`
   * instead (see docs/VITE_CREATE_1A1_ARCHITECTURE_REVALIDATION.md §7).
   */
  readonly frontend?: FrontendScaffoldRequest;
  /**
   * This module's own already-formatted confirmation lines (e.g. Django's
   * "Preset: ..."/"Python: ..."/"Virtual environment: ..." etc.) - passive
   * display fragments only, never a schema the generic wizard interprets.
   * The wizard composes the final dialog from a generic "Location" line,
   * these lines verbatim, and a generic "Git repository: ..." line - it
   * never reads into or understands any individual entry here.
   */
  readonly confirmationSummary: readonly string[];
}

/**
 * Everything prepare() needs, injected. prepare() may call vscode APIs, but
 * only through the module's own presentation half - the pure planning half
 * stays vscode-free and independently unit-testable.
 */
export interface ProjectCreateContext {
  readonly parentDirectory: string;
  readonly projectName: string;
  readonly fileSystem: FileSystemProbe;
  readonly projectFileWriter: ProjectFileWriter;
  readonly spawner: ProcessSpawner;
  readonly outputChannel: vscode.OutputChannel;
  readonly onOutput: (chunk: string, stream: "stdout" | "stderr") => void;
  readonly configuration: StackPilotConfiguration;
}

/**
 * The one behavior-carrying Create extension point (see
 * docs/CREATE_ARCH_MODULAR_PROJECT_CREATION_PLAN.md §13.1). A plain object
 * contract, not a class - satisfied by a literal like djangoCreateModule,
 * exactly like BackendStartAdapter/djangoBackendAdapter already are. The
 * registry (projectCreateModules.ts) holds these directly; the orchestrator
 * calls the selected one's prepare() without ever branching on `id`.
 *
 * Named generically (not `BackendCreateModule`) because nothing about this
 * contract is actually backend-specific - see
 * docs/VITE_CREATE_1A1_ARCHITECTURE_REVALIDATION.md §3-§6 for the full audit
 * that justified this name.
 */
export interface ProjectCreateModule {
  readonly id: ProjectCreateId;
  readonly label: string;
  readonly description: string;

  /**
   * Collects this module's own inputs (may call vscode APIs internally, via
   * this module's own presentation half) and builds this module's own pure
   * plan. Returns undefined on cancellation (ESC at any prompt, or declining
   * the final confirmation) - the same "undefined means cancelled"
   * convention every existing wizard prompt already uses.
   */
  prepare(context: ProjectCreateContext): Promise<ProjectCreatePlan | undefined>;
}
