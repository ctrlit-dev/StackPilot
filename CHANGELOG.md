# Changelog

All notable changes to the "StackPilot" extension are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
