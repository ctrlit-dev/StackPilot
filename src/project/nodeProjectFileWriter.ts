import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { ProjectFileWriter } from "./projectFileWriter";

export class NodeProjectFileWriter implements ProjectFileWriter {
  public async pathExists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  public async isDirectoryEmpty(directoryPath: string): Promise<boolean> {
    try {
      const entries = await fs.readdir(directoryPath);
      return entries.length === 0;
    } catch (error: unknown) {
      if (isMissingError(error)) {
        return true;
      }
      throw error;
    }
  }

  public async createDirectory(directoryPath: string): Promise<void> {
    await fs.mkdir(directoryPath, { recursive: true });
  }

  public async writeTextFile(
    filePath: string,
    content: string,
    options: { readonly overwrite?: boolean } = {}
  ): Promise<{ readonly written: boolean }> {
    if (options.overwrite !== true && (await this.pathExists(filePath))) {
      return { written: false };
    }

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf8");
    return { written: true };
  }

  public async removePath(targetPath: string): Promise<void> {
    await fs.rm(targetPath, { recursive: true, force: true });
  }
}

function isMissingError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
