import type { NewProjectPreset } from "./newProjectPresets";

/**
 * Covers at least the entries spec §27 lists. Kept short and generic - this
 * is a starting point the user can extend, not an exhaustive template.
 */
export function buildGitignoreContent(): string {
  return `# Python
__pycache__/
*.py[cod]
.venv/
venv/
.env

# Django
db.sqlite3
staticfiles/

# Node
node_modules/
dist/

# Editors / OS
.DS_Store
Thumbs.db
`;
}

export interface RequirementsEntry {
  readonly name: string;
  readonly version: string;
}

/**
 * A short, intentional requirements.txt (spec §28: "a simple intentional
 * requirements.txt is preferable to a giant uncontrolled pip freeze") -
 * records exactly the packages this wizard itself installed, at the actual
 * version pip reported, not a speculative pin.
 */
export function buildRequirementsTxtContent(entries: readonly RequirementsEntry[]): string {
  return entries.map((entry) => `${entry.name}==${entry.version}`).join("\n") + "\n";
}

export function buildVSCodeSettingsContent(pythonInterpreterWorkspaceRelativePath: string): string {
  return `${JSON.stringify(
    {
      "python.defaultInterpreterPath": `\${workspaceFolder}/${pythonInterpreterWorkspaceRelativePath}`
    },
    null,
    2
  )}\n`;
}

export function buildDocsReadmeContent(): string {
  return `# Docs

Project architecture, planning, and other documentation can be stored here.
`;
}

export interface ReadmeContext {
  readonly projectName: string;
  readonly preset: NewProjectPreset;
  /** Just the venv's own folder name (e.g. ".venv"), not a path - used both in the tree diagram and the activate command run from inside backend/. */
  readonly venvDirectoryName: string;
  readonly packageManager?: string;
  readonly backendHost: string;
  readonly backendPort: number;
  readonly frontendPort: number;
}

/**
 * Concise by design (spec §34: "documentation, not an enormous framework
 * tutorial") - structure, setup, manual equivalent commands, default URLs,
 * and a venv note, nothing more.
 */
export function buildReadmeContent(context: ReadmeContext): string {
  const lines: string[] = [`# ${context.projectName}`, "", `Generated with the **${context.preset.label}** preset.`, "", "## Project structure", "", "```text"];

  lines.push(`${context.projectName}/`, "├── backend/", `│   ├── ${context.venvDirectoryName}/`, "│   ├── manage.py", "│   └── requirements.txt");
  if (context.preset.includesFrontend) {
    lines.push("├── frontend/", "│   ├── src/", "│   └── package.json");
  }
  lines.push("├── docs/", "├── .vscode/", "├── .gitignore", "└── README.md", "```", "");

  lines.push(
    "## Backend setup",
    "",
    "```sh",
    "cd backend",
    `${context.venvDirectoryName}\\Scripts\\activate   # Windows`,
    `source ${context.venvDirectoryName}/bin/activate  # macOS/Linux`,
    "python manage.py migrate",
    `python manage.py runserver ${context.backendHost}:${context.backendPort}`,
    "```",
    ""
  );

  if (context.preset.includesFrontend && context.packageManager !== undefined) {
    lines.push(
      "## Frontend setup",
      "",
      "```sh",
      "cd frontend",
      `${context.packageManager} install`,
      `${context.packageManager}${context.packageManager === "npm" ? " run" : ""} dev`,
      "```",
      ""
    );
  }

  lines.push("## Default local URLs", "", `- Backend: http://${context.backendHost}:${context.backendPort}/`);
  if (context.preset.includesFrontend) {
    lines.push(`- Frontend: http://127.0.0.1:${context.frontendPort}/ (Vite may choose a different port if this one is busy)`);
  }
  lines.push("", "## Notes", "", `- The backend's virtual environment lives at \`backend/${context.venvDirectoryName}\` and is not committed to Git.`, "");

  return lines.join("\n");
}
