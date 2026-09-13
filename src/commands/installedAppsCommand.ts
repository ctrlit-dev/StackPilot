import * as path from "node:path";
import * as vscode from "vscode";
import type { FileSystemProbe } from "../detection/fileSystem";
import { planInstalledAppsInsertion } from "../project/installedAppsEdit";
import { showActionableWarning } from "../ui/notifications";
import type { CommandContext } from "./commandContext";

const SETTINGS_FILE_NAME = "settings.py";
const MAX_SEARCH_DEPTH = 2;
const IGNORED_DIRECTORY_NAMES = new Set([".venv", "venv", "env", "migrations", "node_modules", "__pycache__"]);

/**
 * Best-effort follow-up to "Create Django App": finds the one settings.py
 * this backend appears to use and offers to add the new app to
 * INSTALLED_APPS. Never silent - the edit is applied through the normal
 * editor (so it is a plain, visible, Ctrl+Z-able change) and this bails out
 * with guidance instead of guessing whenever the file or the list isn't
 * unambiguous (spec-consistent with this codebase's existing refusal to
 * guess at fragile, free-form Python/text formats).
 */
export async function offerToRegisterInstalledApp(context: CommandContext, backendRootPath: string, appName: string): Promise<void> {
  const settingsFiles = await findSettingsFiles(context.fileSystem, backendRootPath, MAX_SEARCH_DEPTH);

  if (settingsFiles.length === 0) {
    showActionableWarning(context.outputChannel, `Could not find settings.py automatically - add "${appName}" to INSTALLED_APPS yourself.`);
    return;
  }
  if (settingsFiles.length > 1) {
    showActionableWarning(
      context.outputChannel,
      `Found more than one settings.py - add "${appName}" to INSTALLED_APPS yourself: ${settingsFiles.join(", ")}`
    );
    return;
  }

  const settingsPath = settingsFiles[0];
  const content = await context.fileSystem.readTextFile(settingsPath);
  const plan = planInstalledAppsInsertion(content, appName);

  if (plan.kind === "already-present") {
    return;
  }

  if (plan.kind === "not-found") {
    const choice = await vscode.window.showWarningMessage(
      `StackPilot: could not find a plain INSTALLED_APPS list in ${path.basename(settingsPath)}. Add "${appName}" yourself.`,
      "Open settings.py"
    );
    if (choice === "Open settings.py") {
      await vscode.window.showTextDocument(vscode.Uri.file(settingsPath));
    }
    return;
  }

  const settingsUri = vscode.Uri.file(settingsPath);
  const edit = new vscode.WorkspaceEdit();
  edit.insert(settingsUri, new vscode.Position(plan.lineIndex, 0), `${plan.lineText}\n`);
  await vscode.workspace.applyEdit(edit);

  const document = await vscode.workspace.openTextDocument(settingsUri);
  const editor = await vscode.window.showTextDocument(document);
  const insertedLine = editor.document.lineAt(plan.lineIndex);
  editor.revealRange(insertedLine.range);
  editor.selection = new vscode.Selection(insertedLine.range.start, insertedLine.range.end);

  void vscode.window.showInformationMessage(`StackPilot: added "${appName}" to INSTALLED_APPS in ${path.basename(settingsPath)}.`);
}

async function findSettingsFiles(fs: FileSystemProbe, directoryPath: string, depthRemaining: number): Promise<string[]> {
  const found: string[] = [];
  await collectSettingsFiles(fs, directoryPath, depthRemaining, found);
  return found;
}

async function collectSettingsFiles(fs: FileSystemProbe, directoryPath: string, depthRemaining: number, found: string[]): Promise<void> {
  const directPath = path.join(directoryPath, SETTINGS_FILE_NAME);
  if (await fs.fileExists(directPath)) {
    found.push(directPath);
  }
  if (depthRemaining <= 0) {
    return;
  }

  const entryNames = await fs.listDirectoryNames(directoryPath);
  for (const name of entryNames) {
    if (name.startsWith(".") || IGNORED_DIRECTORY_NAMES.has(name)) {
      continue;
    }
    const childPath = path.join(directoryPath, name);
    if (await fs.directoryExists(childPath)) {
      await collectSettingsFiles(fs, childPath, depthRemaining - 1, found);
    }
  }
}
