import * as path from "node:path";

import type { FileSystemProbe } from "../detection/fileSystem";

const ENV_EXAMPLE_CANDIDATES = [".env.example", ".env.sample", ".env.template"] as const;

/**
 * Looks for a checked-in template next to a project root (the common
 * `.env.example` convention) so a freshly created `.env` starts pre-filled
 * with the variables the project actually expects, instead of an empty
 * file. Returns undefined when none exists - the caller then creates an
 * empty `.env`.
 */
export async function findEnvExampleContent(fs: FileSystemProbe, rootPath: string): Promise<string | undefined> {
  for (const candidate of ENV_EXAMPLE_CANDIDATES) {
    const candidatePath = path.join(rootPath, candidate);
    if (await fs.fileExists(candidatePath)) {
      return fs.readTextFile(candidatePath);
    }
  }
  return undefined;
}
