import type { ReadmeSection } from "./create/projectCreateModule";

export interface ComposeConfirmationSummaryOptions {
  readonly projectRoot: string;
  readonly backendSummary: readonly string[];
  readonly initializeGit: boolean;
}

/**
 * The final New Project confirmation dialog's content - "Location" and
 * "Git repository" are generic (CREATE-ARCH-1B.1 correction: neither is a
 * backend-specific fact), `backendSummary` is the chosen backend's own,
 * already-formatted lines (e.g. Django's "Preset: ..."/"Python: ..."),
 * passed straight through, never interpreted here.
 */
export function composeConfirmationSummaryLines(options: ComposeConfirmationSummaryOptions): readonly string[] {
  return [`Location: ${options.projectRoot}`, ...options.backendSummary, `Git repository: ${options.initializeGit ? "Initialize" : "Skip"}`];
}

/**
 * Covers at least the entries spec §27 lists. Kept short and generic - this
 * is a starting point the user can extend, not an exhaustive template.
 * `backendEntries` are literal lines (comments included) contributed by the
 * chosen backend module - e.g. Django's own ["# Django", "db.sqlite3",
 * "staticfiles/"] - inserted between the always-present Python and Node
 * blocks, reproducing today's Django output byte-for-byte.
 */
export function composeGitignoreContent(backendEntries: readonly string[]): string {
  const lines = [
    "# Python",
    "__pycache__/",
    "*.py[cod]",
    ".venv/",
    "venv/",
    ".env",
    "",
    ...backendEntries,
    "",
    "# Node",
    "node_modules/",
    "dist/",
    "",
    "# Editors / OS",
    ".DS_Store",
    "Thumbs.db"
  ];
  return `${lines.join("\n")}\n`;
}

export interface RequirementsEntry {
  readonly name: string;
  readonly version: string;
}

/**
 * A short, intentional requirements.txt (spec §28: "a simple intentional
 * requirements.txt is preferable to a giant uncontrolled pip freeze") -
 * records exactly the packages the chosen backend module itself installed,
 * at the actual version pip reported, not a speculative pin.
 */
export function buildRequirementsTxtContent(entries: readonly RequirementsEntry[]): string {
  return entries.map((entry) => `${entry.name}==${entry.version}`).join("\n") + "\n";
}

/** Generic - takes already-resolved settings (e.g. a full `${workspaceFolder}/...` value), not a Django-specific relative path. */
export function composeVSCodeSettingsContent(settings: Readonly<Record<string, string>>): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}

export function buildDocsReadmeContent(): string {
  return `# Docs

Project architecture, planning, and other documentation can be stored here.
`;
}

export interface ComposeReadmeContentOptions {
  readonly projectName: string;
  readonly headerNote: string;
  readonly backendSection: ReadmeSection;
  readonly backendNotes: readonly string[];
  readonly frontendSection?: ReadmeSection;
}

/**
 * Concise by design (spec §34: "documentation, not an enormous framework
 * tutorial") - structure, setup, manual equivalent commands, default URLs,
 * and notes, nothing more. Assembles the backend's own section, the
 * frontend's own section (when present), and the fixed generic headings
 * around them - the same overall shape the pre-CREATE-ARCH-1B Django-only
 * buildReadmeContent() produced, now composed from structured fragments
 * instead of hardcoding Django's own content inline.
 */
export function composeReadmeContent(options: ComposeReadmeContentOptions): string {
  const lines: string[] = [`# ${options.projectName}`, "", options.headerNote, "", "## Project structure", "", "```text"];

  lines.push(`${options.projectName}/`, ...options.backendSection.treeLines);
  if (options.frontendSection !== undefined) {
    lines.push(...options.frontendSection.treeLines);
  }
  lines.push("├── docs/", "├── .vscode/", "├── .gitignore", "└── README.md", "```", "");

  lines.push(`## ${options.backendSection.heading}`, "", "```sh", ...options.backendSection.setupCommands, "```", "");

  if (options.frontendSection !== undefined) {
    lines.push("## Frontend setup", "", "```sh", ...options.frontendSection.setupCommands, "```", "");
  }

  lines.push("## Default local URLs", "", options.backendSection.defaultUrlLine);
  if (options.frontendSection !== undefined) {
    lines.push(options.frontendSection.defaultUrlLine);
  }
  lines.push("", "## Notes", "", ...options.backendNotes, "");

  return lines.join("\n");
}
