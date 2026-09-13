# Architecture

StackPilot is a VS Code extension. This document explains how it is put
together: detection, process ownership, execution strategy, state model, and
security boundaries.

## Layering

```text
src/
├── extension.ts       composition/bootstrap only - wires everything below
├── detection/          read-only: find Django/Vite/Python/package manager
├── execution/           run things: process spawning, lifecycle, terminals
├── project/             mutate things: New Project scaffold, file writing
├── commands/             vscode.commands.registerCommand handlers
├── ui/                    tree view model + provider, notifications
├── state/                shared in-memory state (detection result, context keys)
├── config/                reads/validates stackPilot.* settings
├── security/              Workspace Trust gate
└── utils/                  small path helpers shared across layers
```

The dependency direction is `commands/ui` → `execution`/`project` →
`detection`/`config`. `detection/` never imports from `execution/` or
`commands/`, and it is the only layer with a hard "must not mutate anything"
rule (see below).

Almost every module in `detection/`, `execution/`, and `project/` is split
into a **pure/testable half** (a function or class taking its dependencies as
constructor/argument injection) and a **thin real adapter** (a `Node*` class
implementing the same interface with real I/O). This is why the unit test
suite can cover process lifecycle, scaffold orchestration, and file
generation without ever touching a real process or the real filesystem - the
adapters are the only code that talks to Node/OS APIs directly, and they are
kept intentionally small.

## Detection (read-only)

`detection/projectDetector.ts` composes four independent detectors -
`backendDetector`, `frontendDetector`, `pythonDetector`, and
`packageManagerDetector` - each returning `{ candidates, selected, diagnostics }`
rather than throwing, so a missing or ambiguous project is a normal, fully
representable result, not an error path bolted on afterward.

Detection is deliberately **not** a general recursive filesystem scan. Each
detector checks a small, fixed set of candidate locations (spec-listed:
`manage.py`, `backend/manage.py`, `server/manage.py`, `api/manage.py`;
`frontend/`, `client/`, `web/`, `.`; etc.), which is what keeps it fast and
bounded on large workspaces without needing directory-walk depth limits.

All filesystem access in this layer goes through `FileSystemProbe`
(`detection/fileSystem.ts`) - `fileExists`, `directoryExists`, `readTextFile`,
`realPath`, `listDirectoryNames`. It has exactly one real implementation
(`NodeFileSystemProbe`) and is never given a write method; detection code
cannot mutate a workspace even by accident. `realPath` exists specifically so
a candidate that is itself a symlink pointing outside the workspace is
rejected after resolution, not just by a lexical string check.

## Process ownership and execution strategy

`execution/processManager.ts` is the single source of truth for whether the
managed backend or frontend dev server is running. It never shells out to a
string command: every spawn goes through `ProcessSpawner`
(`execution/processSpawner.ts`), whose real implementation
(`nodeProcessSpawner.ts`) uses `cross-spawn` with `shell: false` throughout.
`cross-spawn` (rather than `child_process.spawn` directly) exists specifically
because Windows cannot execute `.cmd`/`.bat` files (npm/pnpm/yarn ship as
such) without a shell, and Node's own shell-based workaround for that is the
exact vulnerability class behind CVE-2024-27980/36138 ("BatBadBut").

`ProcessManager` tracks state per kind (`backend` | `frontend`) as
`stopped | starting | running | stopping | failed | unknown` and blocks a
duplicate start via a synchronous check-and-transition before the first
`await` in `start()` - JavaScript's run-to-completion semantics mean two
rapid calls cannot both observe "not yet starting", so no separate lock is
needed. Stopping never uses a broad, name-based kill (`taskkill /IM
python.exe` or similar): on Windows it uses `taskkill /pid <pid> /t /f`
against the exact tracked PID and its tree; on POSIX it signals the process
group. This is what "extension-owned process boundary" means in practice - the
manager can only ever affect a process it personally spawned.

One-shot commands (migrations, `pip install`, `npm run build`, the New
Project scaffold steps) reuse the same `ProcessSpawner`, via
`execution/oneShotCommand.ts`, so a real, previously-verified quirk is handled
in exactly one place: on Windows, `cross-spawn` can report a successful
`spawn` for an unresolvable executable (it wraps it in `cmd.exe`) and only
discover the failure later via a translated exit event - `runOneShotCommand`
treats that delayed signal as a failure rather than silently believing the
command started successfully.

Visible output goes through two small terminal managers, both built on
`vscode.Pseudoterminal`: `ServerTerminalManager` for the persistent
backend/frontend servers (one reused terminal per kind, never recreated per
click) and `OperationTerminal` for one-shot commands (one shared terminal).
Genuinely interactive flows - Django Shell, Create Superuser - instead use a
real `vscode.window.createTerminal({ shellPath, shellArgs })`, because they
need real stdin (a REPL, a password prompt) that a captured child process or
an output-only Pseudoterminal cannot provide.

## New Project scaffolding (the one layer allowed to mutate)

`project/` is the only part of the extension that creates files outside of
what the user explicitly asked to run. It uses a distinct, separately-typed
`ProjectFileWriter` (write methods only: `createDirectory`, `writeTextFile`,
`removePath`) instead of extending `FileSystemProbe`, so the read-only
detection contract is never weakened.

Scaffolding is modeled as an ordered list of `ScaffoldStep` objects
(`project/scaffoldStep.ts`), each reporting exactly which top-level paths it
newly created. `executeScaffoldSteps` runs them in order and stops at the
first failure (or cancellation), returning the paths created so far. Cleanup
after a failure only ever deletes paths from that list, is not automatic, and
requires an explicit, itemized user confirmation - a path that pre-existed
before the wizard ran is never a candidate for deletion.

## State model

`state/projectState.ts` (`ProjectStateStore`) holds the current detection
result, configuration, and workspace-selection state, refreshed by
`extension.ts` on startup, configuration changes, workspace-folder changes,
and workspace-trust changes. `execution/processManager.ts`'s own state is
separate and event-driven (`onDidChangeState`, `onDidReceiveOutput`); the
sidebar tree (`ui/stackPilotTreeModel.ts` - a pure function from state to
a plain tree model, wrapped by a thin `vscode.TreeDataProvider`) and VS
Code's context keys (`state/contextKeys.ts`) both subscribe to both stores
rather than each other, so there is one place that knows "is anything
running" and one place that knows "what does the workspace look like".

## Security boundaries

- **Workspace Trust**: `security/workspaceTrust.ts`'s
  `ensureTrustedForExecution()` gates every command that spawns a process.
  Detection still runs in an untrusted workspace (it is read-only), but
  nothing executes until the user trusts the workspace.
- **No shell string building**: every process invocation is an
  executable + argv array. User-influenced values (Django app/project names)
  are validated against a strict ASCII-identifier allowlist
  (`commands/djangoIdentifierValidation.ts`) before they are ever used as an
  argument, which also happens to reject shell metacharacters, Unicode, and
  whitespace as a side effect of only accepting identifier characters.
- **Bounded, confirmed destruction**: the only recursive-delete capability in
  the codebase (`NodeProjectFileWriter.removePath`) is called from exactly
  one place, after an explicit, itemized confirmation dialog.
