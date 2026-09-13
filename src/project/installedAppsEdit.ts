export type InstalledAppsInsertion =
  | { readonly kind: "already-present" }
  | { readonly kind: "not-found" }
  | { readonly kind: "insert"; readonly lineIndex: number; readonly lineText: string };

/**
 * Matches only the common Django-generated shape:
 *   INSTALLED_APPS = [
 *       ...
 *   ]
 * A single-line list (open and close bracket on the same line) is
 * deliberately NOT matched - editing that would mean rewriting the line's
 * existing entries instead of just appending one, which is more surgery than
 * this is willing to risk getting wrong.
 */
const DECLARATION_PATTERN = /^\s*INSTALLED_APPS\s*(?::[^=]+)?=\s*\[\s*$/;

/**
 * Plans a single-line insertion into an existing INSTALLED_APPS list, or
 * reports why it could not (already listed, or no plain multi-line list
 * found) - kept vscode-free and line-based (not a real Python parser) so the
 * one thing this touches is exactly one new line, never anything else in
 * the file.
 */
export function planInstalledAppsInsertion(content: string, appName: string): InstalledAppsInsertion {
  const lines = content.split(/\r?\n/);
  const declarationIndex = lines.findIndex((line) => DECLARATION_PATTERN.test(line));
  if (declarationIndex === -1) {
    return { kind: "not-found" };
  }

  const closeIndex = findMatchingCloseLine(lines, declarationIndex);
  if (closeIndex === undefined) {
    return { kind: "not-found" };
  }

  const listLines = lines.slice(declarationIndex + 1, closeIndex);
  const quotedAppPattern = new RegExp(`["']${escapeRegExp(appName)}["']`);
  if (listLines.some((line) => quotedAppPattern.test(line))) {
    return { kind: "already-present" };
  }

  const indent = detectIndent(listLines);
  return { kind: "insert", lineIndex: closeIndex, lineText: `${indent}"${appName}",` };
}

function findMatchingCloseLine(lines: readonly string[], declarationIndex: number): number | undefined {
  let depth = 1;
  for (let index = declarationIndex + 1; index < lines.length; index++) {
    depth += countOccurrences(lines[index], "[") - countOccurrences(lines[index], "]");
    if (depth <= 0) {
      return index;
    }
  }
  return undefined;
}

function detectIndent(listLines: readonly string[]): string {
  const lastEntryLine = [...listLines].reverse().find((line) => line.trim().length > 0);
  const indentMatch = lastEntryLine === undefined ? null : /^(\s*)/.exec(lastEntryLine);
  const indent = indentMatch?.[1];
  return indent !== undefined && indent.length > 0 ? indent : "    ";
}

function countOccurrences(text: string, character: string): number {
  return text.split(character).length - 1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
