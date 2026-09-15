import type * as vscode from "vscode";
import type { StackPilotConfiguration } from "../../config/configurationModel";
import type { PackageManager } from "../../detection/packageManagerDetector";
import type { FileSystemProbe } from "../../detection/fileSystem";
import type { ProcessSpawner } from "../../execution/processSpawner";
import type { ViteTemplate } from "../../execution/viteScaffoldCommand";
import type { ProjectFileWriter } from "../projectFileWriter";
import type { ScaffoldStep } from "../scaffoldStep";

/** Widens to "django" | "fastapi" | "express" | "nestjs" as those packages land - never unioned
 *  with FrameworkAdapterId (see docs/CREATE_ARCH_MODULAR_PROJECT_CREATION_PLAN.md §32.3). */
export type BackendCreateId = "django";

/** Framework-agnostic - buildViteFrontendSteps()/buildViteReadmeSection() take exactly these facts. */
export interface FrontendScaffoldRequest {
  readonly packageManager: PackageManager;
  readonly template: ViteTemplate;
  readonly frontendPort: number;
}

/**
 * Structured, backend- or frontend-supplied fragments the generic composer
 * assembles into the single shared README.md - never a finished file (see
 * plan §18 for why fragments, not finished strings, are the right shape).
 */
export interface ReadmeSection {
  readonly treeLines: readonly string[];
  readonly setupCommands: readonly string[];
  readonly defaultUrlLine: string;
}

/**
 * The generic result a BackendCreateModule hands back to the orchestrator -
 * a composition DTO, not a universal project model. Every field here is
 * universally meaningful to every backend (steps to run, content to
 * contribute, display lines to show); none is framework-specific-and-optional
 * the way a djangoPackageName?/fastApiModule? field would be.
 *
 * Deliberately carries no `initializeGit` - "should Git be initialized" has
 * no backend-specific meaning at all (Django, FastAPI, Express, and NestJS
 * would all answer the same generic prompt the same way), so it is
 * collected and threaded through entirely by the generic wizard/composer
 * (see docs/CREATE_ARCH_MODULAR_PROJECT_CREATION_PLAN.md §32.1/§18 and the
 * CREATE-ARCH-1B.1 correction) rather than being a property of the plan a
 * backend module produces.
 */
export interface BackendCreatePlan {
  readonly projectRoot: string;
  readonly steps: readonly ScaffoldStep[];
  readonly gitignoreEntries: readonly string[];
  readonly readmeHeaderNote: string;
  readonly readmeSection: ReadmeSection;
  readonly readmeNotes: readonly string[];
  readonly vscodeSettings: Readonly<Record<string, string>>;
  readonly frontend?: FrontendScaffoldRequest;
  /**
   * This backend's own already-formatted confirmation lines (e.g. Django's
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
export interface BackendCreateContext {
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
 * registry (backendCreateModules.ts) holds these directly; the orchestrator
 * calls the selected one's prepare() without ever branching on `id`.
 */
export interface BackendCreateModule {
  readonly id: BackendCreateId;
  readonly label: string;
  readonly description: string;

  /**
   * Collects this backend's own inputs (may call vscode APIs internally, via
   * this module's own presentation half) and builds this backend's own pure
   * plan. Returns undefined on cancellation (ESC at any prompt, or declining
   * the final confirmation) - the same "undefined means cancelled"
   * convention every existing wizard prompt already uses.
   */
  prepare(context: BackendCreateContext): Promise<BackendCreatePlan | undefined>;
}
