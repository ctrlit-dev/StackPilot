import type { FrontendFrameworkAdapter } from "./frontendFrameworkAdapter";

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_PATTERN = /\x1b\[[0-9;]*m/g;
const VITE_LOCAL_URL_PATTERN = /Local:\s+(https?:\/\/\S+)/;

/**
 * Extracts Vite's actual bound URL from its dev-server output (spec §15/§62:
 * "Do not assume port 5173 if Vite selected another port... Frontend
 * default should use the detected dev server URL when available"). Verified
 * empirically against real `npm run dev` output: Vite's "Local:" line has
 * the port number wrapped in its own ANSI bold escape sequence
 * (`http://localhost:` + "\x1b[1m" + "5173" + "\x1b[22m" + "/"), so ANSI
 * codes must be stripped before matching or the port digits are missed.
 * Not a reusable generic ANSI-stripping utility on purpose - this is the
 * only place in the codebase that needs it, and it exists purely as a means
 * to read Vite's own output shape.
 */
function parseViteLocalUrl(text: string): string | undefined {
  const stripped = text.replace(ANSI_ESCAPE_PATTERN, "");
  return VITE_LOCAL_URL_PATTERN.exec(stripped)?.[1];
}

export const viteFrontendAdapter: FrontendFrameworkAdapter = {
  id: "vite",

  parseDevServerUrl(outputChunk) {
    return parseViteLocalUrl(outputChunk);
  }
};
