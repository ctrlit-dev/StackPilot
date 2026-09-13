# Architecture

StackPilot is a VS Code extension. This document explains how it is put
together: detection, process ownership, execution strategy, state model, and
security boundaries.

## Layering

```text
src/
├── extension.ts       composition/bootstrap only - wires everything below
├── adapters/            framework-specific knowledge (e.g. Django's start command)
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

## Framework adapters

`ProcessManager` (see below) knows services, not frameworks: it starts and
tracks a `ServiceId` given an `executable`/`args`/`cwd`, with zero knowledge
of Django, Vite, or anything else. The framework-specific knowledge that
decides *what* that `executable`/`args`/`cwd` should be for a given backend
framework lives in `adapters/` instead - today just
`adapters/djangoBackendAdapter.ts`, behind the `BackendFrameworkAdapter`
contract (`adapters/backendFrameworkAdapter.ts`). The adapter does not
execute anything itself - it only builds descriptors (`StartProcessOptions`,
`OneShotCommandOptions`, `InteractiveShellInvocation`) or validates a piece
of input about to become part of one; spawning, terminals, Workspace Trust,
and state all remain exactly where they were. `BackendFrameworkAdapter`
currently covers two responsibility groups:

1. **the backend start descriptor** (`buildStartCommand` -
   `<python> manage.py runserver <host>:<port>`), and
2. **backend framework-specific operation descriptors / validation**
   (`buildMigrateCommand`, `buildMakeMigrationsCommand`,
   `buildShowMigrationsCommand`, `buildTestCommand`,
   `buildManagementCommand` (the free-form manage.py escape hatch),
   `validateAppName`/`buildStartAppCommand`, and the interactive
   `buildShellInvocation`/`buildDatabaseShellInvocation`/
   `buildCreateSuperuserInvocation`).

Framework-specific operations retain their concrete invocation types
(`OneShotCommandOptions` for one-shot commands, `InteractiveShellInvocation`
for anything needing real stdin) rather than being collapsed into one
generic, data-driven operation model - there is currently no generic
operation registry, and none is planned until a second backend framework
makes a real, observed pattern worth generalizing.
`commands/startPlans.ts`'s `planBackendStart()` and
`commands/backendOperationPlans.ts`'s plan functions decide *whether* an
operation is possible (backend/Python detected, input valid) and delegate to
an injected `BackendFrameworkAdapter` for the descriptor shape; neither has
Django knowledge of its own. The adapter is wired in once, explicitly, at the
composition root (`extension.ts` passes `djangoBackendAdapter` into
`CommandContext` and into `MigrationStatusController`) - there is no adapter
registry yet, since exactly one backend framework exists today.

**`ServiceId` and `FrameworkAdapterId` are deliberately different types and
must never be compared or unioned.** A `ServiceId` (`"backend"`, `"frontend"`,
later perhaps `"worker"`) names a process slot `ProcessManager` tracks; a
`FrameworkAdapterId` (`"django"`, `"vite"`) names which framework's rules
built that process's command or parsed its output. Which adapter backs a
given service is a decision made above `ProcessManager` (currently: `backend`
always uses `djangoBackendAdapter`, `frontend`'s dev-server-URL tracking
always uses `viteFrontendAdapter`), not something the id strings themselves
encode. `FrameworkAdapterId` itself is shared (`adapters/frameworkAdapterId.ts`)
since the id concept is the same regardless of adapter kind.

There is also a `FrontendFrameworkAdapter` contract
(`adapters/frontendFrameworkAdapter.ts`), implemented by
`adapters/viteFrontendAdapter.ts` - but it is **intentionally much smaller**
than `BackendFrameworkAdapter`: a single `parseDevServerUrl(outputChunk)`
method. Adapters are capability-driven, not forced into symmetry - Django and
Vite genuinely need different things. Almost everything about running a
frontend (package manager choice, `dev`/`build`/`test`/arbitrary script
execution) is already generic Node/package-manager logic
(`execution/frontendCommand.ts`, `commands/frontendOperationPlans.ts`) and
stays outside any adapter; the one real Vite-specific behavior is reading the
dev server's actual bound URL from its own colored stdout (`"Local: ..."`),
because Vite may not end up on the configured port and every dev server
reports this differently. `execution/frontendUrlTracker.ts` stays a generic
output/state tracker (accumulate a bounded buffer, remember the result,
`reset()`) with the adapter injected via its constructor - it has no idea
what Vite's output looks like.

Django app detection (`detectDjangoApps`) and the New Project scaffold wizard
are unchanged and still live where they did before.

**Framework runtime behavior and framework detection evidence are separate
concerns.** `BackendFrameworkAdapter`/`FrontendFrameworkAdapter` answer "given
an already-detected project, how do I run/observe it"; `BackendFrameworkDetection`
(`adapters/backendFrameworkDetection.ts`) and `FrontendFrameworkDetection`
(`adapters/frontendFrameworkDetection.ts`) answer the earlier, read-only
question "does this framework exist in this workspace, and where" -
`adapters/djangoBackendDetection.ts` and `adapters/viteFrontendDetection.ts`
answer it for Django and Vite. They are deliberately not methods on the
runtime adapters: every `BackendFrameworkAdapter` method is a synchronous,
pure descriptor builder for an *already-selected* project, while detection is
asynchronous, touches the filesystem via the existing `FileSystemProbe`, and
runs *before* any project is selected - a different shape, not a missing
method on the same interface. `detection/backendDetector.ts` and
`detection/frontendDetector.ts` still own everything framework-neutral: root
candidate orchestration, symlink/workspace-escape safety
(`detection/fileSystem.ts`'s `checkCandidatePath`), generic Python-packaging
evidence and scoring (backend), and `package.json`/script/package-manager
handling (frontend) - they now just delegate the one framework-specific
question ("where is this framework's own marker?") to the injected detection
capability instead of knowing `manage.py`/`vite.config.*` themselves.
**Filename markers are evidence used by the current Django/Vite
implementations, not the universal framework-detection abstraction** - a
future framework whose evidence is a dependency name inside
`pyproject.toml`/`requirements.txt` rather than a single marker file (FastAPI,
say) implements the exact same `detect()`/`findFrameworkConfigPath()`
contract with a completely different internal strategy, no change to
`backendDetector.ts`/`frontendDetector.ts` required.

Runtime detection (Python interpreter/venv, Node package manager) stays
entirely separate and unchanged (`detection/pythonDetector.ts`,
`detection/packageManagerDetector.ts`) - it answers "what executes this
project", never "which framework is this".

The project model stays intentionally legacy-shaped for now:
`DetectedProject`/`BackendProject`/`FrontendProject` are unchanged, and
`BackendProject.managePyPath`/`FrontendProject.viteConfigPath` keep their
Django/Vite-specific field names - the detection capabilities' own result
types use framework-neutral names (`frameworkEntryPath`), and
`detection/backendDetector.ts`/`detection/frontendDetector.ts` map that
result into the legacy field when building the final `BackendProject`/
`FrontendProject`. Generalizing the project model itself is separate,
later work.

There is intentionally no detection registry or scoring engine here either -
exactly two real frameworks exist, wired directly at the composition root
(`extension.ts` passes `djangoBackendDetection`/`viteFrontendDetection` into
`detection/projectDetector.ts`'s `detectProject()`), and detection stays
fully deterministic.

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

`execution/processManager.ts` is the single source of truth for whether a
managed development service is running. `ProcessManager` itself knows nothing
about Django, Vite, or any other framework - it only knows a service id
(`ServiceId`, a plain `string` alias defined in `execution/serviceRegistry.ts`)
and how to run/track a process for it (`executable`/`args`/`cwd`/lifecycle).
Today exactly two services exist in practice - `backend` and `frontend` - but
that is a fact about `DEFAULT_SERVICE_REGISTRY`'s contents, not something
`ProcessManager` hard-codes: `start()`/`stop()` work for any `ServiceId`, and
`startAll()`/`stopAll()` iterate whatever `ServiceRegistry` was injected into
the constructor (defaulting to `DEFAULT_SERVICE_REGISTRY` so existing callers
are unaffected). Adding a third service (a database, a worker, ...) later is
a matter of constructing a `ServiceRegistry` with more ids, not a change to
this class. `ServiceRegistry` is deliberately minimal - just an ordered list
of ids, answering only "which services exist" - it does not grow into a
generic `ServiceDefinition` bag; a service's *behavior* (auto-restart,
crash-notification label/action) is a separate concern, described next.

`ProcessManager` never shells out to a string command: every spawn goes
through `ProcessSpawner` (`execution/processSpawner.ts`), whose real
implementation (`nodeProcessSpawner.ts`) uses `cross-spawn` with
`shell: false` throughout. `cross-spawn` (rather than `child_process.spawn`
directly) exists specifically because Windows cannot execute `.cmd`/`.bat`
files (npm/pnpm/yarn ship as such) without a shell, and Node's own
shell-based workaround for that is the exact vulnerability class behind
CVE-2024-27980/36138 ("BatBadBut").

`ProcessManager` tracks state per service id as
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

**Service lifecycle policy is keyed by `ServiceId`, not `FrameworkAdapterId`.**
`AutoRestartController` (restart on an unexpected crash, bounded by
`crashLoopPolicy.ts`'s fixed attempt/backoff rules, unchanged) and
`CrashNotificationController` (the crash toast with Restart/Show Output
actions) used to each carry their own `kind === "backend" ? ... : ...`
ternary for "is auto-restart on" and "what do I call this service". Both now
take an injected `ServiceLifecyclePolicyProvider`
(`execution/serviceLifecyclePolicy.ts`) instead - `getPolicy(serviceId)`
returns `{ autoRestartEnabled, displayName, restartCommandId? }`. Neither
controller branches on a service id itself anymore, and `ProcessManager`
remains unaware of display labels, VS Code commands, or configuration - it
never gained a dependency on this provider. The real, product-composed
provider (`createDefaultServiceLifecyclePolicyProvider`) still reads the
pre-existing `stackPilot.backend.autoRestartOnCrash`/
`stackPilot.frontend.autoRestartOnCrash` settings verbatim (no config
migration) and re-reads `ProjectStateStore` on every call rather than a
snapshot, preserving the pre-existing "current config at crash time"
behavior. **Unknown services use an explicit safe fallback
(`fallbackServiceLifecyclePolicy`: auto-restart off, the raw id as its own
display name, no restart command) rather than ever inheriting frontend's
policy** - a service the provider does not specifically recognize used to
silently fall down the `: "Frontend"` branch of the old ternary; it no
longer can.

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
