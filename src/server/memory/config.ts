import "server-only";
/**
 * Where the po-workspace (and its memory vault + CLI) lives. Env-only in v1:
 * MEMORY_WORKSPACE ?? PO_WORKSPACE ?? ../po-workspace, resolved from process.cwd().
 * Settings shows the resolved path read-only.
 */
import fs from "node:fs";
import path from "node:path";
import type { MemoryWorkspaceCheck } from "@/lib/memory/types";

export interface MemoryPaths {
  /** The po-workspace root; the CLI's cwd (its `--vault`/`--workspace` defaults resolve there). */
  workspace: string;
  /** `<workspace>/memory` — the Obsidian-style vault. */
  vaultDir: string;
  /** `<workspace>/tools/memory/memory.mjs`. */
  cliPath: string;
  /** `<vaultDir>/.index/memory.sqlite` — the derived index (gitignored; safe to rebuild). */
  indexFile: string;
}

export function memoryPaths(): MemoryPaths {
  const configured = process.env.MEMORY_WORKSPACE ?? process.env.PO_WORKSPACE ?? "../po-workspace";
  const workspace = path.resolve(process.cwd(), configured);
  const vaultDir = path.join(workspace, "memory");
  return {
    workspace,
    vaultDir,
    cliPath: path.join(workspace, "tools", "memory", "memory.mjs"),
    indexFile: path.join(vaultDir, ".index", "memory.sqlite"),
  };
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** What exists at the resolved paths. `ok` needs the vault and the CLI; the index can be rebuilt. */
export function checkVault(): MemoryWorkspaceCheck {
  const { workspace, vaultDir, cliPath, indexFile } = memoryPaths();
  const vaultExists = isDir(vaultDir);
  const cliExists = isFile(cliPath);
  return { ok: vaultExists && cliExists, workspace, vaultDir, cliPath, vaultExists, cliExists, indexExists: isFile(indexFile) };
}
