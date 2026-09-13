import * as path from "node:path";
import type { ProjectFileWriter } from "../../../src/project/projectFileWriter";

function normalize(targetPath: string): string {
  return path.resolve(targetPath);
}

export class InMemoryProjectFileWriter implements ProjectFileWriter {
  public readonly files = new Map<string, string>();
  public readonly directories = new Set<string>();
  public readonly removedPaths: string[] = [];

  public preExistingFile(filePath: string, content = ""): this {
    this.files.set(normalize(filePath), content);
    this.registerParents(normalize(filePath));
    return this;
  }

  public preExistingDirectory(directoryPath: string): this {
    this.directories.add(normalize(directoryPath));
    return this;
  }

  public pathExists(targetPath: string): Promise<boolean> {
    const resolved = normalize(targetPath);
    return Promise.resolve(this.files.has(resolved) || this.directories.has(resolved));
  }

  public isDirectoryEmpty(directoryPath: string): Promise<boolean> {
    const resolved = normalize(directoryPath);
    if (!this.directories.has(resolved)) {
      return Promise.resolve(true);
    }
    const hasChild = [...this.files.keys(), ...this.directories].some(
      (entry) => entry !== resolved && path.dirname(entry) === resolved
    );
    return Promise.resolve(!hasChild);
  }

  public createDirectory(directoryPath: string): Promise<void> {
    const resolved = normalize(directoryPath);
    this.directories.add(resolved);
    this.registerParents(resolved);
    return Promise.resolve();
  }

  public writeTextFile(filePath: string, content: string, options: { readonly overwrite?: boolean } = {}): Promise<{ readonly written: boolean }> {
    const resolved = normalize(filePath);
    if (options.overwrite !== true && this.files.has(resolved)) {
      return Promise.resolve({ written: false });
    }
    this.files.set(resolved, content);
    this.registerParents(resolved);
    return Promise.resolve({ written: true });
  }

  public removePath(targetPath: string): Promise<void> {
    const resolved = normalize(targetPath);
    this.removedPaths.push(resolved);
    this.files.delete(resolved);
    this.directories.delete(resolved);
    for (const filePath of [...this.files.keys()]) {
      if (filePath.startsWith(resolved + path.sep)) {
        this.files.delete(filePath);
      }
    }
    for (const directoryPath of [...this.directories]) {
      if (directoryPath.startsWith(resolved + path.sep)) {
        this.directories.delete(directoryPath);
      }
    }
    return Promise.resolve();
  }

  private registerParents(childPath: string): void {
    let directory = path.dirname(childPath);
    let previous: string | undefined;
    while (directory !== previous) {
      this.directories.add(directory);
      previous = directory;
      directory = path.dirname(directory);
    }
  }
}
