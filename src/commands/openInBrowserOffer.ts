import * as vscode from "vscode";
import type { ManagedProcessDescriptor, ManagedProcessKind } from "../execution/processManager";
import type { CommandContext } from "./commandContext";
import { planServiceUrl } from "./openApplicationPlan";

/**
 * Spec's `stackPilot.openBrowserOnStart` setting: "Offer browser-opening
 * behavior after starting managed development servers. No browser is opened
 * automatically without a user action." This only shows a notification with
 * an action button when the setting is enabled - it never opens anything by
 * itself.
 */
export async function offerToOpenInBrowser(context: CommandContext, kind: ManagedProcessKind, descriptor: ManagedProcessDescriptor): Promise<void> {
  const state = context.projectState.getState();
  if (state.configuration?.openBrowserOnStart !== true) {
    return;
  }

  const url = planServiceUrl(kind, descriptor, context.frontendUrlTracker.getUrl(), state.configuration.backendHost);
  if (url === undefined) {
    return;
  }

  const openAction = "Open in Browser";
  const choice = await vscode.window.showInformationMessage(`${kind === "backend" ? "Backend server" : "Frontend server"} started.`, openAction);
  if (choice === openAction) {
    await vscode.env.openExternal(vscode.Uri.parse(url));
  }
}
