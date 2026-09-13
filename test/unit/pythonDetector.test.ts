import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import { DEFAULT_CONFIGURATION, type StackPilotConfiguration } from "../../src/config/configurationModel";
import { detectPythonEnvironment } from "../../src/detection/pythonDetector";
import { InMemoryFileSystemProbe } from "./fakes/inMemoryFileSystem";

const workspaceRoot = path.resolve("pc-test-fixtures", "python-detector");

function configuration(overrides: Partial<StackPilotConfiguration> = {}): StackPilotConfiguration {
  return { ...DEFAULT_CONFIGURATION, ...overrides };
}

void test("detects a Windows-style virtual environment interpreter", async () => {
  const venvPath = path.join(workspaceRoot, "backend", ".venv");
  const fs = new InMemoryFileSystemProbe().addFile(path.join(venvPath, "Scripts", "python.exe"));

  const result = await detectPythonEnvironment(fs, workspaceRoot, path.join(workspaceRoot, "backend"), configuration());

  assert.equal(result.selected?.executablePath, path.join(venvPath, "Scripts", "python.exe"));
  assert.equal(result.selected?.source, "venv");
});

void test("detects a POSIX-style virtual environment interpreter", async () => {
  const venvPath = path.join(workspaceRoot, "backend", ".venv");
  const fs = new InMemoryFileSystemProbe().addFile(path.join(venvPath, "bin", "python"));

  const result = await detectPythonEnvironment(fs, workspaceRoot, path.join(workspaceRoot, "backend"), configuration());

  assert.equal(result.selected?.executablePath, path.join(venvPath, "bin", "python"));
  assert.equal(result.selected?.source, "venv");
});

void test("reports no interpreter when no virtual environment exists", async () => {
  const fs = new InMemoryFileSystemProbe();

  const result = await detectPythonEnvironment(fs, workspaceRoot, path.join(workspaceRoot, "backend"), configuration());

  assert.equal(result.selected, undefined);
});

void test("prefers a configured interpreter over a detected virtual environment", async () => {
  const configuredPath = path.join(workspaceRoot, "tools", "python.exe");
  const venvPath = path.join(workspaceRoot, "backend", ".venv");
  const fs = new InMemoryFileSystemProbe()
    .addFile(configuredPath)
    .addFile(path.join(venvPath, "Scripts", "python.exe"));

  const result = await detectPythonEnvironment(
    fs,
    workspaceRoot,
    path.join(workspaceRoot, "backend"),
    configuration({ pythonInterpreter: "tools/python.exe" })
  );

  assert.equal(result.selected?.executablePath, configuredPath);
  assert.equal(result.selected?.source, "configured");
});

void test("reports a diagnostic and falls back when the configured interpreter is broken", async () => {
  const venvPath = path.join(workspaceRoot, "backend", ".venv");
  const fs = new InMemoryFileSystemProbe().addFile(path.join(venvPath, "Scripts", "python.exe"));

  const result = await detectPythonEnvironment(
    fs,
    workspaceRoot,
    path.join(workspaceRoot, "backend"),
    configuration({ pythonInterpreter: "tools/missing-python.exe" })
  );

  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.includes("was not found")));
  assert.equal(result.selected?.executablePath, path.join(venvPath, "Scripts", "python.exe"));
  assert.equal(result.selected?.source, "venv");
});

void test("falls back to a Python interpreter found on PATH when no venv exists", async () => {
  const pathDirectory = path.resolve(workspaceRoot, "tools", "python312");
  const executablePath = path.join(pathDirectory, "python.exe");
  const fs = new InMemoryFileSystemProbe().addFile(executablePath);

  const result = await detectPythonEnvironment(
    fs,
    workspaceRoot,
    path.join(workspaceRoot, "backend"),
    configuration(),
    undefined,
    pathDirectory
  );

  assert.equal(result.selected?.executablePath, executablePath);
  assert.equal(result.selected?.source, "path");
});

void test("prefers a project-local virtual environment over a PATH interpreter", async () => {
  const venvPath = path.join(workspaceRoot, "backend", ".venv");
  const pathDirectory = path.resolve(workspaceRoot, "tools", "python312");
  const fs = new InMemoryFileSystemProbe()
    .addFile(path.join(venvPath, "Scripts", "python.exe"))
    .addFile(path.join(pathDirectory, "python.exe"));

  const result = await detectPythonEnvironment(
    fs,
    workspaceRoot,
    path.join(workspaceRoot, "backend"),
    configuration(),
    undefined,
    pathDirectory
  );

  assert.equal(result.selected?.source, "venv");
});

void test("detects a virtual environment at a workspace root containing spaces and Unicode characters", async () => {
  const unicodeWorkspaceRoot = path.resolve("pc-test-fixtures", "Projekt Ördner 日本語");
  const venvPath = path.join(unicodeWorkspaceRoot, "backend", ".venv");
  const fs = new InMemoryFileSystemProbe().addFile(path.join(venvPath, "Scripts", "python.exe"));

  const result = await detectPythonEnvironment(fs, unicodeWorkspaceRoot, path.join(unicodeWorkspaceRoot, "backend"), configuration());

  assert.equal(result.selected?.executablePath, path.join(venvPath, "Scripts", "python.exe"));
});
