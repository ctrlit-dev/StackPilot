import * as path from "node:path";
import { checkCandidatePath, type FileSystemProbe } from "../detection/fileSystem";
import { resolveWorkspacePath } from "../utils/paths";
import type { BackendFrameworkDetection, BackendFrameworkEntryPointCandidate } from "./backendFrameworkDetection";
import { hasNextDependency } from "./nextFrontendDetection";

/**
 * Deliberately narrow, documented support (mirrors FastAPI's own
 * `FASTAPI_ENTRY_POINT_CANDIDATES` precedent) - JavaScript/CommonJS only for
 * EXPRESS-1B. All six candidates resolve `rootPath` to the workspace root,
 * never a nested `backend/` directory and never `dirname(entryPath)`: a
 * `backend/`-nested variant (like Django's configurable `backendManagePy`,
 * or FastAPI's own precedent of staying root-only) is out of scope for this
 * phase - the smallest change that still proves the architecture, not a
 * redesign. Adding one later is a one-line addition to this list, the same
 * way FastAPI's own doc comment describes adding a `backend/` variant to
 * its two candidates.
 *
 * `bin/www` (express-generator's own conventional entry point) is
 * deliberately NOT included: express-generator's `bin/www` never itself
 * contains a `require("express")`/`express()` call - that call lives in the
 * `app.js` it requires, which this list already covers. Adding `bin/www`
 * would not detect any project this list does not already detect via
 * `app.js`, so it would be scope creep with zero detection benefit.
 */
const EXPRESS_ENTRY_POINT_CANDIDATES = ["index.js", "server.js", "app.js", "src/index.js", "src/server.js", "src/app.js"] as const;

/** Same evidence file `detection/backendDetector.ts`'s Python-flavored bonus scoring never covers - Express corroborates itself instead, via `dependencies.express`. */
const EXPRESS_DEPENDENCY_FILE = "package.json";

/**
 * Matches `require("express")()`/`require('express')()` - the app
 * instantiated inline, with no intermediate binding.
 */
const EXPRESS_INLINE_CALL_PATTERN = /require\(\s*(['"])express\1\s*\)\s*\(/;

/**
 * Matches `const express = require("express")` (or `let`/`var`, and any
 * binding identifier - not just the literal name `express`), capturing the
 * bound identifier so the call-site check below can confirm the *same*
 * identifier is later invoked as a function.
 */
const EXPRESS_REQUIRE_BINDING_PATTERN = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*(['"])express\2\s*\)/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Binding-aware Express application-instantiation evidence, not a bare
 * `.includes("express(")` scan: confirms the identifier being *called* as a
 * function was actually bound from `require("express")` in this same file,
 * rather than merely co-occurring with the word "express" (a comment, an
 * unrelated `expressCheckout()` helper, or text that happens to contain the
 * substring). Text-only - the file is read, never executed or imported,
 * same posture as FastAPI's `FASTAPI_APPLICATION_MARKER`.
 *
 * Supports two deliberately bounded CommonJS shapes:
 * - `const express = require("express"); ...; const app = express();` -
 *   arbitrary binding identifier honored, not just the name `express`.
 * - `const app = require("express")();` - the inline call form.
 *
 * ESM (`import express from "express"`) is out of Phase-1 scope
 * (JavaScript/CommonJS only, per EXPRESS-1A §16/§19) and is deliberately not
 * matched here - a project using only ESM import syntax is a documented,
 * accepted false negative for this phase, not a bug.
 */
function hasExpressApplicationEvidence(content: string): boolean {
  if (EXPRESS_INLINE_CALL_PATTERN.test(content)) {
    return true;
  }

  const bindingMatch = EXPRESS_REQUIRE_BINDING_PATTERN.exec(content);
  if (bindingMatch === null) {
    return false;
  }
  const boundIdentifier = bindingMatch[1];
  if (boundIdentifier === undefined) {
    return false;
  }

  // Search only the text *after* the require statement itself, so that
  // statement's own `require(` token can never be mistaken for a call of
  // the bound identifier (e.g. a binding literally named "require" cannot
  // occur here, but this keeps the search unambiguous regardless).
  const textAfterBinding = content.slice(bindingMatch.index + bindingMatch[0].length);
  const callPattern = new RegExp(`\\b${escapeRegExp(boundIdentifier)}\\s*\\(`);
  return callPattern.test(textAfterBinding);
}

/**
 * Express backend detection evidence: an entry-file candidate alone is
 * never enough (mirrors FastAPI's own two-required-facts rule) - a
 * candidate only qualifies when BOTH the entry file actually contains
 * binding-aware Express application-instantiation evidence AND
 * `package.json`'s own `dependencies` (never `devDependencies`) declares
 * `express`. Deterministic evidence combination, not a scoring engine.
 */
export const expressBackendDetection: BackendFrameworkDetection = {
  frameworkId: "express",

  // No configurable entry-point override for Express (unlike Django's
  // `stackPilot.backend.managePy`) - bounded, documented candidates only,
  // matching FastAPI's own precedent.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async detect(fs, workspaceRootPath, configuredEntryPointOverride) {
    const diagnostics: string[] = [];

    // NEXTJS-1B: a root whose own package.json depends on `next` is a
    // Next.js project - including a "custom server" shape that also
    // depends on `express` (Next.js's own documented pattern of running
    // its request handler behind a hand-written `express()` app, which
    // would otherwise satisfy every fact this detector checks below). That
    // is one real process, correctly represented as exactly one
    // "frontend" service (`next`, see `adapters/nextFrontendDetection.ts`),
    // never also a separate "backend" (`express`) service at the same
    // root - Express must never claim this root, regardless of what its
    // entry files contain. Uses the exact same fact
    // `nextFrontendDetection.ts` itself requires, not a duplicated check.
    if (await hasNextDependency(fs, workspaceRootPath)) {
      return { candidates: [], diagnostics };
    }

    const candidates: BackendFrameworkEntryPointCandidate[] = [];
    const hasDependencyEvidence = await hasExpressDependency(fs, workspaceRootPath);

    for (const entryRelativePath of EXPRESS_ENTRY_POINT_CANDIDATES) {
      const entryPath = resolveWorkspacePath(workspaceRootPath, entryRelativePath);
      const check = await checkCandidatePath(fs, workspaceRootPath, entryPath, "Express entry point candidate");
      if (check.kind === "not-found") {
        continue;
      }
      if (check.kind === "unsafe") {
        diagnostics.push(check.diagnostic);
        continue;
      }

      const entryContent = await fs.readTextFile(entryPath);
      if (!hasExpressApplicationEvidence(entryContent)) {
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

/**
 * Direct `dependencies.express` only - never `devDependencies`. A
 * dev-only Express dependency (e.g. a Vite project's local API mock
 * server, or an integration-test-only `supertest`/`express` pairing) is not
 * a real Express backend.
 */
async function hasExpressDependency(fs: FileSystemProbe, workspaceRootPath: string): Promise<boolean> {
  const packageJsonPath = path.join(workspaceRootPath, EXPRESS_DEPENDENCY_FILE);
  if (!(await fs.fileExists(packageJsonPath))) {
    return false;
  }

  try {
    const parsed = JSON.parse(await fs.readTextFile(packageJsonPath)) as unknown;
    return hasOwnDependency(parsed, "express");
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
