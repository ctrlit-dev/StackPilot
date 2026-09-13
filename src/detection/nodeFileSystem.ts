import { promises as fs } from "node:fs";

import type { FileSystemProbe } from "./fileSystem";

export class NodeFileSystemProbe implements FileSystemProbe {
  public async fileExists(filePath: string): Promise<boolean> {
    return this.existsAs(filePath, "file");
  }

  public async directoryExists(directoryPath: string): Promise<boolean> {
    return this.existsAs(directoryPath, "directory");
  }

  public async readTextFile(filePath: string): Promise<string> {
    return fs.readFile(filePath, "utf8");
  }

  public async realPath(targetPath: string): Promise<string | undefined> {
    try {
      return await fs.realpath(targetPath);
    } catch (error: unknown) {
      if (isNodeFileSystemMissingError(error)) {
        return undefined;
      }

      throw error;
    }
  }

  public async listDirectoryNames(directoryPath: string): Promise<string[]> {
    try {
      return await fs.readdir(directoryPath);
    } catch (error: unknown) {
      if (isNodeFileSystemMissingError(error)) {
        return [];
      }

      throw error;
    }
  }

  private async existsAs(filePath: string, expectedType: "file" | "directory"): Promise<boolean> {
    try {
      const stat = await fs.stat(filePath);
      return expectedType === "file" ? stat.isFile() : stat.isDirectory();
    } catch (error: unknown) {
      if (isNodeFileSystemMissingError(error)) {
        return false;
      }

      throw error;
    }
  }
}

function isNodeFileSystemMissingError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    // ENOENT/ENOTDIR: the path genuinely does not exist. EACCES/EPERM: Windows
    // "App execution alias" stubs (e.g. WindowsApps\python.exe) reject stat()
    // for non-packaged processes even though the stub file is listed - treat
    // that the same as "not found" rather than failing the whole probe.
    (error.code === "ENOENT" || error.code === "ENOTDIR" || error.code === "EACCES" || error.code === "EPERM")
  );
}
