import type { FileSystemProbe } from "../detection/fileSystem";
import type { FrameworkAdapterId } from "./frameworkAdapterId";

/**
 * A frontend framework's own read-only detection evidence. Structurally
 * smaller than `BackendFrameworkDetection` for a real reason (not forced
 * symmetry): frontend detection is not entry-point-gated the way Django's
 * is - any directory with a `package.json` is already a valid frontend
 * candidate (`detection/frontendDetector.ts`, generic, unchanged), and a
 * framework's own config file only *adds* confidence/evidence to a root
 * that already qualified. This method's absence must never disqualify a
 * candidate; the generic orchestrator decides what a missing result means.
 */
export interface FrontendFrameworkDetection {
  readonly frameworkId: FrameworkAdapterId;

  /**
   * Looks for this framework's own config file inside an already-confirmed
   * Node project root and returns its path if found, or `undefined`
   * otherwise. Does not itself decide whether `rootPath` is a valid
   * frontend project - that is the generic orchestrator's call, based on
   * `package.json` alone.
   */
  findFrameworkConfigPath(fs: FileSystemProbe, rootPath: string): Promise<string | undefined>;
}
