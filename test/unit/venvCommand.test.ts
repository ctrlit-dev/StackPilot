import assert from "node:assert/strict";
import test from "node:test";

import type { DetectedProject } from "../../src/detection/detectedProject";
import type { PythonEnvironment } from "../../src/detection/pythonDetector";
import { buildCreateVenvCommand, findBasePython } from "../../src/execution/venvCommand";

function project(candidates: readonly PythonEnvironment[]): DetectedProject {
  return {
    workspaceRootPath: "/workspace",
    services: [],
    pythonRuntime: { selected: undefined, candidates, diagnostics: [] },
    diagnostics: []
  };
}

void test("findBasePython returns undefined when nothing was detected", () => {
  assert.equal(findBasePython(undefined, "/workspace/backend/.venv"), undefined);
});

void test("findBasePython picks a PATH interpreter when nothing else is available", () => {
  const pathPython: PythonEnvironment = { executablePath: "C:\\Python313\\python.exe", source: "path", validation: "exists" };
  const result = findBasePython(project([pathPython]), "/workspace/backend/.venv");
  assert.equal(result, pathPython);
});

void test("findBasePython skips a candidate that lives inside the target venv being (re)created", () => {
  const targetVenvPath = "/workspace/backend/.venv";
  const brokenVenvPython: PythonEnvironment = {
    executablePath: "/workspace/backend/.venv/bin/python",
    source: "venv",
    validation: "exists",
    environmentPath: targetVenvPath
  };
  const pathPython: PythonEnvironment = { executablePath: "/usr/bin/python3", source: "path", validation: "exists" };

  const result = findBasePython(project([brokenVenvPython, pathPython]), targetVenvPath);
  assert.equal(result, pathPython);
});

void test("buildCreateVenvCommand builds '<python> -m venv <path>'", () => {
  const python: PythonEnvironment = { executablePath: "/usr/bin/python3", source: "path", validation: "exists" };
  const command = buildCreateVenvCommand(python, "/workspace/backend/.venv", "/workspace");
  assert.equal(command.executable, "/usr/bin/python3");
  assert.deepEqual(command.args, ["-m", "venv", "/workspace/backend/.venv"]);
  assert.equal(command.cwd, "/workspace");
});
