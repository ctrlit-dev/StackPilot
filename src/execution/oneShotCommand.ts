import type { ProcessSpawner, SpawnedProcess } from "./processSpawner";

export interface OneShotCommandOptions {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
}

export type OneShotCommandResult =
  | {
      readonly outcome: "completed";
      readonly exitCode: number | null;
      readonly signal: NodeJS.Signals | null;
      readonly stdout: string;
      readonly stderr: string;
    }
  | { readonly outcome: "spawn-failed"; readonly reason: string };

/**
 * Runs a single command to completion (migrations, tests, build, install -
 * anything that is not a persistent dev server) using the same
 * ProcessSpawner abstraction as ProcessManager, so the Windows "spawn
 * succeeds, ENOENT arrives later as a translated exit" behavior documented in
 * nodeProcessSpawner.ts is handled identically here instead of being
 * reimplemented (and potentially missed) a second time.
 */
export async function runOneShotCommand(
  spawner: ProcessSpawner,
  options: OneShotCommandOptions,
  onOutput?: (chunk: string, stream: "stdout" | "stderr") => void
): Promise<OneShotCommandResult> {
  let handle: SpawnedProcess;
  try {
    handle = await spawner.spawn({
      executable: options.executable,
      args: options.args,
      cwd: options.cwd,
      env: options.env
    });
  } catch (error: unknown) {
    return { outcome: "spawn-failed", reason: error instanceof Error ? error.message : "Unknown spawn error" };
  }

  let stdout = "";
  let stderr = "";
  handle.onOutput((chunk, stream) => {
    if (stream === "stdout") {
      stdout += chunk;
    } else {
      stderr += chunk;
    }
    onOutput?.(chunk, stream);
  });

  return new Promise((resolve) => {
    handle.onExit((info) => {
      if (info.error !== undefined) {
        resolve({ outcome: "spawn-failed", reason: info.error });
        return;
      }
      resolve({ outcome: "completed", exitCode: info.code, signal: info.signal, stdout, stderr });
    });
  });
}
