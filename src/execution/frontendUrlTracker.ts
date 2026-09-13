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
 */
export function parseViteLocalUrl(text: string): string | undefined {
  const stripped = text.replace(ANSI_ESCAPE_PATTERN, "");
  return VITE_LOCAL_URL_PATTERN.exec(stripped)?.[1];
}

/**
 * Vite's "Local:" line can arrive split across separate stdout chunks at the
 * OS pipe level, so this accumulates a small rolling buffer rather than
 * matching each chunk in isolation. Bounded to avoid unbounded growth if the
 * URL line never appears (e.g. a non-Vite dev script).
 */
const MAX_BUFFER_LENGTH = 4096;

export class FrontendUrlTracker {
  private buffer = "";
  private url: string | undefined;

  public feed(chunk: string): void {
    if (this.url !== undefined) {
      return;
    }

    this.buffer = (this.buffer + chunk).slice(-MAX_BUFFER_LENGTH);
    this.url = parseViteLocalUrl(this.buffer);
  }

  public getUrl(): string | undefined {
    return this.url;
  }

  public reset(): void {
    this.buffer = "";
    this.url = undefined;
  }
}
