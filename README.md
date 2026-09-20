# StackPilot

Your local development control center for VS Code.

> **0.1.0 is a Public Preview.** Core workflows are covered by an extensive
> automated test suite and manual verification, but the extension is early
> — expect rough edges, and please [report anything unexpected](https://github.com/ctrlit-dev/StackPilot/issues).

StackPilot detects the Django, FastAPI, Express, React + Vite, and Next.js
projects in your workspace, then gives you native VS Code commands to run,
inspect, and manage them — so day-to-day development stops living in a
terminal tab.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.90.0-007ACC?style=flat-square&logo=visualstudiocode&logoColor=white)](https://code.visualstudio.com/)
[![GitHub stars](https://img.shields.io/github/stars/ctrlit-dev/StackPilot?style=flat-square&logo=github)](https://github.com/ctrlit-dev/StackPilot)

Detect your services. Start and stop them. Check project health. Run
framework operations. Scaffold new projects. All without leaving the editor.

## Key features

### Run your stack
Start, stop, and restart detected Django, FastAPI, Express, Vite, and
Next.js dev servers as processes StackPilot owns and tracks — live status
in the tree, dashboard, and status bar, output in dedicated terminals, and
optional auto-restart after an unexpected crash.

### Understand your project
Read-only, automatic detection of your backend framework, frontend tooling,
Python interpreter/virtual environment, and package manager. A Project
Health view surfaces issues like a missing interpreter, uninstalled
dependencies, or pending Django migrations.

### Work with your framework
Full Django tooling — migrations, Django shell, database shell, superuser
creation, app scaffolding, tests, dependency install, and any `manage.py`
command — plus generic frontend operations (install, build, test, run any
script) for a detected Vite/Next.js/Node project. FastAPI and Express
currently cover start/stop/restart and diagnostics, not the Django-specific
tooling above.

### Create projects
Scaffold a new **Django**, **FastAPI**, **Express**, standalone
**React + Vite**, or **Next.js** project from a single wizard, with presets
for adding a Vite + React (optionally TypeScript) frontend to a Python or
Express backend.

### Stay inside VS Code
A dedicated dashboard tab, an activity-bar tree view, a Command Palette
entry for every action, debug configuration generation, and Django/frontend
tests in VS Code's native Testing panel.

## Supported stacks

| Stack | Create | Detect | Run | Framework tools |
|---|---|---|---|---|
| Django | Yes | Yes | Yes | Migrations, shell, DB shell, superuser, app scaffolding, tests, dependency install, management commands |
| FastAPI | Yes | Yes | Yes | None yet |
| Express | Yes | Yes | Yes | None yet |
| React + Vite | Yes | Yes | Yes | Install, build, test (when scripted), run any script |
| Next.js | Yes | Yes | Yes | Install, build, test (when scripted), run any script |

Django is the only framework with migration/shell/superuser-style tooling
today — FastAPI and Express currently cover detection, dev-server
lifecycle, and diagnostics only. Next.js runs as its own frontend service,
with the same generic frontend operations as Vite.

Frontend tooling works with npm, pnpm, yarn, or bun, detected from your
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
Django, FastAPI, Express, React + Vite, or Next.js.

## Project creation

The **New Project** wizard scaffolds a real project on disk: a virtual
environment and Django/FastAPI project for a Python backend, an Express
backend, a Vite or Next.js frontend, a `.gitignore`, README, and minimal
`.vscode/settings.json` — with a review step before anything is created.

- **Django** — plain, or paired with a Vite + React frontend (JavaScript or
  TypeScript), optionally with Django REST Framework.
- **FastAPI** — plain, or paired with a Vite + React + TypeScript frontend.
- **Express** — plain, or paired with a Vite + React + TypeScript frontend.
- **React + Vite** — a standalone frontend project, no backend.
- **Next.js** — a standalone frontend project (App Router, TypeScript), no
  backend.

## Project health

StackPilot checks your Python interpreter, framework dependencies (Django
or FastAPI), Node dependencies/package manager, and — for Django — pending
migrations. Results appear in the tree's Diagnostics section and the
dashboard's Project Health panel.

## Prerequisites

- VS Code 1.90 or newer.
- Python 3, for Django or FastAPI projects.
- Node.js and a package manager (npm, pnpm, yarn, or bun), for Express,
  Vite, or Next.js projects.

Developed and most thoroughly tested on Windows. macOS and Linux use the
same code paths but have not been independently verified.

## Local-first

StackPilot is a local development tool. It doesn't deploy anything and
doesn't touch production infrastructure. StackPilot itself collects no
telemetry or analytics and doesn't send your code or project data anywhere.
It only ever stops processes it started itself, and every setting that
affects what gets executed is a restricted configuration under Workspace
Trust.

The extension does reach the network when a command *you* explicitly run
does so — scaffolding a project (`npm create vite`, `create-next-app`, a
Python venv/pip install) or installing dependencies contacts the relevant
public package registry, the same as if you ran that command yourself in a
terminal.

## Settings

Settings live under `stackPilot.*` (backend/frontend directories, ports,
package manager, auto-restart, and more), are workspace-scoped, and are
searchable from VS Code's Settings UI.

## Known limitations

- FastAPI and Express support currently covers detection, start/stop, and
  project health — neither yet has Django-equivalent tooling (migrations,
  shell, dependency install) or debug configuration generation.
- pnpm/yarn/bun project-creation flags for Vite and Next.js follow each
  tool's published documentation but have not been independently
  smoke-tested (the npm path has).
- Testing panel integration is whole-suite, not per-test.
- Automatic dependency-installed detection checks whether the framework
  package is importable, not whether `requirements.txt` exactly matches
  what's installed; Poetry/uv/Pipenv projects are detected but not
  auto-installed.

See [`docs/ARCHITECTURE.md`](https://github.com/ctrlit-dev/StackPilot/blob/main/docs/ARCHITECTURE.md)
for the full picture.

## Support

Found a bug or have a feature request? Please open an issue on
[GitHub](https://github.com/ctrlit-dev/StackPilot/issues).

## Development

```sh
npm install
npm run compile
npm test
```

Press `F5` to launch an Extension Development Host. See
[`docs/DEVELOPMENT.md`](https://github.com/ctrlit-dev/StackPilot/blob/main/docs/DEVELOPMENT.md)
for the full workflow and
[`docs/TESTING.md`](https://github.com/ctrlit-dev/StackPilot/blob/main/docs/TESTING.md)
for how the test suite is structured.

## License

[MIT](LICENSE). See [`CHANGELOG.md`](CHANGELOG.md) for release notes.
