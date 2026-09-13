import type { FileSystemProbe } from "../detection/fileSystem";
import type { FrameworkAdapterId } from "./frameworkAdapterId";

/**
 * One place this framework's entry point could live, already resolved and
 * safety-checked against the workspace (see `detection/fileSystem.ts`'s
 * `checkCandidatePath`). `evidence` is a short, human-readable label for
 * diagnostics/scoring (e.g. "manage.py") - not a filename to match against;
 * how a framework decides a root qualifies is entirely up to it.
 */
export interface BackendFrameworkEntryPointCandidate {
  readonly rootPath: string;
  readonly frameworkEntryPath: string;
  readonly evidence: string;
}

export interface BackendFrameworkDetectionResult {
  readonly candidates: readonly BackendFrameworkEntryPointCandidate[];
  readonly diagnostics: readonly string[];
}

/**
 * A backend framework's own read-only detection evidence - "this framework
 * knows how to find itself in a workspace", not "this framework is a list of
 * filenames" (see docs/ARCHITECTURE.md). Deliberately separate from
 * `BackendFrameworkAdapter`: every method there is a synchronous, pure
 * descriptor builder operating on an *already-selected* project, while
 * detection is asynchronous, touches the filesystem, and runs *before* any
 * project is selected - a different responsibility with a different shape,
 * not just a missing method on the same interface.
 *
 * A framework's internal detection strategy (checking one marker file today;
 * inspecting `pyproject.toml`/`requirements.txt` contents for a dependency
 * name, or a project's script/module structure, for a framework where no
 * single marker file is reliable) is entirely its own concern - the generic
 * orchestrator (`detection/backendDetector.ts`) only ever sees the resulting
 * candidates, never how they were found.
 */
export interface BackendFrameworkDetection {
  readonly frameworkId: FrameworkAdapterId;

  detect(fs: FileSystemProbe, workspaceRootPath: string, configuredEntryPointOverride: string): Promise<BackendFrameworkDetectionResult>;
}
