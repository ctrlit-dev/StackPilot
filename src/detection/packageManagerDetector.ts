import * as path from "node:path";

import type { PackageManagerPreference } from "../config/configurationModel";
import type { FileSystemProbe } from "./fileSystem";

export type PackageManager = Exclude<PackageManagerPreference, "auto">;

export type PackageManagerDetection =
  | { readonly kind: "detected"; readonly manager: PackageManager; readonly source: "configured" | "lockfile"; readonly evidence?: string }
  | { readonly kind: "missing"; readonly reason: string }
  | { readonly kind: "ambiguous"; readonly candidates: readonly PackageManagerLockEvidence[] };

export interface PackageManagerLockEvidence {
  readonly manager: PackageManager;
  readonly lockfile: string;
}

const LOCKFILES: readonly PackageManagerLockEvidence[] = [
  { manager: "pnpm", lockfile: "pnpm-lock.yaml" },
  { manager: "yarn", lockfile: "yarn.lock" },
  { manager: "npm", lockfile: "package-lock.json" },
  { manager: "bun", lockfile: "bun.lock" },
  { manager: "bun", lockfile: "bun.lockb" }
];

export async function detectPackageManager(
  fs: FileSystemProbe,
  frontendRootPath: string,
  preference: PackageManagerPreference
): Promise<PackageManagerDetection> {
  if (preference !== "auto") {
    return {
      kind: "detected",
      manager: preference,
      source: "configured"
    };
  }

  const lockEvidence: PackageManagerLockEvidence[] = [];
  for (const lockfile of LOCKFILES) {
    if (await fs.fileExists(path.join(frontendRootPath, lockfile.lockfile))) {
      lockEvidence.push(lockfile);
    }
  }

  const managers = new Set(lockEvidence.map((evidence) => evidence.manager));
  if (managers.size === 1 && lockEvidence[0] !== undefined) {
    return {
      kind: "detected",
      manager: lockEvidence[0].manager,
      source: "lockfile",
      evidence: lockEvidence[0].lockfile
    };
  }

  if (managers.size > 1) {
    return {
      kind: "ambiguous",
      candidates: lockEvidence
    };
  }

  return {
    kind: "missing",
    reason: "No supported package-manager lockfile was found."
  };
}
