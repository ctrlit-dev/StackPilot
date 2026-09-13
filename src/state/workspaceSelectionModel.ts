export interface WorkspaceFolderReference {
  readonly uri: string;
  readonly name: string;
  readonly index: number;
}

export type WorkspaceSelectionResult =
  | { readonly kind: "none" }
  | { readonly kind: "selected"; readonly folder: WorkspaceFolderReference; readonly source: "single-folder" | "stored" | "user" }
  | { readonly kind: "ambiguous"; readonly folders: readonly WorkspaceFolderReference[]; readonly storedUri?: string };

export function resolveWorkspaceSelection(
  folders: readonly WorkspaceFolderReference[],
  storedUri: string | undefined
): WorkspaceSelectionResult {
  if (folders.length === 0) {
    return { kind: "none" };
  }

  if (folders.length === 1) {
    return {
      kind: "selected",
      folder: folders[0],
      source: "single-folder"
    };
  }

  const storedFolder = storedUri === undefined ? undefined : folders.find((folder) => folder.uri === storedUri);
  if (storedFolder !== undefined) {
    return {
      kind: "selected",
      folder: storedFolder,
      source: "stored"
    };
  }

  return {
    kind: "ambiguous",
    folders,
    storedUri
  };
}
