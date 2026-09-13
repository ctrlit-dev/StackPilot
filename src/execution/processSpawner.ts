export interface ProcessSpawnOptions {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
}

export interface ProcessExitInfo {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  /**
   * Present when the termination was reported via a runtime error rather than
   * a normal exit (e.g. Windows cross-spawn reporting a delayed ENOENT for an
   * unresolvable executable through a synthetic "error" event instead of
   * "exit" - see nodeProcessSpawner.ts for why this happens after "spawn" has
   * already fired).
   */
  readonly error?: string;
}

export interface SpawnedProcess {
  readonly pid: number | undefined;
  onExit(listener: (info: ProcessExitInfo) => void): void;
  onOutput(listener: (chunk: string, stream: "stdout" | "stderr") => void): void;
  kill(): Promise<void>;
}

/**
 * Abstracts process creation so the process manager can be unit-tested with a
 * fake spawner instead of launching real child processes (spec §54/§56).
 *
 * spawn() resolves once the process has actually launched and rejects if it
 * failed to launch (e.g. the executable does not exist) - this distinguishes
 * a "failed startup" from an "unexpected exit" of an already-running process.
 */
export interface ProcessSpawner {
  spawn(options: ProcessSpawnOptions): Promise<SpawnedProcess>;
}
