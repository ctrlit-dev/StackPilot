const TOKEN_PATTERN = /"([^"]*)"|'([^']*)'|(\S+)/g;

/**
 * Splits a free-form command line into argv-style tokens, honoring
 * "double" and 'single' quoted segments (e.g. --exclude "auth.permission")
 * so a quoted value containing spaces is not split apart.
 */
export function splitCommandArguments(input: string): string[] {
  const args: string[] = [];
  for (const match of input.matchAll(TOKEN_PATTERN)) {
    args.push(match[1] ?? match[2] ?? match[3]);
  }
  return args;
}
