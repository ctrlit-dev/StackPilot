import Module from "node:module";

/**
 * Unit tests run via plain `node --test` against compiled output, not inside
 * a real VS Code extension host - there is no "vscode" package in
 * node_modules (esbuild.js marks it `external`, it is only ever supplied by
 * the host at runtime). Files under test here (`contextKeys.ts`,
 * `projectCommands.ts`, `dashboardPanelController.ts`) each do a real,
 * top-level `import * as vscode from "vscode"`, so importing them at all
 * requires something to answer that `require("vscode")` call. This patches
 * Node's CommonJS loader to hand back a small fake instead - each test file
 * that needs it imports this module first (its side effect runs once, before
 * any of the modules under test are required), then asserts against the
 * recorded calls.
 */

export interface RecordedCall {
  readonly args: readonly unknown[];
}

const executeCommandCalls: RecordedCall[] = [];
const openExternalCalls: RecordedCall[] = [];

const fakeVscode = {
  commands: {
    executeCommand: (...args: unknown[]): Promise<unknown> => {
      executeCommandCalls.push({ args });
      return Promise.resolve(undefined);
    },
    registerCommand: (): { dispose(): void } => ({ dispose: () => {} })
  },
  env: {
    openExternal: (...args: unknown[]): Promise<boolean> => {
      openExternalCalls.push({ args });
      return Promise.resolve(true);
    }
  },
  Uri: {
    parse: (value: string): { toString(): string } => ({ toString: () => value })
  },
  window: {
    showErrorMessage: (): Promise<undefined> => Promise.resolve(undefined),
    showWarningMessage: (): Promise<undefined> => Promise.resolve(undefined),
    showInformationMessage: (): Promise<undefined> => Promise.resolve(undefined)
  }
};

type LegacyModuleLoader = (request: string, parent: unknown, isMain: boolean) => unknown;
interface ModuleWithLegacyLoad {
  _load: LegacyModuleLoader;
}

const moduleWithLegacyLoad = Module as unknown as ModuleWithLegacyLoad;
const originalLoad = moduleWithLegacyLoad._load;
moduleWithLegacyLoad._load = function patchedLoad(request, parent, isMain) {
  if (request === "vscode") {
    return fakeVscode;
  }
  return originalLoad.call(Module, request, parent, isMain);
};

export function resetVscodeStubCalls(): void {
  executeCommandCalls.length = 0;
  openExternalCalls.length = 0;
}

export function getExecuteCommandCalls(): readonly RecordedCall[] {
  return executeCommandCalls;
}

export function getOpenExternalCalls(): readonly RecordedCall[] {
  return openExternalCalls;
}

/** Minimal fake satisfying the one `vscode.OutputChannel` member the code under test actually calls. */
export function fakeOutputChannel(): { appendLine(value: string): void; show(): void; lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    appendLine: (value: string) => {
      lines.push(value);
    },
    show: () => {}
  };
}
