import * as vscode from "vscode";
import { COMMAND_TOGGLE_BACKEND, COMMAND_TOGGLE_FRONTEND } from "../constants";
import { startBackend, stopBackend } from "./backendCommands";
import type { CommandContext } from "./commandContext";
import { startFrontend, stopFrontend } from "./frontendCommands";

/**
 * One command per server that starts or stops depending on the current
 * state, so a single status bar item can bind to a single, fixed command
 * (spec-consistent with every other command here already being a plain,
 * no-argument vscode.commands.registerCommand target).
 */
export function registerToggleServerCommands(context: CommandContext): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(COMMAND_TOGGLE_BACKEND, () => toggleBackend(context)),
    vscode.commands.registerCommand(COMMAND_TOGGLE_FRONTEND, () => toggleFrontend(context))
  ];
}

async function toggleBackend(context: CommandContext): Promise<void> {
  const state = context.processManager.getState("backend").state;
  if (state === "running" || state === "starting") {
    await stopBackend(context);
  } else {
    await startBackend(context);
  }
}

async function toggleFrontend(context: CommandContext): Promise<void> {
  const state = context.processManager.getState("frontend").state;
  if (state === "running" || state === "starting") {
    await stopFrontend(context);
  } else {
    await startFrontend(context);
  }
}
