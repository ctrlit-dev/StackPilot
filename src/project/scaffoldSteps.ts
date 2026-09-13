import * as path from "node:path";
import type { OneShotCommandOptions } from "../execution/oneShotCommand";
import { runOneShotCommand } from "../execution/oneShotCommand";
import type { ProcessSpawner } from "../execution/processSpawner";
import type { ProjectFileWriter } from "./projectFileWriter";
import type { ScaffoldStep } from "./scaffoldStep";

type OutputCallback = (chunk: string, stream: "stdout" | "stderr") => void;

/** Creates a directory, reporting it as newly created only if it did not already exist. */
export function createDirectoryStep(writer: ProjectFileWriter, id: string, label: string, directoryPath: string): ScaffoldStep {
  return {
    id,
    label,
    execute: async () => {
      const existedBefore = await writer.pathExists(directoryPath);
      await writer.createDirectory(directoryPath);
      return { succeeded: true, createdPaths: existedBefore ? [] : [directoryPath] };
    }
  };
}

/**
 * Writes a text file, never overwriting an existing one unless explicitly
 * requested (spec §27/§33). `content` may be a function so a later step can
 * use data an earlier step captured at runtime (e.g. requirements.txt needs
 * the Django version `pip show` reported, not a value known up front).
 */
export function writeFileStep(
  writer: ProjectFileWriter,
  id: string,
  label: string,
  filePath: string,
  content: string | (() => string),
  options: { readonly overwrite?: boolean } = {}
): ScaffoldStep {
  return {
    id,
    label,
    execute: async () => {
      const existedBefore = await writer.pathExists(filePath);
      const resolvedContent = typeof content === "function" ? content() : content;
      const result = await writer.writeTextFile(filePath, resolvedContent, options);
      return { succeeded: true, createdPaths: result.written && !existedBefore ? [filePath] : [] };
    }
  };
}

/**
 * Runs a one-shot command as a scaffold step. `ownedPath`, when given, is
 * reported as newly created on success - used when this command's output
 * lives entirely under a directory an earlier step already tracked (e.g.
 * `pip install` writing into an already-tracked backend/.venv), in which
 * case pass undefined so cleanup does not try to remove the same path twice.
 */
export function commandStep(
  spawner: ProcessSpawner,
  id: string,
  label: string,
  command: OneShotCommandOptions,
  ownedPath: string | undefined,
  onOutput?: OutputCallback
): ScaffoldStep {
  return {
    id,
    label,
    execute: async () => {
      const result = await runOneShotCommand(spawner, command, onOutput);
      if (result.outcome === "spawn-failed") {
        return { succeeded: false, createdPaths: [], errorMessage: result.reason };
      }
      if (result.exitCode !== 0) {
        return {
          succeeded: false,
          createdPaths: [],
          errorMessage: `Exited with code ${result.exitCode ?? "null"}.${result.stderr.trim().length > 0 ? ` ${result.stderr.trim().slice(-500)}` : ""}`
        };
      }
      return { succeeded: true, createdPaths: ownedPath === undefined ? [] : [ownedPath] };
    }
  };
}

/**
 * A one-shot command step whose output is captured (not just streamed) so a
 * later step can read it - used for `pip show django` to extract the
 * installed version (spec §28).
 */
export function commandCaptureStep(
  spawner: ProcessSpawner,
  id: string,
  label: string,
  command: OneShotCommandOptions,
  onCaptured: (stdout: string) => void,
  onOutput?: OutputCallback
): ScaffoldStep {
  return {
    id,
    label,
    execute: async () => {
      const result = await runOneShotCommand(spawner, command, onOutput);
      if (result.outcome === "spawn-failed") {
        return { succeeded: false, createdPaths: [], errorMessage: result.reason };
      }
      if (result.exitCode !== 0) {
        return { succeeded: false, createdPaths: [], errorMessage: `Exited with code ${result.exitCode ?? "null"}.` };
      }
      onCaptured(result.stdout);
      return { succeeded: true, createdPaths: [] };
    }
  };
}

/**
 * `git init` is the one step allowed to fail softly (spec §32: "If Git is
 * unavailable, project creation should still succeed and Git should be
 * reported as skipped") - unlike every other step, its failure never stops
 * the scaffold. `onStatus` reports what actually happened for the final
 * summary shown to the user.
 */
export function optionalGitInitStep(
  spawner: ProcessSpawner,
  id: string,
  label: string,
  projectRoot: string,
  onStatus: (status: "initialized" | "unavailable" | "failed", detail?: string) => void,
  onOutput?: OutputCallback
): ScaffoldStep {
  return {
    id,
    label,
    execute: async () => {
      const result = await runOneShotCommand(spawner, { executable: "git", args: ["init"], cwd: projectRoot }, onOutput);
      if (result.outcome === "spawn-failed") {
        onStatus("unavailable", result.reason);
        return { succeeded: true, createdPaths: [] };
      }
      if (result.exitCode !== 0) {
        onStatus("failed", `Exited with code ${result.exitCode ?? "null"}.`);
        return { succeeded: true, createdPaths: [] };
      }
      onStatus("initialized");
      return { succeeded: true, createdPaths: [] };
    }
  };
}

/**
 * create-vite has a real, empirically-verified quirk: in non-interactive
 * mode, scaffolding into a non-empty directory prints "Operation cancelled"
 * and exits 0 - a normal exit-code check would misreport this as success.
 * This step additionally verifies package.json now exists before declaring
 * success.
 */
export function viteScaffoldStep(
  spawner: ProcessSpawner,
  writer: ProjectFileWriter,
  id: string,
  label: string,
  command: OneShotCommandOptions,
  frontendPath: string,
  onOutput?: OutputCallback
): ScaffoldStep {
  return {
    id,
    label,
    execute: async () => {
      const result = await runOneShotCommand(spawner, command, onOutput);
      if (result.outcome === "spawn-failed") {
        return { succeeded: false, createdPaths: [], errorMessage: result.reason };
      }

      const scaffolded = await writer.pathExists(path.join(frontendPath, "package.json"));
      if (!scaffolded) {
        return {
          succeeded: false,
          createdPaths: [],
          errorMessage:
            result.exitCode === 0
              ? "The frontend scaffold tool reported success but did not create a package.json (the target folder may not have been empty)."
              : `Exited with code ${result.exitCode ?? "null"}.`
        };
      }

      return { succeeded: true, createdPaths: [frontendPath] };
    }
  };
}
