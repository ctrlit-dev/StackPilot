# StackPilot

StackPilot is a VS Code extension for local Django + Vite development.
It replaces the repetitive command-line work of running and setting up a
Django backend and a Vite frontend with native VS Code UI: a tree view and a
dashboard showing what is detected and what is running, commands for the
everyday Django/Vite operations, and a wizard for scaffolding a brand-new
Django + Vite project.

It is a **local development tool**. It does not deploy anything, does not
touch production infrastructure, and does not send any data anywhere - see
[Known limitations](#known-limitations) for what is intentionally out of
scope.

## What it does

- **Detects** an existing Django backend, Vite frontend, Python
  interpreter/virtual environment, package manager (npm/pnpm/yarn/bun), and
  Django apps in the open workspace - read-only, bounded to a small set of
  known project layouts, never a general recursive scan.
- **Starts/stops** the Django dev server and the Vite dev server as processes
  this extension owns and tracks, with live status in the tree, dashboard,
  and status bar, and output in dedicated terminals. It never kills a process
  it did not start.
- **Dashboard**: a dedicated editor tab (`StackPilot: Open Dashboard`)
  with server status cards (host:port, a live log preview, Copy URL, Open
  Admin), a migrations-pending indicator, quick-action tiles, the detected
  Django apps, a Recent Activity feed, and a Help tab with a full usage guide.
- Runs the everyday **Django operations**: Make Migrations, Migrate, Show
  Migrations, Django Shell, Database Shell, Create Superuser, Create App
  (offers to register it in `INSTALLED_APPS` automatically), Run Tests,
  Install Python Dependencies, and a generic **Run Management Command** for
  anything else `manage.py` supports.
- Runs the everyday **frontend operations**: Install Dependencies, Build, Run
  Tests (only offered when a matching `package.json` script actually exists),
  and **Run Script…** for any other script in `package.json`.
- **Django apps**: detected apps (folders with `apps.py`, or `models.py` +
  `migrations/`) get their own row with per-app actions - migrations and
  tests scoped to just that app.
- **Environment files**: opens (or creates, seeded from a
  `.env.example`/`.env.sample`/`.env.template`) each side's `.env` - an
  existing `.env` is never overwritten.
- **Debugging**: `Generate Debug Configuration` writes a debugpy + Chrome
  `launch.json` (plus a combined compound when both sides are detected),
  using the interpreter this extension already found.
- **Testing**: Django and frontend tests also appear in VS Code's native
  Testing panel (whole-suite, not per-test - see
  [Known limitations](#known-limitations)).
- **Reliability**: optional auto-restart after an unexpected crash (capped at
  3 attempts with backoff, opt-in per side), and an immediate crash
  notification with Restart/Show Output actions when auto-restart is off.
- **Initializes an existing/cloned project**: shows a checklist of what is
  missing (virtual environment, dependencies, `node_modules`) and lets you
  pick which setup steps to run.
- **Creates a new Django + Vite project** from a wizard: choose a preset
  (Django only / Django + Vite React / Django + Vite React + TypeScript /
  Django REST API + Vite React + TypeScript), review a summary, then a real
  virtual environment, Django project, and Vite frontend are scaffolded with
  a `.gitignore`, README, `docs/` folder, minimal `.vscode/settings.json`,
  and optional `git init`.

## Supported workflows

| Workflow | How |
|---|---|
| Open an existing Django/Vite project | Open the folder; detection runs automatically. |
| Start developing | `Start All` (`Ctrl+Alt+R` / `Cmd+Alt+R`), or start backend/frontend individually. |
| Get an overview at a glance | `StackPilot: Open Dashboard` (`Ctrl+Alt+D` / `Cmd+Alt+D`). |
| Run a migration | `StackPilot: Migrate`, or click the "Unapplied migrations" hint in the dashboard. |
| Open the running app | `StackPilot: Open Application` (external browser) or `Open in Simple Browser` (inside VS Code). |
| Open the Django admin | `StackPilot: Open Admin`, once the backend is running. |
| Run any manage.py command | `StackPilot: Run Django Management Command…`. |
| Set up a project you just cloned | `StackPilot: Initialize Project`. |
| Start a brand-new project | `StackPilot: New Django + Vite Project…`. |
| Generate a debug config | `StackPilot: Generate Debug Configuration`. |

Every action above is also a Command Palette entry named
`StackPilot: …`; the tree and dashboard are conveniences, not the only
way in.

## Keyboard shortcuts

| Shortcut (Win/Linux) | Shortcut (macOS) | Action |
|---|---|---|
| `Ctrl+Alt+R` | `Cmd+Alt+R` | Start All |
| `Ctrl+Alt+Shift+R` | `Cmd+Alt+Shift+R` | Stop All |
| `Ctrl+Alt+D` | `Cmd+Alt+D` | Open Dashboard |

Rebind any of these from VS Code's Keyboard Shortcuts editor.

## Installation for development

```sh
npm install
```

Then press `F5` in VS Code to launch an Extension Development Host with the
extension loaded. See [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) for the
full development workflow and [`docs/TESTING.md`](docs/TESTING.md) for how
the test suite is structured.

Quality checks:

```sh
npm run compile
npm run lint
npm run test:unit
npm run test:integration
```

## Installing a local `.vsix`

```sh
npm run vsix
code --install-extension stackpilot-0.0.1.vsix
```

(or use the Extensions view's "Install from VSIX..." command). This is not
yet published to the Marketplace.

## Settings

All settings live under `stackPilot.*` and are workspace-scoped. Every
path setting is relative to the selected workspace folder unless it is
already absolute. Every setting in the table below is also a *restricted*
configuration under Workspace Trust, so an untrusted workspace's
`.vscode/settings.json` cannot redirect what gets executed or where.

| Setting | Default | Purpose |
|---|---|---|
| `stackPilot.backend.directory` | `backend` | Django backend directory. |
| `stackPilot.backend.managePy` | `backend/manage.py` | Path to `manage.py`, overrides auto-detection. |
| `stackPilot.python.interpreter` | *(empty)* | Explicit interpreter path; leave empty to auto-detect a venv or PATH interpreter. |
| `stackPilot.python.venvDirectory` | `backend/.venv` | Preferred virtual environment location (also used by Create Virtual Environment). |
| `stackPilot.frontend.directory` | `frontend` | Vite frontend directory. |
| `stackPilot.frontend.packageManager` | `auto` | `auto`, `npm`, `pnpm`, `yarn`, or `bun`. |
| `stackPilot.frontend.devScript` | `dev` | `package.json` script used to start the frontend. |
| `stackPilot.frontend.buildScript` | `build` | `package.json` script used for Build Frontend. |
| `stackPilot.frontend.testScript` | `test` | `package.json` script used for Run Frontend Tests, if present. |
| `stackPilot.backend.host` | `127.0.0.1` | Host for `manage.py runserver`. |
| `stackPilot.backend.port` | `8000` | Port for the Django dev server. |
| `stackPilot.frontend.port` | `5173` | Preferred Vite port (Vite may still pick a different one). |
| `stackPilot.openBrowserOnStart` | `false` | When `true`, offers an "Open in Browser" button after a server starts successfully; a browser is never opened without that explicit click. |
| `stackPilot.backend.autoRestartOnCrash` | `false` | Automatically restart the Django server after an unexpected exit (not a manual stop). Gives up after 3 consecutive crashes. |
| `stackPilot.frontend.autoRestartOnCrash` | `false` | Same as above, for the frontend server. |

## Known limitations

- **pnpm/yarn/bun New Project scaffolding** is implemented per Vite's
  official documentation but was not independently smoke-tested in the
  environment this was built in (only npm was installed there); npm's
  scaffold path was verified against the real tool.
- **Vite's actual dev server URL** is parsed from its own stdout
  (`Local: http://...`) once available; until the first such line arrives,
  `Open Application` falls back to the configured port, which Vite may not
  actually be using if that port was busy.
- **New Project cancellation** stops the run before the next step starts; a
  step already in progress (e.g. a slow `pip install`) still completes first
  rather than being aborted mid-flight.
- **Automatic Python-dependency-installed detection** (used by `Initialize
  Project`) checks whether Django is importable from the virtual
  environment's `site-packages`, not whether `requirements.txt` exactly
  matches what is installed - parsing arbitrary `requirements.txt` syntax
  (version specifiers, extras, `-r` includes, environment markers) reliably
  was judged too fragile to be worth the risk of a wrong answer.
- **Poetry/uv/Pipenv projects**: `Install Python Dependencies` recognizes
  these (via `pyproject.toml`/`uv.lock`/`poetry.lock`/`Pipfile`) and
  deliberately refuses to run a guessed `pip install` against them rather
  than doing the wrong thing; install those dependencies with that tool
  directly.
- **Django app detection** is filesystem-based (`apps.py`, or `models.py` +
  `migrations/`), not a parse of `INSTALLED_APPS` in `settings.py` - the
  latter can be split across modules or computed dynamically, which was
  judged too fragile to parse reliably.
- **`INSTALLED_APPS` auto-registration** only handles a single, plain
  multi-line list in exactly one `settings.py` it can find unambiguously; it
  never guesses when the file, or the list, isn't in that shape - you get a
  message to add the app yourself instead.
- **Migrations-pending indicator** is powered entirely by `manage.py migrate
  --check`'s exit code (0/1), not a parsed migration count - Django's own
  flag doesn't report one. A database that is unreachable can also exit
  non-zero; the indicator only shows "pending" when stderr is empty, but a
  genuinely broken database connection may still need a look at Show Output.
- **Test Explorer integration** is whole-suite, not per-test: Django's runner
  and whichever frontend framework is in use each have their own output
  format, and reliably parsing every one of them into a per-test tree wasn't
  realistic to get right.
- **Integration tests** (`npm run test:integration`) require a real
  Electron-capable environment; see [`docs/TESTING.md`](docs/TESTING.md) for
  a sandbox limitation encountered while building this extension.
- No production/deployment operations of any kind are provided or planned -
  this is a local development tool only.

## License

[MIT](LICENSE). See [`CHANGELOG.md`](CHANGELOG.md) for release notes.
