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
 * hand it to the injected framework adapter, remember the result, expose
 * reset()). It has no idea what a Vite "Local:" line looks like; that
 * knowledge lives entirely in the injected `FrontendFrameworkAdapter`
 * (`adapters/viteFrontendAdapter.ts` today) via `parseDevServerUrl()`.
 */
export class FrontendUrlTracker {
  private buffer = "";
  private url: string | undefined;

  public constructor(private readonly frontendAdapter: FrontendFrameworkAdapter) {}

  public feed(chunk: string): void {
    if (this.url !== undefined) {
      return;
    }

    this.buffer = (this.buffer + chunk).slice(-MAX_BUFFER_LENGTH);
    this.url = this.frontendAdapter.parseDevServerUrl(this.buffer);
  }

  public getUrl(): string | undefined {
    return this.url;
  }

  public reset(): void {
    this.buffer = "";
    this.url = undefined;
  }
}
