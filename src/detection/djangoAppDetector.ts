import * as path from "node:path";

import type { FileSystemProbe } from "./fileSystem";

export interface DjangoApp {
  readonly name: string;
  readonly path: string;
}

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
  const entryNames = await fs.listDirectoryNames(backendRootPath);
  const apps: DjangoApp[] = [];

  for (const name of entryNames) {
    if (name.startsWith(".")) {
      continue;
    }
    const entryPath = path.join(backendRootPath, name);
    if (!(await fs.directoryExists(entryPath))) {
      continue;
    }
    if (await looksLikeDjangoApp(fs, entryPath)) {
      apps.push({ name, path: entryPath });
    }
  }

  return apps.sort((a, b) => a.name.localeCompare(b.name));
}

async function looksLikeDjangoApp(fs: FileSystemProbe, appPath: string): Promise<boolean> {
  if (await fs.fileExists(path.join(appPath, "apps.py"))) {
    return true;
  }
  return (await fs.fileExists(path.join(appPath, "models.py"))) && (await fs.directoryExists(path.join(appPath, "migrations")));
}
