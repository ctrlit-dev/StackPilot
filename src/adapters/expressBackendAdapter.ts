import { getNodeRuntime } from "../detection/detectedProject";
import { resolveRunCommand } from "../execution/frontendCommand";
import type { BackendStartAdapter } from "./backendFrameworkAdapter";

/**
 * "dev" preferred over "start" - matches the frontend's own default
 * preferred script (`stackPilot.frontend.devScript` = "dev"). Kept in sync
 * with `commands/startPlans.ts`'s own `checkBackendRuntimePrerequisite`,
 * which checks for these same two script names before this adapter is ever
 * called - see that function's doc comment for why the two are not merged
 * into one shared helper.
 */
const SCRIPT_PRIORITY = ["dev", "start"] as const;

export function pickExpressScript(scripts: Readonly<Record<string, string>>): string | undefined {
  return SCRIPT_PRIORITY.find((name) => Object.hasOwn(scripts, name));
}

/**
 * Starts Express via the project's own `package.json` `dev` (preferred) or
 * `start` script, through the exact same package-manager-aware
 * `resolveRunCommand()` the frontend's dev server already uses - never a
 * guessed `node <entry file>`, and never npm's own implicit `node
 * server.js` fallback (that fallback is npm-specific and does not exist for
 * pnpm/yarn/bun). The project itself, not StackPilot, defines how it is
 * started.
 *
 * `PORT`/`HOST` are set on the spawned process as a best-effort convention
 * via `StartProcessOptions.env` (an existing, already-passed-through field -
 * no new plumbing). This is guaranteed to be honored only for a
 * StackPilot-*created* Express project (not implemented until EXPRESS-1D)
 * whose own template reads them; for a merely *detected* pre-existing
 * project, this is a convention this adapter offers, never a contract it
 * can enforce - StackPilot does not rewrite source or configuration files
 * to force a port.
 *
 * `planBackendStart` only ever calls this once it has confirmed a resolved
 * (non-`missing`/non-`ambiguous`) package manager and a `dev`/`start`
 * script exist, so the fallbacks below ("npm", "start") are structurally
 * unreachable through that path - kept only so this function stays total
 * without a non-null assertion, mirroring `djangoBackendAdapter`'s own
 * `managePyPath` fallback.
 */
export const expressBackendAdapter: BackendStartAdapter = {
  id: "express",

  buildStartCommand(service, host, port) {
    const runtime = getNodeRuntime(service);
    const manager = runtime?.packageManager.kind === "detected" ? runtime.packageManager.manager : "npm";
    const script = (runtime === undefined ? undefined : pickExpressScript(runtime.scripts)) ?? "start";
    const { executable, args } = resolveRunCommand(manager, script);

    return {
      executable,
      args,
      cwd: service.rootPath,
      expectedPort: port,
      env: { PORT: String(port), HOST: host }
    };
  }
};
