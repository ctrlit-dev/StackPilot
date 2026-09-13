import * as vscode from "vscode";
import type { InteractiveShellInvocation } from "./djangoManageCommand";

/**
 * Django Shell / Create Superuser need a real, interactive terminal the user
 * can type into - stdin (REPL input, secret password entry) is not something
 * a captured child_process or our output-only Pseudoterminal server
 * terminals support (spec §19/§20: "Do not use a hidden process for
 * interactive workflows"; never handle the password ourselves). shellPath/
 * shellArgs runs the interpreter directly as the terminal's process, with no
 * intermediate shell to inject through.
 *
 * Reuses an existing terminal for the same key if the user hasn't closed it
 * yet, instead of accumulating a new one on every invocation (spec §63).
 */
export class InteractiveTerminalManager implements vscode.Disposable {
  private readonly terminals = new Map<string, vscode.Terminal>();
  private readonly closeListener: vscode.Disposable;

  public constructor() {
    this.closeListener = vscode.window.onDidCloseTerminal((closed) => {
      for (const [key, terminal] of this.terminals) {
        if (terminal === closed) {
          this.terminals.delete(key);
        }
      }
    });
  }

  /**
   * `reuse: true` (default) is for a still-interactive REPL (Django Shell) -
   * showing the existing terminal is correct because the process is still
   * running. `reuse: false` is for a one-shot interactive flow (Create
   * Superuser): its process has already exited by the time you would run the
   * command again, so an old terminal for that key would just show a dead
   * shell rather than a fresh prompt.
   */
  public open(key: string, name: string, invocation: InteractiveShellInvocation, reuse = true): void {
    if (reuse) {
      const existing = this.terminals.get(key);
      if (existing !== undefined) {
        existing.show();
        return;
      }
    }

    const terminal = vscode.window.createTerminal({
      name,
      shellPath: invocation.shellPath,
      shellArgs: [...invocation.shellArgs],
      cwd: invocation.cwd
    });
    this.terminals.set(key, terminal);
    terminal.show();
  }

  public dispose(): void {
    this.closeListener.dispose();
    for (const terminal of this.terminals.values()) {
      terminal.dispose();
    }
    this.terminals.clear();
  }
}
