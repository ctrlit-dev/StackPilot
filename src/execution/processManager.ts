import type { ProcessExitInfo, ProcessSpawner, SpawnedProcess } from "./processSpawner";

export type ManagedProcessKind = "backend" | "frontend";
export type ManagedProcessState = "stopped" | "starting" | "running" | "stopping" | "failed" | "unknown";

export interface ManagedProcessDescriptor {
  readonly kind: ManagedProcessKind;
  readonly state: ManagedProcessState;
  readonly executable?: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly startedAt?: number;
  readonly expectedPort?: number;
  readonly pid?: number;
  readonly lastError?: string;
}

export interface StartProcessOptions {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly expectedPort?: number;
  readonly env?: Readonly<Record<string, string>>;
}

export type StartProcessResult =
  | { readonly outcome: "started"; readonly descriptor: ManagedProcessDescriptor }
  | { readonly outcome: "already-running"; readonly descriptor: ManagedProcessDescriptor }
  | { readonly outcome: "busy"; readonly descriptor: ManagedProcessDescriptor }
  | { readonly outcome: "spawn-failed"; readonly reason: string };

export type StopProcessResult =
  | { readonly outcome: "stopped" }
  | { readonly outcome: "already-stopped" };

export type ProcessStateListener = (descriptor: ManagedProcessDescriptor) => void;
export type ProcessOutputListener = (kind: ManagedProcessKind, chunk: string, stream: "stdout" | "stderr") => void;

export interface Disposable {
  dispose(): void;
}

const KINDS: readonly ManagedProcessKind[] = ["backend", "frontend"];

/**
 * Centralizes lifecycle state for the backend and frontend dev servers
 * (spec §12: "Centralize lifecycle management. Do not scatter process state
 * through UI code."). Pure engine with no VS Code dependency - the process
 * spawner is injected so this class is unit-testable with a fake (spec §56).
 *
 * Race-safety notes:
 * - start() checks and transitions state synchronously before its first
 *   `await`. Because JavaScript runs synchronous code to completion between
 *   await points, two back-to-back start() calls for the same kind cannot
 *   both observe "not yet starting" - the second always sees the state the
 *   first already wrote, so no explicit lock is needed to block duplicate
 *   starts (spec §41).
 * - stop() called while a start is still in flight (state "starting") cannot
 *   kill a process handle that does not exist yet. It instead records a
 *   pending-stop request that is honored the instant the spawn resolves,
 *   rather than silently reporting "already-stopped" while a start is
 *   actually in progress (spec §41 explicitly calls out this race).
 */
export class ProcessManager {
  private readonly descriptors = new Map<ManagedProcessKind, ManagedProcessDescriptor>();
  private readonly handles = new Map<ManagedProcessKind, SpawnedProcess>();
  private readonly pendingStop = new Set<ManagedProcessKind>();
  private readonly listeners = new Set<ProcessStateListener>();
  private readonly outputListeners = new Set<ProcessOutputListener>();

  public constructor(private readonly spawner: ProcessSpawner) {
    for (const kind of KINDS) {
      this.descriptors.set(kind, { kind, state: "stopped" });
    }
  }

  public getState(kind: ManagedProcessKind): ManagedProcessDescriptor {
    return this.descriptors.get(kind) ?? { kind, state: "stopped" };
  }

  public onDidChangeState(listener: ProcessStateListener): Disposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  public onDidReceiveOutput(listener: ProcessOutputListener): Disposable {
    this.outputListeners.add(listener);
    return { dispose: () => this.outputListeners.delete(listener) };
  }

