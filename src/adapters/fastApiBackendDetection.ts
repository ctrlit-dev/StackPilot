import * as path from "node:path";
import { checkCandidatePath, type FileSystemProbe } from "../detection/fileSystem";
import { resolveWorkspacePath } from "../utils/paths";
import type { BackendFrameworkDetection, BackendFrameworkEntryPointCandidate } from "./backendFrameworkDetection";

/**
 * Deliberately narrow, documented support (spec: "Ein klar begrenzter,
 * dokumentierter Support ist akzeptabel") - exactly the two entry-point
 * shapes actually verified: a flat `main.py` at the workspace root, or a
 * `main.py` inside an `app/` package. Both resolve `rootPath` to the
 * workspace root itself (not `dirname(entryPath)`, unlike Django's
 * `manage.py` - the `app/main.py` case needs `app` importable as a package
 * from the workspace root, not from inside `app/`). A `backend/`-nested
 * variant is not supported here; adding one is a one-line addition to this
 * list, not a redesign - see `deriveFastApiAppImport()`.
 */
const FASTAPI_ENTRY_POINT_CANDIDATES = ["main.py", "app/main.py"] as const;

/** Same evidence files `detection/backendDetector.ts` already checks for generic Python-project confidence, reused here as FastAPI's own dependency evidence. */
const FASTAPI_DEPENDENCY_FILES = ["requirements.txt", "requirements/dev.txt", "pyproject.toml"] as const;

/**
 * The literal FastAPI class instantiation call. Deliberately not just an
 * import line (`from fastapi import FastAPI`) - an import without ever
 * instantiating the class is not "actual FastAPI usage" (spec §6). Matches
 * both `from fastapi import FastAPI ... app = FastAPI(...)` and
 * `import fastapi ... app = fastapi.FastAPI(...)` equally, since either way
 * the class name appears immediately before the call parenthesis.
 */
const FASTAPI_APPLICATION_MARKER = "FastAPI(";

/**
 * FastAPI backend detection evidence: `main.py` alone is never enough
 * (spec §6/§9) - a candidate only qualifies when BOTH the entry file
 * actually instantiates `FastAPI(...)` (read as plain text, never executed
 * or imported - spec §37) AND a recognized Python dependency file nearby
 * mentions "fastapi". Deterministic evidence combination, not a scoring
 * engine: no confidence weights, just two required, independently checked
 * facts (spec §7).
 */
export const fastApiBackendDetection: BackendFrameworkDetection = {
  frameworkId: "fastapi",

  // No configurable entry-point override for FastAPI (unlike Django's
  // `stackPilot.backend.managePy`) - bounded, documented candidates only
  // (spec: "Ein klar begrenzter, dokumentierter Support ist akzeptabel").
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async detect(fs, workspaceRootPath, configuredEntryPointOverride) {
    const diagnostics: string[] = [];
    const candidates: BackendFrameworkEntryPointCandidate[] = [];
    const hasDependencyEvidence = await hasFastApiDependency(fs, workspaceRootPath);

    for (const entryRelativePath of FASTAPI_ENTRY_POINT_CANDIDATES) {
      const entryPath = resolveWorkspacePath(workspaceRootPath, entryRelativePath);
      const check = await checkCandidatePath(fs, workspaceRootPath, entryPath, "FastAPI entry point candidate");
      if (check.kind === "not-found") {
        continue;
      }
      if (check.kind === "unsafe") {
        diagnostics.push(check.diagnostic);
        continue;
      }

      const entryContent = await fs.readTextFile(entryPath);
      if (!entryContent.includes(FASTAPI_APPLICATION_MARKER)) {
        continue;
      }
      if (!hasDependencyEvidence) {
        continue;
      }

      candidates.push({
        rootPath: workspaceRootPath,
        frameworkEntryPath: entryPath,
        evidence: entryRelativePath
      });
    }

    return { candidates, diagnostics };
  }
};

async function hasFastApiDependency(fs: FileSystemProbe, workspaceRootPath: string): Promise<boolean> {
  for (const fileName of FASTAPI_DEPENDENCY_FILES) {
    const filePath = path.join(workspaceRootPath, fileName);
    if (!(await fs.fileExists(filePath))) {
      continue;
    }
    const content = await fs.readTextFile(filePath);
    if (content.toLowerCase().includes("fastapi")) {
      return true;
    }
  }
  return false;
}

/**
 * Turns a detected entry file into uvicorn's `module:attr` reference, e.g.
 * `/workspace/main.py` (root `/workspace`) → `"main:app"`, or
 * `/workspace/app/main.py` → `"app.main:app"`. Pure path math (relative
 * path, strip `.py`, `path.sep` → `.`), not detection heuristics - this is
 * exactly why `rootPath` for FastAPI candidates is always the workspace
 * root: it is uvicorn's cwd, and `app/main.py` only imports as the package
 * `app.main` when run from its parent, not from inside `app/`.
 */
export function deriveFastApiAppImport(rootPath: string, entryPath: string): string {
  const relativePath = path.relative(rootPath, entryPath);
  const withoutExtension = relativePath.endsWith(".py") ? relativePath.slice(0, -".py".length) : relativePath;
  const modulePath = withoutExtension.split(path.sep).join(".");
  return `${modulePath}:app`;
}
