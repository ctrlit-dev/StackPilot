import * as vscode from "vscode";
import { runOneShotCommand, type OneShotCommandOptions } from "../execution/oneShotCommand";
import { showActionableError } from "../ui/notifications";
import type { CommandContext } from "./commandContext";

/**
 * Runs a one-shot backend/frontend operation to completion, streaming its
 * output into the shared operation terminal and reporting the outcome (spec
 * §17: "Show command output... If migration fails: preserve output, show
 * concise error notification"). Returns whether it succeeded so callers can
 * chain follow-up steps (e.g. Create Django App reveals the new folder only
 * on success).
 */
export async function runAndReport(context: CommandContext, title: string, command: OneShotCommandOptions): Promise<boolean> {
  const sink = context.operationTerminal.begin(title);
  const result = await runOneShotCommand(context.spawner, command, (chunk) => sink.write(chunk));

  if (result.outcome === "spawn-failed") {
    sink.write(`\r\n[StackPilot] Failed to start: ${result.reason}\r\n`);
    showActionableError(context.outputChannel, `${title} failed to start: ${result.reason}`);
    context.activityLog.record(`${title} failed to start`, "failure");
    return false;
  }

  if (result.exitCode === 0) {
    sink.write(`\r\n[StackPilot] ${title} completed successfully.\r\n`);
    void vscode.window.showInformationMessage(`StackPilot: ${title} completed.`);
    context.activityLog.record(title, "success");
    return true;
  }

  sink.write(`\r\n[StackPilot] ${title} failed (exit code ${result.exitCode ?? "null"}).\r\n`);
  showActionableError(context.outputChannel, `${title} failed (exit code ${result.exitCode ?? "null"}). See the terminal for details.`);
  context.activityLog.record(`${title} failed`, "failure");
  return false;
}
