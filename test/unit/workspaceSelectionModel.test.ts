import assert from "node:assert/strict";
import test from "node:test";
import { resolveWorkspaceSelection, type WorkspaceFolderReference } from "../../src/state/workspaceSelectionModel";

const backendFolder: WorkspaceFolderReference = {
  uri: "file:///workspace/backend",
  name: "backend",
  index: 0
};

const frontendFolder: WorkspaceFolderReference = {
  uri: "file:///workspace/frontend",
  name: "frontend",
  index: 1
};

void test("workspace selection reports no workspace when no folders are open", () => {
  assert.deepEqual(resolveWorkspaceSelection([], undefined), { kind: "none" });
});

void test("workspace selection safely selects a single folder without persisted state", () => {
  assert.deepEqual(resolveWorkspaceSelection([backendFolder], undefined), {
    kind: "selected",
    folder: backendFolder,
    source: "single-folder"
  });
});

void test("workspace selection uses a stored folder only when it still exists", () => {
  assert.deepEqual(resolveWorkspaceSelection([backendFolder, frontendFolder], frontendFolder.uri), {
    kind: "selected",
    folder: frontendFolder,
    source: "stored"
  });
});

void test("workspace selection does not choose arbitrarily in ambiguous multi-root workspaces", () => {
  assert.deepEqual(resolveWorkspaceSelection([backendFolder, frontendFolder], undefined), {
    kind: "ambiguous",
    folders: [backendFolder, frontendFolder],
    storedUri: undefined
  });
});

void test("workspace selection stays ambiguous when stored workspace is gone", () => {
  assert.deepEqual(resolveWorkspaceSelection([backendFolder, frontendFolder], "file:///workspace/missing"), {
    kind: "ambiguous",
    folders: [backendFolder, frontendFolder],
    storedUri: "file:///workspace/missing"
  });
});
