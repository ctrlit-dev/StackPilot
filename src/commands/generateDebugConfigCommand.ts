import * as vscode from "vscode";
import { COMMAND_GENERATE_DEBUG_CONFIG } from "../constants";
import { buildLaunchConfigurations, mergeLaunchEntriesByName, type LaunchConfigurationEntry } from "../project/debugConfig";
import { showActionableError } from "../ui/notifications";
import type { CommandContext } from "./commandContext";

export function registerGenerateDebugConfigCommand(context: CommandContext): vscode.Disposable[] {
  return [vscode.commands.registerCommand(COMMAND_GENERATE_DEBUG_CONFIG, () => generateDebugConfig(context))];
}

export async function generateDebugConfig(context: CommandContext): Promise<void> {
  const state = context.projectState.getState();
  if (state.selection.kind !== "selected") {
    void vscode.window.showWarningMessage("StackPilot: select a workspace folder before generating a debug configuration.");
    return;
  }

  const plan = buildLaunchConfigurations({
    workspaceRootPath: state.detectedProject?.workspaceRootPath ?? "",
    detectedProject: state.detectedProject,
    configuration: state.configuration
  });

  if (plan.configurations.length === 0) {
    showActionableError(
      context.outputChannel,
      "StackPilot could not generate a debug configuration because no Django backend (with a Python interpreter) or frontend was detected."
    );
    return;
  }

  const workspaceFolderUri = vscode.Uri.parse(state.selection.folder.uri);
  const launchSettings = vscode.workspace.getConfiguration("launch", workspaceFolderUri);
  const existingConfigurations = launchSettings.get<LaunchConfigurationEntry[]>("configurations", []);
  const existingCompounds = launchSettings.get<LaunchConfigurationEntry[]>("compounds", []);

  await launchSettings.update(
    "configurations",
    mergeLaunchEntriesByName(existingConfigurations, plan.configurations),
    vscode.ConfigurationTarget.WorkspaceFolder
  );
  if (plan.compounds.length > 0) {
    await launchSettings.update(
      "compounds",
      mergeLaunchEntriesByName(existingCompounds, plan.compounds),
      vscode.ConfigurationTarget.WorkspaceFolder
    );
  }

  context.outputChannel.appendLine(
    `Generated ${plan.configurations.length} debug configuration(s)${plan.compounds.length > 0 ? " and a compound" : ""} in .vscode/launch.json.`
  );
  const choice = await vscode.window.showInformationMessage(
    "StackPilot: debug configuration added to .vscode/launch.json.",
    "Open Run and Debug"
  );
  if (choice === "Open Run and Debug") {
    await vscode.commands.executeCommand("workbench.view.debug");
  }
}
