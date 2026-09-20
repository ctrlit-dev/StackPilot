import type { FrontendFrameworkAdapter } from "./frontendFrameworkAdapter";

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_PATTERN = /\x1b\[[0-9;]*m/g;

/**
 * Matches Next.js's own dev-server "- Local:   http://localhost:3000" line -
 * empirically captured against a real `create-next-app@latest` scaffold
 * running `next dev` (Next.js 16.3.5, NEXTJS-1B.0), for both a normal start
 * and a port-collision fallback start (same shape, different port). The
 * leading "-" is required so this can never match the sibling
 * "- Network: ..." line (a different word) or unrelated text that merely
 * contains the substring "Local:" without this line's own dash prefix.
 */
const NEXT_LOCAL_URL_PATTERN = /-\s*Local:\s+(https?:\/\/\S+)/;

/**
 * ANSI-stripped first, mirroring `viteFrontendAdapter.ts`'s own approach -
 * NEXTJS-1B.0's captured output had no color codes embedded in the content
 * lines themselves (unlike Vite's bold-wrapped port digits), but did
 * contain a stray cursor-visibility escape sequence elsewhere in the same
 * stream. Stripping defensively costs nothing and matches this codebase's
 * existing precedent for reading untrusted process output.
 */
function parseNextLocalUrl(text: string): string | undefined {
  const stripped = text.replace(ANSI_ESCAPE_PATTERN, "");
  return NEXT_LOCAL_URL_PATTERN.exec(stripped)?.[1];
}

export const nextFrontendAdapter: FrontendFrameworkAdapter = {
  id: "next",

  parseDevServerUrl(outputChunk) {
    return parseNextLocalUrl(outputChunk);
  }
};
