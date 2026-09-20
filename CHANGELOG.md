# Changelog

All notable changes to the "StackPilot" extension are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-09-20

**Public Preview.**

### Added
- **Express support**: detection, and starting/stopping the dev server. Express backends are not yet covered by the Django-specific tooling (migrations, shell, dependency install, debug configuration).
- **Express project creation**: plain, or paired with a Vite + React + TypeScript frontend.
- **Next.js support**: detection and dev-server lifecycle (start/stop/restart), with frontend URL tracking and "Open Application" the same as Vite.
- **Next.js project creation**: a standalone App Router + TypeScript project.

### Changed
- Framework-aware UX improvements: dashboard, tree, and command copy now correctly reflect which framework-specific operations are available per backend/frontend type, instead of assuming Django/Vite everywhere.

## [0.0.3] - 2026-09-19

### Added
- **FastAPI support**: detection (a `main.py`/`app/main.py` entry point with a `FastAPI()` instantiation and a matching dependency), and starting/stopping the dev server via `uvicorn`. FastAPI backends are not yet covered by the Django-specific tooling below (migrations, shell, dependency install, debug configuration).
- **New Project** wizard now asks which project type to create - **Django**, **FastAPI**, or standalone **React + Vite** - instead of always scaffolding Django + Vite.
- FastAPI project creation, plain or paired with a Vite + React + TypeScript frontend.
- Standalone **React + Vite** project creation (no backend), with a choice of the `react` or `react-ts` template and a package manager.
- **Project Health**: a new diagnostics view, in both the tree (a "Diagnostics" section) and the dashboard (a "Project Health" panel), checking the Python interpreter, framework dependencies (Django or FastAPI), Node dependencies/package manager, and - for Django - pending migrations.
- Dashboard **Dev Tools** tab with 10 built-in developer utilities: Regex Tester, Case Converter, JSON Formatter, Base64/URL encoder, cURL converter (Fetch/Axios/Python), Color Picker/Gradient Builder, Tailwind class optimizer, SVG-to-CSS converter, JWT inspector, and a bcrypt Password Hasher/Verifier.

### Fixed
- **Initialize Project** now detects and reports FastAPI projects correctly instead of assuming every backend is Django.

### Changed
- Project detection, process lifecycle (start/stop/restart, auto-restart-on-crash), and project initialization are now framework-generic internally, so the same machinery drives both Django and FastAPI.

## [0.0.2] - 2026-09-13

### Fixed
- Django app detection now also looks one level inside an `apps/` container directory (e.g. `apps/blog`, `apps/users`), not just directly under the backend root - apps organized that way were previously invisible in the tree and dashboard.

## [0.0.1] - 2026-09-12

Initial release.

### Detection & project setup
- Detects an existing Django backend, Vite frontend, Python interpreter/virtual environment, and package manager (npm/pnpm/yarn/bun).
- **New Project** wizard: scaffolds a Django + Vite project from a preset (Django only / + Vite React / + TypeScript / + DRF API), with a review step before anything is created.
- **Initialize Project**: checklist-driven setup for an existing/cloned project (virtual environment, dependencies).

### Backend & frontend workflow
- Start/stop managed dev servers with live status in the tree, dashboard, and status bar; output streams into dedicated terminals.
- Django operations: Make Migrations, Migrate, Show Migrations, Django Shell, Database Shell, Create Superuser, Create App, Run Tests, Install Dependencies.
- Frontend operations: Install Dependencies, Build, Run Tests, Run Script (any package.json script).
- Generic **Run Management Command** for any `manage.py` subcommand not covered by a dedicated action.
- Django app detection with per-app scoped actions (migrations/tests for just that app), and automatic `INSTALLED_APPS` registration when creating a new app.
- `.env` file creation/opening for backend and frontend, seeded from a `.env.example`/`.env.sample`/`.env.template` when present; an existing `.env` is never overwritten.

### Dashboard
- A dedicated editor tab (not a sidebar view) with server status cards, live log preview, a migrations-pending indicator, quick-action tiles, Django app list, Recent Activity feed, and a Help tab with a full usage guide.

### Debugging & testing
- **Generate Debug Configuration**: writes a debugpy + Chrome `launch.json` (plus a combined compound), using the detected interpreter.
- Django and frontend tests appear in VS Code's native Testing panel.

### Reliability
- Optional auto-restart on an unexpected crash (capped at 3 attempts with backoff).
- Crash notifications with Restart / Show Output actions when auto-restart is off.
- Copy URL, Open Admin, and Open in Simple Browser actions once a server is running.

### Other
- Keyboard shortcuts for Start All, Stop All, and Open Dashboard.
- Workspace Trust is required before any project code runs.
