/**
 * Pure helper for spec §39 ("allow user to choose a new port where
 * supported"). Only the arithmetic is pure/testable - asking the user and
 * rebuilding the command live in the command handler that has the vscode
 * dialog and domain-specific command builder available.
 */
export function nextPortSuggestion(port: number): number {
  return port + 1;
}
