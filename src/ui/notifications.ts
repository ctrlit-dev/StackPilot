import * as vscode from "vscode";
import { COMMAND_OPEN_SETTINGS } from "../constants";

const OPEN_LOGS_ACTION = "Open Logs";
const OPEN_SETTINGS_ACTION = "Open Settings";

/**
 * Shows a concise, actionable error (spec §44: "What failed? Why, if known?
 * What can the user do next?") with a fixed, small set of follow-up actions.
 * Detailed output stays in the Output Channel rather than the notification
 * itself (spec §43).
 */
export function showActionableError(outputChannel: vscode.OutputChannel, message: string): void {
  outputChannel.appendLine(`[Error] ${message}`);
  void showActionable(vscode.window.showErrorMessage, outputChannel, message);
}

export function showActionableWarning(outputChannel: vscode.OutputChannel, message: string): void {
  outputChannel.appendLine(`[Warning] ${message}`);
  void showActionable(vscode.window.showWarningMessage, outputChannel, message);
}

async function showActionable(
  show: (message: string, ...actions: string[]) => Thenable<string | undefined>,
  outputChannel: vscode.OutputChannel,
  message: string
): Promise<void> {
  const choice = await show(message, OPEN_LOGS_ACTION, OPEN_SETTINGS_ACTION);
  if (choice === OPEN_LOGS_ACTION) {
    outputChannel.show(true);
  } else if (choice === OPEN_SETTINGS_ACTION) {
    await vscode.commands.executeCommand(COMMAND_OPEN_SETTINGS);
  }
}
