import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDocsReadmeContent,
  buildRequirementsTxtContent,
  composeConfirmationSummaryLines,
  composeGitignoreContent,
  composeReadmeContent,
  composeVSCodeSettingsContent
} from "../../src/project/generatedFiles";

void test("confirmation summary composes Location, the backend's own lines verbatim, and Git, in that order", () => {
  const lines = composeConfirmationSummaryLines({
    projectRoot: "C:\\Users\\dev\\kunden-portal",
    backendSummary: ["Preset: Django + Vite React + TypeScript", "Python: C:\\Python313\\python.exe", "Virtual environment: backend/.venv", "Django package: config", "Package manager: npm"],
    initializeGit: true
  });

  assert.deepEqual(lines, [
    "Location: C:\\Users\\dev\\kunden-portal",
    "Preset: Django + Vite React + TypeScript",
    "Python: C:\\Python313\\python.exe",
    "Virtual environment: backend/.venv",
    "Django package: config",
    "Package manager: npm",
    "Git repository: Initialize"
  ]);
});

void test("confirmation summary reports Git repository: Skip when git was not requested, and passes through an empty backend summary", () => {
  const lines = composeConfirmationSummaryLines({ projectRoot: "C:\\project", backendSummary: [], initializeGit: false });
  assert.deepEqual(lines, ["Location: C:\\project", "Git repository: Skip"]);
});

void test("gitignore covers the entries the spec lists, with the backend's own entries inserted between the Python and Node blocks", () => {
  const content = composeGitignoreContent(["# Django", "db.sqlite3", "staticfiles/"]);
  for (const entry of [".venv/", "node_modules/", "db.sqlite3", "__pycache__/", ".env", "dist/"]) {
    assert.ok(content.includes(entry), `expected gitignore to include "${entry}"`);
  }
  assert.equal(
    content,
    "# Python\n__pycache__/\n*.py[cod]\n.venv/\nvenv/\n.env\n\n# Django\ndb.sqlite3\nstaticfiles/\n\n# Node\nnode_modules/\ndist/\n\n# Editors / OS\n.DS_Store\nThumbs.db\n"
  );
});

void test("gitignore with no backend-specific entries still contains the generic blocks", () => {
  const content = composeGitignoreContent([]);
  assert.ok(content.includes("__pycache__/"));
  assert.ok(content.includes("node_modules/"));
});

void test("requirements.txt pins exactly the given packages at their reported versions", () => {
  const content = buildRequirementsTxtContent([
    { name: "Django", version: "6.1.1" },
    { name: "djangorestframework", version: "3.15.2" }
  ]);
  assert.equal(content, "Django==6.1.1\ndjangorestframework==3.15.2\n");
});

void test("requirements.txt with a single package has no stray blank lines", () => {
  assert.equal(buildRequirementsTxtContent([{ name: "Django", version: "6.1.1" }]), "Django==6.1.1\n");
});

void test("vscode settings render generic, already-resolved settings verbatim", () => {
  const content = composeVSCodeSettingsContent({ "python.defaultInterpreterPath": "${workspaceFolder}/backend/.venv/Scripts/python.exe" });
  const parsed = JSON.parse(content) as Record<string, unknown>;
  assert.equal(parsed["python.defaultInterpreterPath"], "${workspaceFolder}/backend/.venv/Scripts/python.exe");
});

void test("docs README explains the folder's purpose without being a tutorial", () => {
  const content = buildDocsReadmeContent();
  assert.ok(content.includes("Docs"));
  assert.ok(content.length < 300);
});

const backendSection = {
  heading: "Backend setup",
  treeLines: ["├── backend/", "│   ├── .venv/", "│   ├── manage.py", "│   └── requirements.txt"],
  setupCommands: ["cd backend", ".venv\\Scripts\\activate   # Windows", "source .venv/bin/activate  # macOS/Linux", "python manage.py migrate", "python manage.py runserver 127.0.0.1:8000"],
  defaultUrlLine: "- Backend: http://127.0.0.1:8000/"
};
const backendNotes = ["- The backend's virtual environment lives at `backend/.venv` and is not committed to Git."];

const frontendSection = {
  heading: "Frontend setup",
  treeLines: ["├── frontend/", "│   ├── src/", "│   └── package.json"],
  setupCommands: ["cd frontend", "npm install", "npm run dev"],
  defaultUrlLine: "- Frontend: http://127.0.0.1:5173/ (Vite may choose a different port if this one is busy)"
};

void test("README includes structure, setup, URLs, and a venv note for a full-stack preset", () => {
  const content = composeReadmeContent({
    projectName: "kunden-portal",
    headerNote: "Generated with the **Django + Vite React + TypeScript** preset.",
    backendSection,
    backendNotes,
    frontendSection
  });

  assert.ok(content.includes("kunden-portal"));
  assert.ok(content.includes("frontend/"));
  assert.ok(content.includes("http://127.0.0.1:8000/"));
  assert.ok(content.includes("http://127.0.0.1:5173/"));
  assert.ok(content.includes("cd frontend"));
  assert.ok(content.includes("npm install"));
  assert.ok(content.includes("not committed to Git"));
});

void test("README omits frontend setup and URL when no frontend section is given", () => {
  const content = composeReadmeContent({
    projectName: "backend-only-project",
    headerNote: "Generated with the **Django only** preset.",
    backendSection,
    backendNotes
  });

  assert.ok(!content.includes("frontend/"));
  assert.ok(!content.includes("Frontend setup"));
});

void test("README structure matches the pre-CREATE-ARCH-1B byte-for-byte shape for a full-stack Django run", () => {
  const content = composeReadmeContent({
    projectName: "kunden-portal",
    headerNote: "Generated with the **Django + Vite React + TypeScript** preset.",
    backendSection,
    backendNotes,
    frontendSection
  });

  const expected = [
    "# kunden-portal",
    "",
    "Generated with the **Django + Vite React + TypeScript** preset.",
    "",
    "## Project structure",
    "",
    "```text",
    "kunden-portal/",
    "├── backend/",
    "│   ├── .venv/",
    "│   ├── manage.py",
    "│   └── requirements.txt",
    "├── frontend/",
    "│   ├── src/",
    "│   └── package.json",
    "├── docs/",
    "├── .vscode/",
    "├── .gitignore",
    "└── README.md",
    "```",
    "",
    "## Backend setup",
    "",
    "```sh",
    "cd backend",
    ".venv\\Scripts\\activate   # Windows",
    "source .venv/bin/activate  # macOS/Linux",
    "python manage.py migrate",
    "python manage.py runserver 127.0.0.1:8000",
    "```",
    "",
    "## Frontend setup",
    "",
    "```sh",
    "cd frontend",
    "npm install",
    "npm run dev",
    "```",
    "",
    "## Default local URLs",
    "",
    "- Backend: http://127.0.0.1:8000/",
    "- Frontend: http://127.0.0.1:5173/ (Vite may choose a different port if this one is busy)",
    "",
    "## Notes",
    "",
    "- The backend's virtual environment lives at `backend/.venv` and is not committed to Git.",
    ""
  ].join("\n");

  assert.equal(content, expected);
});
