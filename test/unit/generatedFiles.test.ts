import assert from "node:assert/strict";
import test from "node:test";

import { findPreset } from "../../src/project/newProjectPresets";
import {
  buildDocsReadmeContent,
  buildGitignoreContent,
  buildReadmeContent,
  buildRequirementsTxtContent,
  buildVSCodeSettingsContent
} from "../../src/project/generatedFiles";

void test("gitignore covers the entries the spec lists", () => {
  const content = buildGitignoreContent();
  for (const entry of [".venv/", "node_modules/", "db.sqlite3", "__pycache__/", ".env", "dist/"]) {
    assert.ok(content.includes(entry), `expected gitignore to include "${entry}"`);
  }
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

void test("vscode settings reference the interpreter via a portable workspaceFolder-relative path", () => {
  const content = buildVSCodeSettingsContent("backend/.venv/Scripts/python.exe");
  const parsed = JSON.parse(content) as Record<string, unknown>;
  assert.equal(parsed["python.defaultInterpreterPath"], "${workspaceFolder}/backend/.venv/Scripts/python.exe");
});

void test("docs README explains the folder's purpose without being a tutorial", () => {
  const content = buildDocsReadmeContent();
  assert.ok(content.includes("Docs"));
  assert.ok(content.length < 300);
});

void test("README includes structure, setup, URLs, and a venv note for a full-stack preset", () => {
  const content = buildReadmeContent({
    projectName: "kunden-portal",
    preset: findPreset("django-vite-react-ts"),
    venvDirectoryName: ".venv",
    packageManager: "npm",
    backendHost: "127.0.0.1",
    backendPort: 8000,
    frontendPort: 5173
  });

  assert.ok(content.includes("kunden-portal"));
  assert.ok(content.includes("frontend/"));
  assert.ok(content.includes("http://127.0.0.1:8000/"));
  assert.ok(content.includes("http://127.0.0.1:5173/"));
  assert.ok(content.includes("cd frontend"));
  assert.ok(content.includes("npm install"));
  assert.ok(content.includes("not committed to Git"));
});

void test("README omits frontend setup and URL for the Django-only preset", () => {
  const content = buildReadmeContent({
    projectName: "backend-only-project",
    preset: findPreset("django-only"),
    venvDirectoryName: ".venv",
    backendHost: "127.0.0.1",
    backendPort: 8000,
    frontendPort: 5173
  });

  assert.ok(!content.includes("frontend/"));
  assert.ok(!content.includes("Frontend setup"));
});
