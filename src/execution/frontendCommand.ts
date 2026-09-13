import type { FrontendProject } from "../detection/frontendDetector";
import type { PackageManager } from "../detection/packageManagerDetector";
import type { StartProcessOptions } from "./processManager";

/**
 * Builds the argv for the frontend dev script (spec §15). Uses the package
 * script found in package.json rather than assuming `npm run dev`; the exact
 * invocation still differs per package manager (`npm run <script>` vs
 * `pnpm <script>` etc.). No `--port` flag is forced - Vite may pick a
 * different port than configured, and the actual port must be read from its
 * output rather than assumed (spec §15).
 */
export function buildFrontendDevCommand(
  frontend: FrontendProject,
  packageManager: PackageManager,
  devScript: string,
  expectedPort?: number
): StartProcessOptions {
  const { executable, args } = resolveRunCommand(packageManager, devScript);
  return {
    executable,
    args,
    cwd: frontend.rootPath,
    expectedPort
  };
}

/**
 * `npm run <script>` vs `pnpm <script>` vs `yarn <script>` vs `bun run
 * <script>` - shared by every command that runs a package.json script
 * (dev, build, test), so the per-manager invocation stays in one place.
 */
export function resolveRunCommand(packageManager: PackageManager, script: string): { executable: string; args: string[] } {
  switch (packageManager) {
    case "npm":
      return { executable: "npm", args: ["run", script] };
    case "pnpm":
      return { executable: "pnpm", args: [script] };
    case "yarn":
      return { executable: "yarn", args: [script] };
    case "bun":
      return { executable: "bun", args: ["run", script] };
    default:
      return assertUnreachable(packageManager);
  }
}

function assertUnreachable(value: never): never {
  throw new Error(`Unsupported package manager: ${String(value)}`);
}
