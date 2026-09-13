/**
 * Extracts the "Version: X.Y.Z" line from `pip show <package>` output (spec
 * §28: "determine installed Django version" - verified empirically against
 * real pip output rather than assumed).
 */
export function parseInstalledVersion(pipShowOutput: string): string | undefined {
  const match = /^Version:\s*(.+)$/m.exec(pipShowOutput);
  return match?.[1]?.trim();
}
