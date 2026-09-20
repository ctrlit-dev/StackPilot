import type { FrameworkAdapterId } from "../adapters/frameworkAdapterId";
import type { FrontendFrameworkAdapter } from "../adapters/frontendFrameworkAdapter";

/**
 * A dev server's "ready" line can arrive split across separate stdout
 * chunks at the OS pipe level, so this accumulates a small rolling buffer
 * rather than matching each chunk in isolation. Bounded to avoid unbounded
 * growth if the URL line never appears (e.g. a non-matching dev script).
 */
const MAX_BUFFER_LENGTH = 4096;

/**
 * Tracks the frontend dev server's actual bound URL from its raw process
 * output - generic state/output orchestration only (accumulate output,
 * hand it to the active framework adapter, remember the result, expose
 * reset()). It has no idea what a Vite "Local:" line or a Next.js
 * "- Local:" line looks like; that knowledge lives entirely in the
 * injected `FrontendFrameworkAdapter`s (`adapters/viteFrontendAdapter.ts`/
 * `adapters/nextFrontendAdapter.ts`).
 *
 * NEXTJS-1B: holds a small static set of adapters, not a single one bound
 * for the extension's lifetime - StackPilot's first second frontend
 * framework is what actually exercises this. `setActiveFramework()`
 * selects which one `feed()` uses, resolved from the currently detected
 * frontend service's own `frameworkId` at the same "starting" transition
 * that already calls `reset()` (see `extension.ts`). An unrecognized/no
 * frontend framework leaves no adapter active, so `feed()` can never
 * resolve a URL - the same degrade this codebase already had for any
 * non-Vite Node frontend before Next.js existed.
 *
 * NEXTJS-1B.0 empirical finding: a colliding second Next.js dev server
 * prints an *unrelated* server's own "- Local: ..." line to stderr as part
 * of its own diagnostic message, while its own real bound URL is on
 * stdout. Feeding both streams into the same buffer risks latching onto
 * the wrong server's URL - a confident, wrong answer, not an honest
 * failure. `feed()` therefore only ever considers `stdout` - this
 * invariant is framework-neutral (it applies to Vite too), not a
 * Next.js-specific special case.
 */
export class FrontendUrlTracker {
  private activeAdapter: FrontendFrameworkAdapter | undefined;
  private buffer = "";
  private url: string | undefined;

  public constructor(private readonly frontendAdapters: readonly FrontendFrameworkAdapter[]) {}

  /**
   * Selects which registered adapter's `parseDevServerUrl()` subsequent
   * `feed()` calls use. `frameworkId === undefined` (no frontend detected)
   * or an id no registered adapter recognizes both clear the active
   * adapter - `feed()` then never resolves a URL, and Open Application
   * falls back to its existing configured-port behavior.
   */
  public setActiveFramework(frameworkId: FrameworkAdapterId | undefined): void {
    this.activeAdapter = this.frontendAdapters.find((adapter) => adapter.id === frameworkId);
  }

  public feed(chunk: string, stream: "stdout" | "stderr"): void {
    if (stream !== "stdout" || this.url !== undefined || this.activeAdapter === undefined) {
      return;
    }

    this.buffer = (this.buffer + chunk).slice(-MAX_BUFFER_LENGTH);
    this.url = this.activeAdapter.parseDevServerUrl(this.buffer);
  }

  public getUrl(): string | undefined {
    return this.url;
  }

  public reset(): void {
    this.buffer = "";
    this.url = undefined;
  }
}
