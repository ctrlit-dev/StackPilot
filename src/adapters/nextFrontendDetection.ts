import * as path from "node:path";

import type { FileSystemProbe } from "../detection/fileSystem";
import type { FrontendFrameworkDetection } from "./frontendFrameworkDetection";

/**
 * Bounded, optional supporting evidence only (NEXTJS-1B, refined after the
 * NEXTJS-1B.0 empirical verification) - unlike Vite, a Next.js project can
 * run entirely on defaults with no config file at all, so a config file's
 * mere presence must never independently satisfy this detection the way
 * `viteFrontendDetection.ts`'s own `VITE_CONFIG_FILES` does for Vite. It
 * only gives the returned evidence path a more specific name once
 * `dependencies.next` (the one required fact, see `hasNextDependency`
 * below) is already confirmed.
 */
const NEXT_CONFIG_FILES = ["next.config.js", "next.config.mjs", "next.config.ts"] as const;

/**
 * Next.js frontend detection (NEXTJS-1B). Required evidence, empirically
 * validated against a real `create-next-app@latest` scaffold in
 * NEXTJS-1B.0 (`"next": "16.3.5"` was generated under `dependencies`,
 * never `devDependencies`): the candidate root's own `package.json` must
 * declare `next` under `dependencies`. `next.config.{js,mjs,ts}` is
 * optional, supporting evidence only - checked purely to give the
 * returned evidence path a more specific name than the bare `package.json`
 * fallback below.
 *
 * Only ever consulted (by `detection/frontendDetector.ts`) against an
 * already-qualified frontend candidate root - this detector adds evidence,
 * it never decides candidacy itself. No source-file inspection, no router
 * directory markers (`app/`/`pages/`), no workspace recursion - App Router
 * and Pages Router are both covered transparently by `dependencies.next`
 * alone.
 */
export const nextFrontendDetection: FrontendFrameworkDetection = {
  frameworkId: "next",

  async findFrameworkConfigPath(fs, rootPath) {
    if (!(await hasNextDependency(fs, rootPath))) {
      return undefined;
    }

    for (const configFile of NEXT_CONFIG_FILES) {
      const configPath = path.join(rootPath, configFile);
      if (await fs.fileExists(configPath)) {
        return configPath;
      }
    }

    // dependencies.next alone is already sufficient - a Next.js project
    // needs no config file to run. Fall back to the package.json path
    // itself as the returned evidence, rather than treating a missing
    // config file as no match.
    return path.join(rootPath, "package.json");
  }
};

/**
 * Direct `dependencies.next` only - never `devDependencies`. A dev-only
 * Next.js dependency is not evidence this candidate root is itself a
 * Next.js app. Exported so `adapters/expressBackendDetection.ts` can reuse
 * this exact same fact to exclude a Next.js "custom server" root (both
 * `express` and `next` in the same `package.json`) from also being claimed
 * as a separate Express backend service - see that file's own doc comment.
 */
export async function hasNextDependency(fs: FileSystemProbe, rootPath: string): Promise<boolean> {
  const packageJsonPath = path.join(rootPath, "package.json");
  if (!(await fs.fileExists(packageJsonPath))) {
    return false;
  }

  try {
    const parsed = JSON.parse(await fs.readTextFile(packageJsonPath)) as unknown;
    return hasOwnDependency(parsed, "next");
  } catch {
    return false;
  }
}

function hasOwnDependency(packageJson: unknown, name: string): boolean {
  if (typeof packageJson !== "object" || packageJson === null || !("dependencies" in packageJson)) {
    return false;
  }

  const dependencies = packageJson.dependencies;
  return typeof dependencies === "object" && dependencies !== null && Object.hasOwn(dependencies, name);
}
