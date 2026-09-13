import type { DetectedProject } from "../detection/detectedProject";
import type { FileSystemProbe } from "../detection/fileSystem";
import type { DiagnosticResult } from "./diagnostic";

/**
 * Exactly the data more than one check actually reads today - `detectedProject`
 * (every check) and `fileSystem` (the two checks that probe the filesystem).
 * Nothing here is speculative: a field is added only once a real check needs
 * it. A check that needs something only it uses (the Django migrations check's
 * `MigrationStatusReader`) takes that as its own constructor parameter instead
 * of widening this shared context - see `checks/djangoMigrationsCheck.ts`.
 */
export interface DiagnosticContext {
  readonly detectedProject: DetectedProject | undefined;
  readonly fileSystem: FileSystemProbe;
}

/**
 * The smallest possible check boundary: read the current context, return
 * whatever findings apply right now. No id, no metadata, no lifecycle beyond
 * `run()` - checks are plain values wired into an explicit array at the
 * composition root (extension.ts), not discovered through a registry.
 */
export interface DiagnosticCheck {
  run(context: DiagnosticContext): Promise<readonly DiagnosticResult[]>;
}
