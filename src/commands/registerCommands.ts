import type * as vscode from "vscode";
import { registerBackendCommands } from "./backendCommands";
import { registerBackendOperationCommands } from "./backendOperationCommands";
import type { CommandContext } from "./commandContext";
import { registerDjangoAppCommands } from "./djangoAppCommands";
import { registerEnvFileCommands } from "./envFileCommand";
import { registerFrontendCommands } from "./frontendCommands";
import { registerFrontendOperationCommands } from "./frontendOperationCommands";
import { registerGenerateDebugConfigCommand } from "./generateDebugConfigCommand";
import { registerInitializeProjectCommand } from "./initializeProjectCommand";
import { registerNewProjectCommand } from "./newProjectWizard";
import { registerProjectCommands } from "./projectCommands";
import { registerToggleServerCommands } from "./toggleServerCommands";
import { registerVenvCommands } from "./venvCommands";

export function registerCommands(context: CommandContext): vscode.Disposable[] {
  return [
    ...registerBackendCommands(context),
    ...registerBackendOperationCommands(context),
    ...registerFrontendCommands(context),
    ...registerFrontendOperationCommands(context),
    ...registerProjectCommands(context),
    ...registerVenvCommands(context),
    ...registerInitializeProjectCommand(context),
    ...registerNewProjectCommand(context),
    ...registerGenerateDebugConfigCommand(context),
    ...registerToggleServerCommands(context),
    ...registerEnvFileCommands(context),
    ...registerDjangoAppCommands(context)
  ];
}
