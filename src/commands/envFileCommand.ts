import * as path from "node:path";
import * as vscode from "vscode";
import { COMMAND_OPEN_BACKEND_ENV_FILE, COMMAND_OPEN_FRONTEND_ENV_FILE } from "../constants";
import { getBackendService, getFrontendService } from "../detection/detectedProject";
import { findEnvExampleContent } from "../project/envFileTemplate";
import { showActionableError } from "../ui/notifications";
import type { CommandContext } from "./commandContext";

export function registerEnvFileCommands(context: CommandContext): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(COMMAND_OPEN_BACKEND_ENV_FILE, () => openBackendEnvFile(context)),
    vscode.commands.registerCommand(COMMAND_OPEN_FRONTEND_ENV_FILE, () => openFrontendEnvFile(context))
  ];
}

async function openBackendEnvFile(context: CommandContext): Promise<void> {
  const backend = getBackendService(context.projectState.getState().detectedProject);
  if (backend === undefined) {
    showActionableError(context.outputChannel, "The .env file could not be opened because no Django project was detected.");
    return;
  }
  await openOrCreateEnvFile(context, backend.rootPath);
}

async function openFrontendEnvFile(context: CommandContext): Promise<void> {
  const frontend = getFrontendService(context.projectState.getState().detectedProject);
  if (frontend === undefined) {
    showActionableError(context.outputChannel, "The .env file could not be opened because no Vite frontend was detected.");
    return;
  }
  await openOrCreateEnvFile(context, frontend.rootPath);
}

/**
 * Opens an existing .env as-is (full editor - syntax highlighting,
 * IntelliSense from any installed .env extension - beats a bespoke
 * key/value UI). Only ever creates the file when it is missing, seeded from
 * a `.env.example`/`.env.sample`/`.env.template` if one exists next to it;
 * an existing .env is never touched or overwritten.
 */
async function openOrCreateEnvFile(context: CommandContext, rootPath: string): Promise<void> {
  const envPath = path.join(rootPath, ".env");
  const envUri = vscode.Uri.file(envPath);

  if (!(await context.fileSystem.fileExists(envPath))) {
    if (!(await context.workspaceTrust.ensureTrustedForExecution("Create .env"))) {
      return;
    }

    const exampleContent = await findEnvExampleContent(context.fileSystem, rootPath);
    await vscode.workspace.fs.writeFile(envUri, Buffer.from(exampleContent ?? "", "utf8"));
    context.outputChannel.appendLine(
      exampleContent === undefined ? `Created ${envPath}.` : `Created ${envPath} from its .env example template.`
    );
  }

  const document = await vscode.workspace.openTextDocument(envUri);
  await vscode.window.showTextDocument(document);
}
