# Architecture

StackPilot is a VS Code extension. This document explains how it is put
together: detection, process ownership, execution strategy, state model, and
security boundaries.

## Layering

```text
src/
├── extension.ts       composition/bootstrap only - wires everything below
├── serviceId.ts          the ServiceId vocabulary, shared by detection/ and execution/
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
of Django, FastAPI, Vite, or anything else. The framework-specific knowledge
that decides *what* that `executable`/`args`/`cwd` should be for a given
backend framework lives in `adapters/` instead -
`adapters/djangoBackendAdapter.ts` and `adapters/fastApiBackendAdapter.ts`
today, behind a split contract in `adapters/backendFrameworkAdapter.ts`:

- **`BackendStartAdapter`** - the minimal, shared capability every backend
  framework needs: `id` (`FrameworkAdapterId`) plus `buildStartCommand`
  (`<python> ...` → `StartProcessOptions`). `fastApiBackendAdapter` (builds
  `python -m uvicorn <appImport> --host <host> --port <port>`) implements
  exactly this and nothing else.
- **`BackendFrameworkAdapter extends BackendStartAdapter`** - adds Django's
  fuller set of framework-specific operations (`buildMigrateCommand`,
  `buildMakeMigrationsCommand`, `buildShowMigrationsCommand`,
  `buildTestCommand`, `buildManagementCommand` (the free-form manage.py
  escape hatch), `validateAppName`/`buildStartAppCommand`, and the
  interactive `buildShellInvocation`/`buildDatabaseShellInvocation`/
  `buildCreateSuperuserInvocation`). `djangoBackendAdapter` is the only
  implementation.

This split exists because trying to write a second, real backend framework
adapter (FastAPI) against the original single `BackendFrameworkAdapter`
interface would have forced it to implement nine Django-only methods as
dummies or throws - a fictitious "FastAPI migrate command" existing only to
satisfy a type. `BackendStartAdapter` names the one capability every backend
framework actually needs (start); the other nine belong to Django
specifically and are not generalized until a second framework genuinely
needs an equivalent. `buildStartCommand` itself takes the full
`DetectedService` (not a Django-shaped `BackendProject`) so each adapter
extracts only the facts it needs via its own metadata helper
(`getDjangoMetadata`/`getFastApiMetadata`) - Django reconstructs
`managePyPath`, FastAPI reads `appImport`, and no caller needs to build a
Django-shaped object to start a FastAPI service.

The adapter does not execute anything itself - it only builds descriptors
(`StartProcessOptions`, `OneShotCommandOptions`, `InteractiveShellInvocation`)
or validates a piece of input about to become part of one; spawning,
terminals, Workspace Trust, and state all remain exactly where they were.

`commands/startPlans.ts`'s `planBackendStart()` and
`commands/backendOperationPlans.ts`'s plan functions decide *whether* an
operation is possible (backend/Python detected, input valid) and delegate to
an injected adapter for the descriptor shape; neither has Django or FastAPI
knowledge of its own. `resolveBackendStartAdapter` (`commands/startPlans.ts`)
is the one explicit "selection boundary" function that picks the registered
`BackendStartAdapter` matching the detected service's `frameworkId` - a plain
array lookup (`backendStartAdapters.find((a) => a.id === frameworkId)`), not
a registry class, acceptable specifically because exactly two backend
frameworks exist. Django's nine operation-specific plans still take
`djangoBackendAdapter` directly and unconditionally (wired once into
`CommandContext.backendAdapter`) since FastAPI has no equivalent operations
in scope - they safely report `no-backend` rather than spawn anything when
the detected backend's `frameworkMetadata` isn't actually Django's (see
`getDjangoBackendProject` below), never a fabricated Django command against a
FastAPI project.

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
**Filename markers are evidence used by the Django/Vite implementations, not
the universal framework-detection abstraction** - `adapters/fastApiBackendDetection.ts`
is the proof: its evidence is a dependency name inside
`pyproject.toml`/`requirements.txt` *combined with* an application marker
(`"FastAPI("`) inside a bounded, documented set of entry-point candidates
(`main.py`, `app/main.py`), not a single marker file, and it implements the
exact same `BackendFrameworkDetection` contract with a completely different
internal strategy - no change to `backendDetector.ts` was required. Detection
deliberately stays evidence-based rather than scored: `main.py` alone is
never sufficient, since a bare script with that name proves nothing about
FastAPI; only the combination of dependency evidence and application
evidence, both independently checked facts, qualifies a candidate.

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
`FrontendProject`. The project model built from their results is generalized
separately - see "Project model" below.

There is intentionally no detection registry or scoring engine here either.
`detection/projectDetector.ts`'s `detectProject()` takes an ordered
`readonly BackendFrameworkDetection[]` (wired at the composition root,
`extension.ts`, as `[djangoBackendDetection, fastApiBackendDetection]`) and
tries each in order, stopping at the first one that returns a non-empty
result - first-match-wins, not a scored comparison. Django is registered
first specifically so a workspace that (unusually) satisfies both Django's
and FastAPI's evidence still resolves to Django, never a redesign of Django's
own detection to "compete" with a later framework. Frontend detection is
unchanged (`viteFrontendDetection` alone) - only backend framework detection
needed to become a list, since only backend has a second implementation
today.

## Project model

`DetectedProject` is service-oriented rather than framework-field-oriented:
`{ workspaceRootPath, services: readonly DetectedService[], pythonRuntime,
diagnostics }` (`detection/detectedProject.ts`), not the old
`{ backend, frontend, python, djangoApps }`. Four separate concepts, each
with a narrow, real reason to exist:

- **Project** - `DetectedProject` itself, the whole-workspace result.
- **Service** - `DetectedService` (`id`, `rootPath`, `score`, `evidence`), a
  detected development component. `id` is a `ServiceId` ("backend",
  "frontend", later perhaps "worker") - the same `ServiceId`
  `ProcessManager` and `ServiceRegistry` use, not a different vocabulary
  reinvented here (both now import it from the shared `src/serviceId.ts`,
  since `detection/` must not import from `execution/`).
- **Runtime** - `DetectedService.runtime` (`RuntimeReference`: a
  `PythonRuntimeReference` carrying the full `PythonDetectionResult`, or a
  `NodeRuntimeReference` carrying the package manager, `package.json` path,
  and scripts). What executes the service.
- **Framework** - `DetectedService.frameworkId` (a `FrameworkAdapterId`,
  e.g. `"django"`/`"fastapi"`/`"vite"`) plus, only where a framework actually
  has structured facts worth carrying, `DetectedService.frameworkMetadata`:
  `DjangoServiceMetadata` (`managePyPath` + `apps`) or `FastApiServiceMetadata`
  (`appImport`, uvicorn's `module:attr` reference, e.g. `"app.main:app"`).
  Both back the **same** `"backend"` `ServiceId` - proof that a `ServiceId`
  and a `FrameworkAdapterId` really are independent axes, not that every
  service gets its own id per framework. No `ViteServiceMetadata` exists -
  nothing outside `frontendDetector.ts`'s own scoring ever consumed
  `viteConfigPath` after detection, so it was not carried into the
  generalized model at all (code truth decided this, not a symmetry
  assumption).

**`ServiceId` and `FrameworkAdapterId` stay separate here too**: a service's
id is never compared against or derived from its `frameworkId`. **A
framework can back more than one service**, and **a project can eventually
hold multiple services on the same runtime kind** (two Python services, say)
without any structural change - nothing about `DetectedProject` assumes
exactly one Python or one Node service exists.

`FrameworkMetadata` is a union discriminated by its own `kind` field, not by
`frameworkId` - `FrameworkAdapterId` is an open `string` (any adapter can
register with any id), so it can never give TypeScript a closed, checkable
discriminant the way a small, explicit union's own tag can. Reading
Django-specific facts safely goes through `getDjangoMetadata(service)`
(narrows on `frameworkMetadata.kind === "django"`), and FastAPI's the same
way through `getFastApiMetadata(service)` (narrows on
`frameworkMetadata.kind === "fastapi"`) - never a cast on `frameworkMetadata`
directly. `getDjangoBackendProject(service)` additionally reconstructs the
legacy `BackendProject` shape Django's own nine operation methods still take,
so Django command/plan code has one type-safe entry point instead of building
that shape inline at every call site; it returns `undefined` for a
FastAPI-detected backend exactly like a missing one, which is how Django-only
commands (Migrate, Django Shell, ...) safely refuse to run - no process
spawn, no fabricated `manage.py` path - against a backend that was actually
detected as FastAPI. Adding FastAPI's structured fact (its app-module path)
required exactly one more variant on `FrameworkMetadata` and one more
`getXMetadata()` helper, confirming the design intent this paragraph
described before FastAPI existed: not redesigning `DetectedService` or
`DetectedProject`.

`DetectedProject.pythonRuntime` is a deliberate, documented exception to
"only on the service that needs it": existing UI (the tree's Environment
section) shows Python status independent of whether a backend service was
detected at all, and venv (re)creation (`findBasePython`) has never required
one either. It is not a second source of truth for the same fact - when a
backend service exists, its `runtime` points at this exact same
`PythonDetectionResult` object, not a copy.

`BackendProject`/`FrontendProject` (`detection/backendDetector.ts`/
`detection/frontendDetector.ts`) still exist, but only as those detectors'
own internal candidate/result shapes - `detection/projectDetector.ts` is the
one place that shapes their output into `DetectedService`s; nothing else in
the codebase depends on `BackendProject`/`FrontendProject` as the project's
public shape anymore.

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
