import * as path from "node:path";

import type { FileSystemProbe } from "../../../src/detection/fileSystem";

function normalize(targetPath: string): string {
  return path.resolve(targetPath);
}

export class InMemoryFileSystemProbe implements FileSystemProbe {
  private readonly files = new Map<string, string>();
  private readonly directories = new Set<string>();
  private readonly symlinks = new Map<string, string>();

  public addFile(filePath: string, content = ""): this {
    const normalizedPath = normalize(filePath);
    this.files.set(normalizedPath, content);
    this.registerParentDirectories(normalizedPath);

    return this;
  }

  public addDirectory(directoryPath: string): this {
    this.directories.add(normalize(directoryPath));
    return this;
  }

  /**
   * Registers `linkPath` as a symlink pointing at `targetPath`, mirroring how a
   * real filesystem symlink resolves. Used to test that detection rejects
   * candidates which escape the workspace through a symlink.
   */
  public addSymlink(linkPath: string, targetPath: string): this {
    const normalizedLink = normalize(linkPath);
    this.symlinks.set(normalizedLink, normalize(targetPath));
    this.registerParentDirectories(normalizedLink);

    return this;
  }

  public fileExists(filePath: string): Promise<boolean> {
    const resolved = this.resolveSymlinks(filePath);
    return Promise.resolve(resolved !== undefined && this.files.has(resolved));
  }

  public directoryExists(directoryPath: string): Promise<boolean> {
    const resolved = this.resolveSymlinks(directoryPath);
    return Promise.resolve(resolved !== undefined && this.directories.has(resolved));
  }

  public readTextFile(filePath: string): Promise<string> {
    const resolved = this.resolveSymlinks(filePath);
    const content = resolved === undefined ? undefined : this.files.get(resolved);
    if (content === undefined) {
      const error = new Error(`ENOENT: no such file, open '${filePath}'`) as NodeJS.ErrnoException;
      error.code = "ENOENT";
      return Promise.reject(error);
    }

    return Promise.resolve(content);
  }

  public realPath(targetPath: string): Promise<string | undefined> {
    const resolved = this.resolveSymlinks(targetPath);
    if (resolved === undefined || (!this.files.has(resolved) && !this.directories.has(resolved))) {
      return Promise.resolve(undefined);
    }

    return Promise.resolve(resolved);
  }

  public listDirectoryNames(directoryPath: string): Promise<string[]> {
    const resolved = this.resolveSymlinks(directoryPath);
    if (resolved === undefined || !this.directories.has(resolved)) {
      return Promise.resolve([]);
    }

    const names = new Set<string>();
    for (const filePath of this.files.keys()) {
      if (path.dirname(filePath) === resolved) {
        names.add(path.basename(filePath));
      }
    }
    for (const directory of this.directories) {
      if (directory !== resolved && path.dirname(directory) === resolved) {
        names.add(path.basename(directory));
      }
    }

    return Promise.resolve([...names]);
  }

  private registerParentDirectories(childPath: string): void {
    let directory = path.dirname(childPath);
    let previous: string | undefined;
    while (directory !== previous) {
      this.directories.add(directory);
      previous = directory;
      directory = path.dirname(directory);
    }
  }

  /**
   * Follows symlink hops (including nested ones) to a final real path.
   * Returns undefined on a symlink loop, matching how a real filesystem
   * would fail the lookup instead of recursing forever.
   */
  private resolveSymlinks(targetPath: string): string | undefined {
    let current = normalize(targetPath);
    const seen = new Set<string>();
    while (this.symlinks.has(current)) {
      if (seen.has(current)) {
        return undefined;
      }
      seen.add(current);
      current = this.symlinks.get(current)!;
    }

    return current;
  }
}
