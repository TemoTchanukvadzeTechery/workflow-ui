import "server-only";
/**
 * The mock workspace (stands in for the po-workspace git checkout). Paths are repo-relative;
 * a leading "./" or "/" is dropped so "brd/x.md", "./brd/x.md" and "/brd/x.md" are one file.
 */
import type { WorkspaceFile, WorkspaceFs } from "./api";
import { sha256Hex } from "./blobs";

export function normalizePath(path: string): string {
  return path.replace(/^(\.\/)+/, "").replace(/^\/+/, "");
}

export class MapWorkspaceFs implements WorkspaceFs {
  private readonly files = new Map<string, WorkspaceFile>();

  constructor(
    private readonly now: () => number,
    initial: Record<string, string> = {},
  ) {
    this.reset(initial);
  }

  read(path: string): WorkspaceFile | undefined {
    const file = this.files.get(normalizePath(path));
    return file ? { ...file } : undefined;
  }

  write(path: string, content: string): WorkspaceFile {
    const file: WorkspaceFile = { path: normalizePath(path), content, sha256: sha256Hex(content), updatedAt: this.now() };
    this.files.set(file.path, file);
    return { ...file };
  }

  list(prefix = ""): WorkspaceFile[] {
    const p = normalizePath(prefix);
    return [...this.files.values()]
      .filter((f) => f.path.startsWith(p))
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((f) => ({ ...f }));
  }

  reset(initial: Record<string, string>): void {
    this.files.clear();
    for (const [path, content] of Object.entries(initial)) this.write(path, content);
  }
}
