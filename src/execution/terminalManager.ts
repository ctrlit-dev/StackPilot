import * as vscode from "vscode";
import type { ManagedProcessDescriptor, ManagedProcessKind, ProcessManager } from "./processManager";

const TERMINAL_NAMES: Record<ManagedProcessKind, string> = {
  backend: "StackPilot — Django",
  frontend: "StackPilot — Frontend"
};

/**
 * Mirrors managed process output into a persistent, named terminal per kind
 * (spec §63: meaningful names, reuse across restarts rather than creating a
 * new terminal every click; spec §64: maintain visible output for server
 * commands). Built on a Pseudoterminal so this extension keeps full
 * programmatic control of the underlying process while still giving the user
 * a normal-looking integrated terminal.
 *
 * This is a thin VS Code adapter with no independent business logic, so
 * (like nodeProcessSpawner.ts) it is not unit-tested directly - it is
 * exercised through the Extension Host (integration tests) and manual
 * verification instead.
 */
export class ServerTerminalManager implements vscode.Disposable {
  private readonly entries = new Map<ManagedProcessKind, { readonly terminal: vscode.Terminal; readonly writeEmitter: vscode.EventEmitter<string> }>();
  private readonly disposables: vscode.Disposable[] = [];

  public constructor(processManager: ProcessManager) {
    this.disposables.push(
      processManager.onDidReceiveOutput((kind, chunk) => {
        this.entries.get(kind)?.writeEmitter.fire(normalizeLineEndings(chunk));
      }),
      processManager.onDidChangeState((descriptor) => {
        this.reportLifecycleTransition(descriptor);
      }),
      vscode.window.onDidCloseTerminal((closed) => {
        for (const [kind, entry] of this.entries) {
          if (entry.terminal === closed) {
            entry.writeEmitter.dispose();
            this.entries.delete(kind);
          }
        }
      })
    );
  }

  /** Ensures a terminal exists for this kind and brings it into view. */
  public reveal(kind: ManagedProcessKind): void {
    this.ensureEntry(kind).terminal.show(true);
  }

  private reportLifecycleTransition(descriptor: ManagedProcessDescriptor): void {
    if (descriptor.state === "starting") {
      const entry = this.ensureEntry(descriptor.kind);
      entry.terminal.show(true);
      entry.writeEmitter.fire(`\r\n[StackPilot] Starting: ${describeCommand(descriptor)}\r\n`);
      return;
    }

    const entry = this.entries.get(descriptor.kind);
    if (entry === undefined) {
      return;
    }

    if (descriptor.state === "stopped") {
      entry.writeEmitter.fire("\r\n[StackPilot] Process stopped.\r\n");
    } else if (descriptor.state === "failed") {
      entry.writeEmitter.fire(`\r\n[StackPilot] Process failed: ${descriptor.lastError ?? "unknown error"}\r\n`);
    }
  }

  private ensureEntry(kind: ManagedProcessKind): { readonly terminal: vscode.Terminal; readonly writeEmitter: vscode.EventEmitter<string> } {
    const existing = this.entries.get(kind);
    if (existing !== undefined) {
      return existing;
    }

    const writeEmitter = new vscode.EventEmitter<string>();
    const closeEmitter = new vscode.EventEmitter<number | void>();
    const pty: vscode.Pseudoterminal = {
      onDidWrite: writeEmitter.event,
      onDidClose: closeEmitter.event,
      open: () => undefined,
      close: () => undefined
    };
    const terminal = vscode.window.createTerminal({ name: TERMINAL_NAMES[kind], pty });
    const entry = { terminal, writeEmitter };
    this.entries.set(kind, entry);
    return entry;
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    for (const entry of this.entries.values()) {
      entry.writeEmitter.dispose();
      entry.terminal.dispose();
    }
    this.entries.clear();
  }
}

function normalizeLineEndings(chunk: string): string {
  return chunk.replaceAll(/\r?\n/g, "\r\n");
}

function describeCommand(descriptor: ManagedProcessDescriptor): string {
  const args = descriptor.args?.join(" ") ?? "";
  return `${descriptor.executable ?? ""} ${args}`.trim();
}
