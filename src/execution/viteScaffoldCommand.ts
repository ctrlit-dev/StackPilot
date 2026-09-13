import type { PackageManager } from "../detection/packageManagerDetector";
import type { OneShotCommandOptions } from "./oneShotCommand";

export type ViteTemplate = "react" | "react-ts";

/**
 * Scaffolds a new Vite project non-interactively (spec §29). Flags verified
 * empirically for npm in this environment (`npm create vite@latest <name>
 * --yes -- --template <template> --no-interactive` - the `--yes` avoids
 * npm's own "Ok to proceed" download prompt, which would otherwise hang a
 * captured process with no stdin attached; `--` separates npm's own flags
 * from create-vite's; `--no-interactive` is create-vite's own flag to avoid
 * suggesting a template interactively).
 *
 * pnpm/yarn/bun are implemented per Vite's official documentation
 * (https://vite.dev/guide/) rather than independently smoke-tested, since
 * none of those tools are installed in the environment this was built in -
 * documented here rather than silently assumed equivalent to npm.
 */
export function buildViteScaffoldCommand(
  packageManager: PackageManager,
  projectName: string,
  template: ViteTemplate,
  parentDirectory: string
): OneShotCommandOptions {
  return {
    executable: packageManager,
    args: resolveCreateViteArgs(packageManager, projectName, template),
    cwd: parentDirectory
  };
}

function resolveCreateViteArgs(packageManager: PackageManager, projectName: string, template: ViteTemplate): string[] {
  switch (packageManager) {
    case "npm":
      return ["create", "vite@latest", projectName, "--yes", "--", "--template", template, "--no-interactive"];
    case "pnpm":
    case "yarn":
    case "bun":
      return ["create", "vite", projectName, "--template", template, "--no-interactive"];
    default:
      return assertUnreachable(packageManager);
  }
}

function assertUnreachable(value: never): never {
  throw new Error(`Unsupported package manager: ${String(value)}`);
}
