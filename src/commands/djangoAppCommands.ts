import * as vscode from "vscode";
import {
  COMMAND_DJANGO_APP_MAKE_MIGRATIONS,
  COMMAND_DJANGO_APP_MIGRATE,
  COMMAND_DJANGO_APP_SHOW_MIGRATIONS,
  COMMAND_DJANGO_APP_TEST,
  COMMAND_REFRESH
} from "../constants";
import { showActionableError } from "../ui/notifications";
import type { TreeNode } from "../ui/stackPilotTreeModel";
import { planManagementCommand } from "./backendOperationPlans";
import type { CommandContext } from "./commandContext";
import { runAndReport } from "./operationRunner";

/**
 * Per-app actions on the "Apps" rows in the tree (right-click menu, spec-
 * consistent with the existing backendServer.* context menu pattern). Each
 * one is the exact same manage.py verb already offered project-wide, just
 * scoped to one app_label via planManagementCommand - the same escape hatch
 * behind "Run Management Command…", not a new execution path.
 */
export function registerDjangoAppCommands(context: CommandContext): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(COMMAND_DJANGO_APP_MAKE_MIGRATIONS, (node?: TreeNode) =>
      runScopedManagementCommand(context, node, "makemigrations", true)
    ),
    vscode.commands.registerCommand(COMMAND_DJANGO_APP_MIGRATE, (node?: TreeNode) => runScopedManagementCommand(context, node, "migrate", true)),
    vscode.commands.registerCommand(COMMAND_DJANGO_APP_SHOW_MIGRATIONS, (node?: TreeNode) =>
      runScopedManagementCommand(context, node, "showmigrations", false)
    ),
    vscode.commands.registerCommand(COMMAND_DJANGO_APP_TEST, (node?: TreeNode) => runScopedManagementCommand(context, node, "test", false))
  ];
}

async function runScopedManagementCommand(
  context: CommandContext,
  node: TreeNode | undefined,
  verb: string,
  refreshAfter: boolean
): Promise<void> {
  const appName = node?.label;
  if (appName === undefined) {
    return;
  }

  if (!(await context.workspaceTrust.ensureTrustedForExecution(`Run ${verb} for ${appName}`))) {
    return;
  }

  const plan = planManagementCommand(context.projectState.getState().detectedProject, [verb, appName]);
  if (plan.kind !== "ready") {
    showActionableError(
      context.outputChannel,
      `Could not run "${verb} ${appName}" because ${plan.kind === "no-backend" ? "no Django project was detected." : "no Python interpreter was found."}`
    );
    return;
  }

  const succeeded = await runAndReport(context, `${verb} ${appName}`, plan.command);
  if (succeeded && refreshAfter) {
    await vscode.commands.executeCommand(COMMAND_REFRESH);
  }
}
