import * as path from "node:path";
import type { FileSystemProbe } from "./fileSystem";

const PYTHON_VERSION_DIRECTORY_PATTERN = /^python\d+(\.\d+)?$/;

/**
 * `packageName` only ever comes from this codebase's own static framework
 * identifiers ("django", "fastapi" - see `commands/initializationAnalysis.ts`),
 * never from user input, but is validated anyway before being joined into a
 * filesystem path: a plain top-level distribution/import name, nothing that
 * could traverse (`..`, path separators) or otherwise escape the intended
 * `site-packages/<packageName>` lookup.
 */
const SAFE_PACKAGE_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/;

/**
 * Checks whether a given Python package is importable from a venv's
 * site-packages, as a concrete, directly-checkable proxy for "have
 * requirements.txt's packages been installed" (spec §25's "Python
 * dependencies not installed" checklist row). Deliberately does not attempt
 * to parse requirements.txt and diff it against every installed distribution
 * - version specifiers, extras, `-r` includes, and environment markers make
 * that fragile, and the spec does not specify an exact algorithm for it.
 * Checking for one specific, named package (rather than "any package") is
 * meaningful here because the caller already knows which backend framework
 * was detected (Django, FastAPI, ...) and passes that framework's own
 * top-level package name.
 *
 * Windows venvs use `Lib/site-packages` directly; POSIX venvs use
 * `lib/pythonX.Y/site-packages`, where X.Y cannot be predicted without
 * listing `lib/` (the detected PythonEnvironment does not reliably carry a
 * version string - no real version probe is wired up yet).
 */
export async function isPythonPackageInstalled(fs: FileSystemProbe, venvPath: string, packageName: string): Promise<boolean> {
  if (!SAFE_PACKAGE_NAME_PATTERN.test(packageName)) {
    return false;
  }

  const windowsCandidate = path.join(venvPath, "Lib", "site-packages", packageName, "__init__.py");
  if (await fs.fileExists(windowsCandidate)) {
    return true;
  }

  const libDirectory = path.join(venvPath, "lib");
  for (const entry of await fs.listDirectoryNames(libDirectory)) {
    if (!PYTHON_VERSION_DIRECTORY_PATTERN.test(entry)) {
      continue;
    }
    const candidate = path.join(libDirectory, entry, "site-packages", packageName, "__init__.py");
    if (await fs.fileExists(candidate)) {
      return true;
    }
  }

  return false;
}
