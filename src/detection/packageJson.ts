import type { FileSystemProbe } from "./fileSystem";

/**
 * Extracted from `frontendDetector.ts` (EXPRESS-1B) so `projectDetector.ts`
 * can read a Node-runtime backend's (Express, today) `package.json` scripts
 * through the exact same, already-tested logic the frontend's own detection
 * uses - rather than a second copy of the same JSON-parsing rules. Behavior
 * is unchanged from the pre-extraction, frontend-only version; only its
 * location and reuse are new.
 */
export type PackageJsonReadResult =
  | { readonly kind: "valid"; readonly scripts: Readonly<Record<string, string>> }
  | { readonly kind: "invalid"; readonly reason: string };

export async function readPackageJson(fs: FileSystemProbe, packageJsonPath: string): Promise<PackageJsonReadResult> {
  try {
    const parsed = JSON.parse(await fs.readTextFile(packageJsonPath)) as unknown;
    return {
      kind: "valid",
      scripts: readScripts(parsed)
    };
  } catch (error: unknown) {
    return {
      kind: "invalid",
      reason: error instanceof Error ? error.message : "Unknown parse error"
    };
  }
}

function readScripts(packageJson: unknown): Readonly<Record<string, string>> {
  if (typeof packageJson !== "object" || packageJson === null || !("scripts" in packageJson)) {
    return {};
  }

  const scripts = packageJson.scripts;
  if (typeof scripts !== "object" || scripts === null) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(scripts).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}
