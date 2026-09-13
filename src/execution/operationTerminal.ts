import * as vscode from "vscode";

const TERMINAL_NAME = "StackPilot — Setup";

/**
 * One shared, reused Pseudoterminal for one-shot operations (migrations,
 * tests, build, install) so each click doesn't spawn a fresh terminal tab
 * (spec §63: "Do not create endless terminals every time a user clicks an
 * action... use a shared operation terminal"). Persistent server output has
 * its own manager (terminalManager.ts); this one is for commands that run to
 * completion and exit.
 */
export class OperationTerminal implements vscode.Disposable {
  private entry?: { readonly terminal: vscode.Terminal; readonly writeEmitter: vscode.EventEmitter<string> };
  private readonly closeListener: vscode.Disposable;

  public constructor() {
    this.closeListener = vscode.window.onDidCloseTerminal((closed) => {
      if (this.entry?.terminal === closed) {
        this.entry.writeEmitter.dispose();
        this.entry = undefined;
      }
    });
  }

  /** Reveals the shared terminal, writes a header line, and returns a writer for streamed output. */
  public begin(title: string): { write(chunk: string): void } {
    const entry = this.ensureEntry();
    entry.terminal.show(true);
    entry.writeEmitter.fire(`\r\n[StackPilot] ${title}\r\n`);
    return { write: (chunk: string) => entry.writeEmitter.fire(normalizeLineEndings(chunk)) };
  }

  private ensureEntry(): { readonly terminal: vscode.Terminal; readonly writeEmitter: vscode.EventEmitter<string> } {
    if (this.entry !== undefined) {
      return this.entry;
    }

    const writeEmitter = new vscode.EventEmitter<string>();
    const closeEmitter = new vscode.EventEmitter<number | void>();
    const pty: vscode.Pseudoterminal = {
      onDidWrite: writeEmitter.event,
      onDidClose: closeEmitter.event,
      open: () => undefined,
      close: () => undefined
    };
    const terminal = vscode.window.createTerminal({ name: TERMINAL_NAME, pty });
    this.entry = { terminal, writeEmitter };
    return this.entry;
  }

  public dispose(): void {
    this.closeListener.dispose();
    if (this.entry !== undefined) {
      this.entry.writeEmitter.dispose();
      this.entry.terminal.dispose();
      this.entry = undefined;
    }
  }
}

function normalizeLineEndings(chunk: string): string {
  return chunk.replaceAll(/\r?\n/g, "\r\n");
}
