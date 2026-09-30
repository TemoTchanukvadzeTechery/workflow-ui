import "server-only";
/**
 * Step helpers that journal what the real weft SDK journals for ctx.fs, ctx.git, ctx.exec and
 * ctx.bash: an fs step labelled "read:<path>", a git step "git.log", an exec step per atl
 * command preceded by a policy gate "exec: atl …", and a bash step preceded by "bash: …".
 * Weft's fs and git steps carry no key; the mock contract needs one, so repeated labels get a
 * numeric suffix to stay unique within the run.
 */
import type { ScriptCtx, WorkspaceFile } from "../../engine/api";
import { runAtl, type AtlResult } from "../../content/catalog";
import { validateAtl } from "./atl";
import { hashInt, sha256 } from "./text";

export interface Commit {
  sha: string;
  author: string;
  date: string;
  subject: string;
  body: string;
}

export interface FileStat {
  exists: boolean;
  size?: number;
  mtimeMs?: number;
  isFile?: boolean;
  isDirectory?: boolean;
}

export class Kit<I = unknown> {
  private readonly used = new Map<string, number>();

  constructor(readonly ctx: ScriptCtx<I>) {}

  /** A key unique within this run: the base the first time, then base@2, base@3, … */
  key(base: string): string {
    const n = (this.used.get(base) ?? 0) + 1;
    this.used.set(base, n);
    return n === 1 ? base : `${base}@${n}`;
  }

  /**
   * The engine's clock (virtual while seeding) when ScriptCtx offers one, else wall time. The
   * contract has no now() yet; dates written into documents should match the run's timestamps.
   */
  now(): number {
    const clock = (this.ctx as { now?: () => number }).now;
    return typeof clock === "function" ? clock.call(this.ctx) : Date.now();
  }

  /** Small deterministic variation so ledgers do not look machine-regular. */
  ms(base: number, spread: number, salt: string): number {
    return base + (hashInt(`${this.ctx.runId}:${salt}`) % Math.max(1, spread));
  }

  async stat(path: string): Promise<FileStat> {
    const label = `stat:${path}`;
    return this.ctx.step<FileStat>({
      kind: "fs",
      key: this.key(label),
      label,
      ms: this.ms(12, 40, label),
      payload: { op: "stat", path },
      output: () => {
        const file = this.ctx.fs.read(path);
        if (file) return { exists: true, size: Buffer.byteLength(file.content, "utf8"), mtimeMs: file.updatedAt, isFile: true, isDirectory: false };
        const isDirectory = this.ctx.fs.list(`${path.replace(/\/$/, "")}/`).length > 0;
        return isDirectory ? { exists: true, isFile: false, isDirectory: true } : { exists: false };
      },
    });
  }

  /** Reads a workspace file; a missing file fails the step and throws, like weft's fs.read. */
  async read(path: string): Promise<WorkspaceFile> {
    const label = `read:${path}`;
    const file = this.ctx.fs.read(path);
    if (!file) {
      const message = `ENOENT: no such file or directory, open '${path}'`;
      try {
        await this.ctx.step({ kind: "fs", key: this.key(label), label, ms: this.ms(10, 20, label), payload: { op: "read", path }, fail: { code: "internal", message } });
      } catch {
        // The failed step is journaled either way; the error below is what the script sees.
      }
      throw new Error(message);
    }
    await this.ctx.step({
      kind: "fs",
      key: this.key(label),
      label,
      ms: this.ms(15, 45, label),
      payload: { op: "read", path },
      output: () => ({ content: file.content, sha256: file.sha256 }),
    });
    return file;
  }

  /** git.log over the mock workspace: one commit when it has files, none for a path never committed. */
  async gitLog(opts: { max?: number; paths?: string[] } = {}): Promise<{ commits: Commit[] }> {
    const files = this.ctx.fs.list();
    return this.ctx.step({
      kind: "git",
      key: this.key("git.log"),
      label: "git.log",
      ms: this.ms(opts.paths ? 40 : 520, 120, `git.log:${opts.paths?.join(",") ?? ""}`),
      payload: { max: opts.max ?? 1, ...(opts.paths ? { paths: opts.paths } : {}) },
      output: () => {
        if (opts.paths || files.length === 0) return { commits: [] };
        const newest = files.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
        const sha = sha256(files.map((f) => `${f.path}:${f.sha256}`).join("\n")).slice(0, 40);
        return { commits: [{ sha, author: "Workspace", date: new Date(newest.updatedAt).toISOString(), subject: "Update workspace", body: "" }] };
      },
    });
  }

  /**
   * Runs an allow-listed atl read command as weft does: a policy gate, then an exec step. Returns
   * undefined when the command is not allowed (the real workflow records it as rejected).
   */
  async atl(key: string, args: readonly string[]): Promise<{ argv: string[]; result: AtlResult } | undefined> {
    const checked = validateAtl(args);
    if (!checked.ok) return undefined;
    const command = `atl ${checked.argv.join(" ")}`;
    await this.ctx.gate(`exec: ${command}`);
    const result = await this.ctx.step<AtlResult>({
      kind: "exec",
      key: this.key(key),
      label: command,
      ms: this.ms(240, 160, key),
      payload: { cmd: "atl", args: checked.argv, timeout: "2m", risk: "low" },
      output: () => runAtl(args),
    });
    return { argv: checked.argv, result };
  }

  /** A bash step preceded by its policy gate; `effect` runs when the step completes. */
  async bash(key: string, command: string, env: Record<string, string>, effect: () => void): Promise<void> {
    await this.ctx.gate(`bash: ${command}`);
    await this.ctx.step({
      kind: "bash",
      key: this.key(key),
      label: command,
      ms: this.ms(60, 60, key),
      payload: { command, env: Object.keys(env), risk: "low" },
      output: () => {
        effect();
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });
  }
}
