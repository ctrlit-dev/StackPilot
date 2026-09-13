export type ActivityKind = "success" | "failure" | "info";

export interface ActivityEntry {
  readonly id: number;
  readonly message: string;
  readonly timestamp: number;
  readonly kind: ActivityKind;
}

const MAX_ENTRIES = 20;

/**
 * A short, session-only feed of "what just happened" (migrations run,
 * servers started/stopped/crashed, apps created, ...) for the Dashboard's
 * Recent Activity section. Deliberately not persisted across window
 * reloads - this is a glance-back, not an audit log.
 */
export class ActivityLog {
  private entries: readonly ActivityEntry[] = [];
  private nextId = 1;
  private readonly listeners = new Set<() => void>();

  public record(message: string, kind: ActivityKind = "info"): void {
    this.entries = [{ id: this.nextId++, message, timestamp: Date.now(), kind }, ...this.entries].slice(0, MAX_ENTRIES);
    for (const listener of this.listeners) {
      listener();
    }
  }

  public getRecent(limit: number): readonly ActivityEntry[] {
    return this.entries.slice(0, limit);
  }

  public onDidChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }
}
