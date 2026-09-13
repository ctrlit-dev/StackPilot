import * as path from "node:path";
import type { FileSystemProbe } from "./fileSystem";

const PYTHON_VERSION_DIRECTORY_PATTERN = /^python\d+(\.\d+)?$/;

/**
 * Checks whether Django is importable from a venv's site-packages, as a
 * concrete, directly-checkable proxy for "have requirements.txt's packages
 * been installed" (spec §25's "Python dependencies not installed" checklist
 * row). Deliberately does not attempt to parse requirements.txt and diff it
 * against every installed distribution - version specifiers, extras, `-r`
 * includes, and environment markers make that fragile, and the spec does not
 * specify an exact algorithm for it. Checking for Django specifically (not
 * "any package") is meaningful here because this extension only ever
 * operates on projects it already confirmed are Django projects.
 *
 * Windows venvs use `Lib/site-packages` directly; POSIX venvs use
 * `lib/pythonX.Y/site-packages`, where X.Y cannot be predicted without
 * listing `lib/` (the detected PythonEnvironment does not reliably carry a
 * version string - no real version probe is wired up yet).
 */
export async function isDjangoInstalled(fs: FileSystemProbe, venvPath: string): Promise<boolean> {
  const windowsCandidate = path.join(venvPath, "Lib", "site-packages", "django", "__init__.py");
  if (await fs.fileExists(windowsCandidate)) {
    return true;
  }

  const libDirectory = path.join(venvPath, "lib");
  for (const entry of await fs.listDirectoryNames(libDirectory)) {
    if (!PYTHON_VERSION_DIRECTORY_PATTERN.test(entry)) {
      continue;
    }
    const candidate = path.join(libDirectory, entry, "site-packages", "django", "__init__.py");
    if (await fs.fileExists(candidate)) {
      return true;
    }
  }

  return false;
}
