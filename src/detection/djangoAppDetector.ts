import * as path from "node:path";

import type { FileSystemProbe } from "./fileSystem";

export interface DjangoApp {
  readonly name: string;
  readonly path: string;
}

/**
 * Directory names that conventionally hold nothing but local Django apps
 * (`apps/blog/`, `apps/users/`, ...). Checked one level deep in addition to
 * the backend root itself - still a bounded, known-layout lookup rather than
 * a general recursive scan (spec §47), the same approach MANAGE_PY_CANDIDATES
 * and FRONTEND_CANDIDATE_DIRECTORIES already use for their own layouts.
 */
const APP_CONTAINER_DIRECTORY_NAMES = ["apps"] as const;

/**
 * Filesystem-only heuristic, deliberately not a parse of INSTALLED_APPS in
 * settings.py (settings can be split across modules, computed, or read from
 * environment variables - reliably parsing arbitrary Python was judged too
 * fragile, the same reasoning this codebase already applies to
 * requirements.txt and Poetry/uv detection). `apps.py` is the marker
 * Django's own `startapp` always generates; a `models.py` next to a
 * `migrations/` directory catches older or hand-written apps that predate
 * that convention. This naturally excludes the venv directory and the
 * Django project's own settings package (config/, wsgi.py, urls.py, ...),
 * neither of which contains either marker.
 */
export async function detectDjangoApps(fs: FileSystemProbe, backendRootPath: string): Promise<DjangoApp[]> {
  const apps: DjangoApp[] = [];
  await collectDjangoApps(fs, backendRootPath, apps);

  for (const containerName of APP_CONTAINER_DIRECTORY_NAMES) {
    const containerPath = path.join(backendRootPath, containerName);
    if (await fs.directoryExists(containerPath)) {
      await collectDjangoApps(fs, containerPath, apps);
    }
  }

  return apps.sort((a, b) => a.name.localeCompare(b.name));
}

async function collectDjangoApps(fs: FileSystemProbe, directoryPath: string, apps: DjangoApp[]): Promise<void> {
  const entryNames = await fs.listDirectoryNames(directoryPath);

  for (const name of entryNames) {
    if (name.startsWith(".")) {
      continue;
    }
    const entryPath = path.join(directoryPath, name);
    if (!(await fs.directoryExists(entryPath))) {
      continue;
    }
    if (await looksLikeDjangoApp(fs, entryPath)) {
      apps.push({ name, path: entryPath });
    }
  }
}

async function looksLikeDjangoApp(fs: FileSystemProbe, appPath: string): Promise<boolean> {
  if (await fs.fileExists(path.join(appPath, "apps.py"))) {
    return true;
  }
  return (await fs.fileExists(path.join(appPath, "models.py"))) && (await fs.directoryExists(path.join(appPath, "migrations")));
}
