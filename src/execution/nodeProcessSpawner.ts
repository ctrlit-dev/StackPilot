import crossSpawn from "cross-spawn";
import type { ChildProcess } from "node:child_process";

import type { ProcessExitInfo, ProcessSpawnOptions, ProcessSpawner, SpawnedProcess } from "./processSpawner";

/**
 * Real process spawner backed by cross-spawn.
 *
 * cross-spawn (not Node's child_process.spawn directly) is used because
 * Windows cannot execute .cmd/.bat files (npm, pnpm, yarn all ship as .cmd
 * shims) without a shell, and Node's own shell-based workarounds are exactly
 * the class of bug behind CVE-2024-27980/CVE-2024-36138 ("BatBadBut"): cmd.exe's
 * argument parsing for batch files cannot be safely replicated by hand. Node's
 * own child_process docs also deprecate (DEP0190) passing an args array together
 * with shell:true. cross-spawn resolves the correct executable and escapes
 * arguments safely without an interactive shell, keeping this a shell:false-only
 * codepath as required by spec §11.
 *
 * IMPORTANT Windows quirk (verified empirically, see cross-spawn's lib/enoent.js):
 * when the target executable cannot be resolved to a real file, cross-spawn
 * still spawns cmd.exe as a wrapper (a real process, so a "spawn" event fires
 * with a real pid), and only detects the failure once cmd.exe exits with code 1.
 * It then monkey-patches that "exit" into an "error" event carrying the ENOENT.
 * This means "spawn" can fire before a definitive failure is known - a naive
 * resolve-on-spawn/reject-on-error implementation would report success and then
 * silently drop the later error, leaving the process manager believing a
 * nonexistent executable is running forever. This spawner instead always wires
 * exit/error handling first and only uses the spawn/error race to decide the
 * *initial* promise outcome; a later "error" is folded into onExit() as a
 * failed exit so it is never lost.
 */
export class NodeProcessSpawner implements ProcessSpawner {
  public spawn(options: ProcessSpawnOptions): Promise<SpawnedProcess> {
    return new Promise((resolve, reject) => {
      const child = crossSpawn(options.executable, [...options.args], {
        cwd: options.cwd,
        env: options.env === undefined ? undefined : { ...process.env, ...options.env },
        windowsHide: true,
        detached: process.platform !== "win32"
      });

      const outputListeners: Array<(chunk: string, stream: "stdout" | "stderr") => void> = [];
      const exitListeners: Array<(info: ProcessExitInfo) => void> = [];
      let settled = false;

      const emitExit = (info: ProcessExitInfo): void => {
        for (const listener of exitListeners) {
          listener(info);
        }
      };

      child.stdout?.on("data", (data: Buffer) => {
        for (const listener of outputListeners) {
          listener(data.toString("utf8"), "stdout");
        }
      });
      child.stderr?.on("data", (data: Buffer) => {
        for (const listener of outputListeners) {
          listener(data.toString("utf8"), "stderr");
        }
      });

      child.on("exit", (code, signal) => {
        emitExit({ code, signal });
      });

      child.on("error", (error: Error) => {
        if (!settled) {
          settled = true;
          reject(error);
          return;
        }
        emitExit({ code: null, signal: null, error: error.message });
      });

      child.once("spawn", () => {
        if (settled) {
          return;
        }
        settled = true;
        resolve({
          pid: child.pid,
          onOutput: (listener) => {
            outputListeners.push(listener);
          },
          onExit: (listener) => {
            exitListeners.push(listener);
          },
          kill: () => killProcessTree(child)
        });
      });
    });
  }
}

/**
 * Terminates only the tracked process (and its children), never a broad
 * name-based kill (spec §14: "do not use broad commands such as
 * `taskkill /IM python.exe`"). Windows requires an explicit process-tree kill
 * because terminating a wrapper process (npm.cmd, a venv activation shim,
 * etc.) does not terminate the real child it launched.
 */
async function killProcessTree(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = crossSpawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
      killer.once("exit", () => resolve());
      killer.once("error", () => resolve());
    });
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}