  public async start(kind: ManagedProcessKind, options: StartProcessOptions): Promise<StartProcessResult> {
    const existing = this.getState(kind);
    if (existing.state === "running") {
      return { outcome: "already-running", descriptor: existing };
    }
    if (existing.state === "starting" || existing.state === "stopping") {
      return { outcome: "busy", descriptor: existing };
    }

    const startingDescriptor: ManagedProcessDescriptor = {
      kind,
      state: "starting",
      executable: options.executable,
      args: options.args,
      cwd: options.cwd,
      expectedPort: options.expectedPort,
      startedAt: Date.now()
    };
    this.pendingStop.delete(kind);
    this.setDescriptor(kind, startingDescriptor);

    let handle: SpawnedProcess;
    try {
      handle = await this.spawner.spawn({
        executable: options.executable,
        args: options.args,
        cwd: options.cwd,
        env: options.env
      });
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : "Unknown spawn error";
      this.pendingStop.delete(kind);
      this.setDescriptor(kind, { ...startingDescriptor, state: "failed", lastError: reason });
      return { outcome: "spawn-failed", reason };
    }

    this.handles.set(kind, handle);
    handle.onExit((info) => this.handleExit(kind, info));
    handle.onOutput((chunk, stream) => {
      for (const listener of this.outputListeners) {
        listener(kind, chunk, stream);
      }
    });

    if (this.pendingStop.has(kind)) {
      this.pendingStop.delete(kind);
      this.setDescriptor(kind, { ...startingDescriptor, state: "stopping", pid: handle.pid });
      await handle.kill();
      return { outcome: "started", descriptor: this.getState(kind) };
    }

    const runningDescriptor: ManagedProcessDescriptor = { ...startingDescriptor, state: "running", pid: handle.pid };
    this.setDescriptor(kind, runningDescriptor);
    return { outcome: "started", descriptor: runningDescriptor };
  }

  public async stop(kind: ManagedProcessKind): Promise<StopProcessResult> {
    const descriptor = this.getState(kind);

    if (descriptor.state === "starting") {
      this.pendingStop.add(kind);
      this.setDescriptor(kind, { ...descriptor, state: "stopping" });
      return { outcome: "stopped" };
    }

    if (descriptor.state !== "running") {
      return { outcome: "already-stopped" };
    }

    const handle = this.handles.get(kind);
    if (handle === undefined) {
      this.setDescriptor(kind, { ...descriptor, state: "stopped", pid: undefined });
      return { outcome: "already-stopped" };
    }

    this.setDescriptor(kind, { ...descriptor, state: "stopping" });
    await handle.kill();
    return { outcome: "stopped" };
  }

  public async startAll(
    optionsByKind: Partial<Record<ManagedProcessKind, StartProcessOptions>>
  ): Promise<Record<ManagedProcessKind, StartProcessResult | { readonly outcome: "skipped" }>> {
    const results: Partial<Record<ManagedProcessKind, StartProcessResult | { readonly outcome: "skipped" }>> = {};
    for (const kind of KINDS) {
      const options = optionsByKind[kind];
      results[kind] = options === undefined ? { outcome: "skipped" } : await this.start(kind, options);
    }
    return results as Record<ManagedProcessKind, StartProcessResult | { readonly outcome: "skipped" }>;
  }

  public async stopAll(): Promise<Record<ManagedProcessKind, StopProcessResult>> {
    const results: Partial<Record<ManagedProcessKind, StopProcessResult>> = {};
    for (const kind of KINDS) {
      results[kind] = await this.stop(kind);
    }
    return results as Record<ManagedProcessKind, StopProcessResult>;
  }

  private handleExit(kind: ManagedProcessKind, info: ProcessExitInfo): void {
    this.handles.delete(kind);
    const descriptor = this.getState(kind);

    if (descriptor.state === "stopping") {
      this.setDescriptor(kind, { ...descriptor, state: "stopped", pid: undefined });
      return;
    }

    const reason = info.error !== undefined
      ? `Process exited unexpectedly: ${info.error}`
      : `Process exited unexpectedly (code ${info.code === null ? "null" : String(info.code)}, signal ${info.signal ?? "none"}).`;
    this.setDescriptor(kind, { ...descriptor, state: "failed", pid: undefined, lastError: reason });
  }

  private setDescriptor(kind: ManagedProcessKind, descriptor: ManagedProcessDescriptor): void {
    this.descriptors.set(kind, descriptor);
    for (const listener of this.listeners) {
      listener(descriptor);
    }
  }
}
