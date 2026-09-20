import type { PackageManager } from "../detection/packageManagerDetector";
import type { OneShotCommandOptions } from "./oneShotCommand";

/**
 * Scaffolds a new Next.js project non-interactively (spec: NEXTJS-1D,
 * empirically verified against `create-next-app@latest` resolving to
 * 16.3.5 - docs/NEXTJS_CODE_TRUTH_AND_IMPLEMENTATION_PLAN.md's own
 * empirical verification). One canonical, deterministic preset - not a
 * mirror of every create-next-app option: TypeScript, App Router, `src/`
 * directory, ESLint, Tailwind CSS, `@/*` import alias.
 *
 * `--disable-git` is passed unconditionally - empirically confirmed to
 * print "Skipping git initialization." create-next-app must never
 * initialize Git itself; StackPilot's own existing, generic Git-init
 * wizard step (`project/sharedProjectSteps.ts`) is the single owner of
 * that decision, exactly as it already is for every other Create module.
 *
 * npm's exact invocation (`npx --yes create-next-app@latest . <flags>
 * --use-npm --yes`) is empirically verified end-to-end, including the
 * root-target `.` directory argument scaffolding directly into an
 * already-created project root rather than a nested "." folder (mirrors
 * `execution/viteScaffoldCommand.ts`'s own `create-vite .` precedent).
 * pnpm/yarn/bun use their own documented `<manager> create next-app`
 * initializer convention - the same shape `viteScaffoldCommand.ts` already
 * uses for create-vite - plus the explicit `--use-<manager>` flag
 * `create-next-app --help` documents, so the generated lockfile/install
 * step always matches the manager StackPilot resolved regardless of how
 * the tool itself was invoked. Not independently smoke-tested for those
 * three package managers.
 */
export function buildNextScaffoldCommand(packageManager: PackageManager, projectRoot: string): OneShotCommandOptions {
  return {
    executable: resolveExecutable(packageManager),
    args: resolveCreateNextAppArgs(packageManager),
    cwd: projectRoot
  };
}

/**
 * npm has no direct per-manager "create" initializer command of its own
 * the way pnpm/yarn/bun do (see `resolveCreateNextAppArgs` below) - `npx`
 * is the empirically-verified invocation for npm specifically.
 */
function resolveExecutable(packageManager: PackageManager): string {
  return packageManager === "npm" ? "npx" : packageManager;
}

/**
 * The one deterministic preset's fixed flags (docs/NEXTJS_CODE_TRUTH_AND_IMPLEMENTATION_PLAN.md
 * §19.1) - never exposed as user choices. `--disable-git` belongs here,
 * not as a separate concern, because it must apply identically regardless
 * of package manager.
 */
const NEXTJS_PRESET_FLAGS = ["--ts", "--tailwind", "--eslint", "--app", "--src-dir", "--import-alias", "@/*", "--disable-git"] as const;

function resolveCreateNextAppArgs(packageManager: PackageManager): string[] {
  switch (packageManager) {
    case "npm":
      // npx's own `--yes` (skip the "Ok to proceed" download confirmation,
      // which would otherwise hang a captured process with no stdin
      // attached - the same reason `viteScaffoldCommand.ts` needs one for
      // `npm create vite@latest`) is distinct from create-next-app's own
      // trailing `--yes` (use saved preferences/defaults for any
      // unprovided option) - both are required for full non-interactivity.
      return ["--yes", "create-next-app@latest", ".", ...NEXTJS_PRESET_FLAGS, "--use-npm", "--yes"];
    case "pnpm":
      return ["create", "next-app", ".", ...NEXTJS_PRESET_FLAGS, "--use-pnpm", "--yes"];
    case "yarn":
      return ["create", "next-app", ".", ...NEXTJS_PRESET_FLAGS, "--use-yarn", "--yes"];
    case "bun":
      return ["create", "next-app", ".", ...NEXTJS_PRESET_FLAGS, "--use-bun", "--yes"];
    default:
      return assertUnreachable(packageManager);
  }
}

function assertUnreachable(value: never): never {
  throw new Error(`Unsupported package manager: ${String(value)}`);
}
