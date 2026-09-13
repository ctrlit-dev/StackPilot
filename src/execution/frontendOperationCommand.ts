import type { FrontendProject } from "../detection/frontendDetector";
import type { PackageManager } from "../detection/packageManagerDetector";
import { resolveRunCommand } from "./frontendCommand";
import type { OneShotCommandOptions } from "./oneShotCommand";

/**
 * Always a plain install (spec §24: "Do not choose `npm ci` blindly; it has
 * stricter semantics and should only be used when appropriate") - never `npm
 * ci` or an equivalent strict/frozen-lockfile variant. `install` is a direct
 * package-manager subcommand, not a package.json script, so this does not go
 * through resolveRunCommand (which would wrongly produce `npm run install`).
 */
export function buildFrontendInstallCommand(frontend: FrontendProject, packageManager: PackageManager): OneShotCommandOptions {
  return { executable: packageManager, args: ["install"], cwd: frontend.rootPath };
}

export function buildFrontendBuildCommand(
  frontend: FrontendProject,
  packageManager: PackageManager,
  buildScript: string
): OneShotCommandOptions {
  const { executable, args } = resolveRunCommand(packageManager, buildScript);
  return { executable, args, cwd: frontend.rootPath };
}

export function buildFrontendTestCommand(
  frontend: FrontendProject,
  packageManager: PackageManager,
  testScript: string
): OneShotCommandOptions {
  const { executable, args } = resolveRunCommand(packageManager, testScript);
  return { executable, args, cwd: frontend.rootPath };
}

/**
 * The escape hatch for any package.json script without a dedicated menu
 * entry - identical shape to build/test above, but for a script name chosen
 * at runtime rather than one of the two configured ones.
 */
export function buildFrontendScriptCommand(
  frontend: FrontendProject,
  packageManager: PackageManager,
  scriptName: string
): OneShotCommandOptions {
  const { executable, args } = resolveRunCommand(packageManager, scriptName);
  return { executable, args, cwd: frontend.rootPath };
}
