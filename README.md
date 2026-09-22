# StackPilot

Your local development control center for VS Code.

StackPilot detects the Django, FastAPI, and React + Vite projects in your
workspace, then gives you native VS Code commands to run, inspect, and
manage them — so day-to-day development stops living in a terminal tab.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.90.0-007ACC?style=flat-square&logo=visualstudiocode&logoColor=white)](https://code.visualstudio.com/)
[![GitHub stars](https://img.shields.io/github/stars/ctrlit-dev/StackPilot?style=flat-square&logo=github)](https://github.com/ctrlit-dev/StackPilot)

Detect your services. Start and stop them. Check project health. Run
framework operations. Scaffold new projects. All without leaving the editor.

## Key features

### Run your stack
Start, stop, and restart detected Django, FastAPI, and Vite dev servers as
processes StackPilot owns and tracks — live status in the tree, dashboard,
and status bar, output in dedicated terminals, and optional auto-restart
after an unexpected crash.

### Understand your project
Read-only, automatic detection of your backend framework, frontend tooling,
Python interpreter/virtual environment, and package manager. A Project
Health view surfaces issues like a missing interpreter, uninstalled
dependencies, or pending Django migrations.

### Work with your framework
Full Django tooling — migrations, Django shell, database shell, superuser
creation, app scaffolding, tests, dependency install, and any `manage.py`
command — plus generic frontend operations (install, build, test, run any
script) for a detected Vite/Node project.

### Create projects
Scaffold a new **Django**, **FastAPI**, or standalone **React + Vite**
project from a single wizard, with presets for adding a Vite + React
(optionally TypeScript) frontend to a Python backend.

### Stay inside VS Code
A dedicated dashboard tab, an activity-bar tree view, a Command Palette
entry for every action, debug configuration generation, and Django/frontend
tests in VS Code's native Testing panel.

## Supported stacks

| Stack | Create | Detect | Run | Framework tools |
|---|---|---|---|---|
| Django | Yes | Yes | Yes | Migrations, shell, DB shell, superuser, app scaffolding, tests, dependency install, management commands |
| FastAPI | Yes | Yes | Yes | None yet |
| React + Vite | Yes | Yes | Yes | Install, build, test (when scripted), run any script |

Frontend tooling supports npm, pnpm, Yarn, and Bun, detected from your
lockfile.

## Quick start

1. Open a workspace containing a supported project — StackPilot detects it
   automatically.
2. Open the dashboard (`Ctrl+Alt+D` / `Cmd+Alt+D`) or use the StackPilot view
   in the Activity Bar.
3. Start everything with **Start All** (`Ctrl+Alt+R` / `Cmd+Alt+R`), or start
   each side individually.

Every action is also available from the Command Palette as `StackPilot: …`.

**Starting from scratch?** Run `StackPilot: New Project…` and choose
Django, FastAPI, or React + Vite.

## Project creation

The **New Project** wizard scaffolds a real project on disk: a virtual
environment and Django/FastAPI project for a Python backend, a Vite
frontend when you add one, a `.gitignore`, README, and minimal
`.vscode/settings.json` — with a review step before anything is created.

- **Django** — plain, or paired with a Vite + React frontend (JavaScript or
  TypeScript), optionally with Django REST Framework.
- **FastAPI** — plain, or paired with a Vite + React + TypeScript frontend.
- **React + Vite** — a standalone frontend project, no backend.

## Project health

StackPilot checks your Python interpreter, framework dependencies (Django
or FastAPI), Node dependencies/package manager, and — for Django — pending
migrations. Results appear in the tree's Diagnostics section and the
dashboard's Project Health panel.

## Local-first

StackPilot is a local development tool. It doesn't deploy anything, doesn't
touch production infrastructure, and doesn't send data anywhere. It only
ever stops processes it started itself, and every setting that affects what
gets executed is a restricted configuration under Workspace Trust.

## Settings

Settings live under `stackPilot.*` (backend/frontend directories, ports,
package manager, auto-restart, and more), are workspace-scoped, and are
searchable from VS Code's Settings UI.

## Known limitations

- FastAPI support currently covers detection, start/stop, and project
  health — it doesn't yet have Django-equivalent tooling (migrations,
  shell, dependency install) or debug configuration generation.
- Testing panel integration is whole-suite, not per-test.
- Automatic dependency-installed detection checks whether the framework
  package is importable, not whether `requirements.txt` exactly matches
  what's installed; Poetry/uv/Pipenv projects are detected but not
  auto-installed.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full picture.

## Development

```sh
npm install
npm run compile
npm test
```

Press `F5` to launch an Extension Development Host. See
[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) for the full workflow and
[`docs/TESTING.md`](docs/TESTING.md) for how the test suite is structured.

## License

[MIT](LICENSE). See [`CHANGELOG.md`](CHANGELOG.md) for release notes.
