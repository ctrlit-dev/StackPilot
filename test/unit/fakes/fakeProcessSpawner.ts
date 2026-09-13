import type { ProcessExitInfo, ProcessSpawnOptions, ProcessSpawner, SpawnedProcess } from "../../../src/execution/processSpawner";

export class FakeSpawnedProcess implements SpawnedProcess {
  public killCallCount = 0;
  private readonly outputListeners: Array<(chunk: string, stream: "stdout" | "stderr") => void> = [];
  private readonly exitListeners: Array<(info: ProcessExitInfo) => void> = [];
  private pendingAutoExit?: { readonly info: ProcessExitInfo; readonly stdout?: string };

  public constructor(public readonly pid: number | undefined = 4242) {}

  public onOutput(listener: (chunk: string, stream: "stdout" | "stderr") => void): void {
    this.outputListeners.push(listener);
  }

  public onExit(listener: (info: ProcessExitInfo) => void): void {
    this.exitListeners.push(listener);
    if (this.pendingAutoExit !== undefined) {
      const { info, stdout } = this.pendingAutoExit;
      // Deferred so onOutput/onExit registration (which runOneShotCommand
      // does synchronously right after spawn() resolves) always completes
      // before this fires.
      queueMicrotask(() => {
        if (stdout !== undefined) {
          this.emitOutput(stdout, "stdout");
        }
        this.emitExit(info);
      });
    }
  }

  /**
   * Configures this handle to automatically exit as soon as its listeners
   * are registered, instead of requiring the test to manually call
   * emitExit() at exactly the right moment. Useful for driving a long,
   * multi-step sequential process (like a whole scaffold plan) end-to-end
   * without hand-interleaving each step's timing.
   */
  public autoExit(info: ProcessExitInfo, stdout?: string): this {
    this.pendingAutoExit = { info, stdout };
    return this;
  }

  public kill(): Promise<void> {
    this.killCallCount += 1;
    return Promise.resolve();
  }

  public emitOutput(chunk: string, stream: "stdout" | "stderr" = "stdout"): void {
    for (const listener of this.outputListeners) {
      listener(chunk, stream);
    }
  }

  public emitExit(info: ProcessExitInfo): void {
    for (const listener of this.exitListeners) {
      listener(info);
    }
  }
}

interface DeferredSpawn {
  readonly type: "deferred";
  readonly handle: FakeSpawnedProcess;
  resolve?: () => void;
  reject?: (error: Error) => void;
}

type QueuedSpawn = { readonly type: "resolve"; readonly handle: FakeSpawnedProcess } | { readonly type: "reject"; readonly error: Error } | DeferredSpawn;

export class FakeProcessSpawner implements ProcessSpawner {
  public readonly spawnCalls: ProcessSpawnOptions[] = [];
  private readonly queue: QueuedSpawn[] = [];

  public queueSuccess(): FakeSpawnedProcess {
    const handle = new FakeSpawnedProcess();
    this.queue.push({ type: "resolve", handle });
    return handle;
  }

  /** queueSuccess() + autoExit() in one call, for driving long sequential command chains without manual timing. */
  public queueAutoSuccess(info: ProcessExitInfo = { code: 0, signal: null }, stdout?: string): FakeSpawnedProcess {
    return this.queueSuccess().autoExit(info, stdout);
  }

  public queueFailure(error: Error): void {
    this.queue.push({ type: "reject", error });
  }

  /**
   * Queues a spawn whose resolution is controlled manually by the test, used
   * to exercise races where another operation happens while a start is still
   * in flight (spawn() has been called but has not yet resolved).
   */
  public queueDeferred(): { handle: FakeSpawnedProcess; resolveSpawn(): void; rejectSpawn(error: Error): void } {
    const entry: DeferredSpawn = { type: "deferred", handle: new FakeSpawnedProcess() };
    this.queue.push(entry);
    return {
      handle: entry.handle,
      resolveSpawn: () => entry.resolve?.(),
      rejectSpawn: (error: Error) => entry.reject?.(error)
    };
  }

  public spawn(options: ProcessSpawnOptions): Promise<SpawnedProcess> {
    this.spawnCalls.push(options);
    const next = this.queue.shift();
    if (next === undefined) {
      return Promise.reject(new Error("FakeProcessSpawner: no queued response for spawn()"));
    }

    if (next.type === "resolve") {
      return Promise.resolve(next.handle);
    }

    if (next.type === "reject") {
      return Promise.reject(next.error);
    }

    return new Promise<SpawnedProcess>((resolve, reject) => {
      next.resolve = () => resolve(next.handle);
      next.reject = reject;
    });
  }
}
