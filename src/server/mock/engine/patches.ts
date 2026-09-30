import "server-only";
/**
 * Per-file +/- counts from a unified diff: port of weft's parseDiffStats (daemon
 * api/artifacts.ts). `---`/`+++` are headers only before a file's first hunk, the a/ b/
 * prefix is stripped whatever it is, and C-quoted paths are unescaped.
 */
import type { FileStat } from "@/lib/weft/types";

export function parseDiffStats(diff: string): FileStat[] {
  const out: FileStat[] = [];
  let current: FileStat | undefined;
  let inHunk = false;

  for (const rawLine of diff.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.startsWith("diff --git ")) {
      current = { path: pathOfHeader(line), adds: 0, dels: 0, status: "modified" };
      out.push(current);
      inHunk = false;
      continue;
    }
    if (current === undefined) continue;
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (inHunk) {
      if (line.startsWith("+")) current.adds++;
      else if (line.startsWith("-")) current.dels++;
      continue;
    }
    if (line.startsWith("--- ")) {
      if (line.slice(4).trim() === "/dev/null") current.status = "added";
      continue;
    }
    if (line.startsWith("+++ ")) {
      const target = line.slice(4).trim();
      if (target === "/dev/null") current.status = "deleted";
      else current.path = stripPrefix(unquotePath(target)) || current.path;
      continue;
    }
    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) current.status = "binary";
  }
  return out;
}

function pathOfHeader(line: string): string {
  const rest = line.slice("diff --git ".length).trim();
  if (rest.startsWith('"')) {
    const closing = findClosingQuote(rest);
    if (closing > 0) return stripPrefix(unquotePath(rest.slice(0, closing + 1)));
  }
  const half = Math.floor(rest.length / 2);
  return stripPrefix(rest.slice(0, half).trim()) || rest;
}

function stripPrefix(path: string): string {
  const slash = path.indexOf("/");
  if (slash === 1 || slash === 2) return path.slice(slash + 1);
  return path;
}

const SIMPLE_ESCAPES: Record<string, number> = { '"': 0x22, "\\": 0x5c, a: 0x07, b: 0x08, f: 0x0c, n: 0x0a, r: 0x0d, t: 0x09, v: 0x0b };

function unquotePath(path: string): string {
  if (!path.startsWith('"')) return path;
  const closing = findClosingQuote(path);
  const body = path.slice(1, closing > 0 ? closing : undefined);
  const bytes: number[] = [];
  const push = (text: string) => {
    for (const byte of new TextEncoder().encode(text)) bytes.push(byte);
  };
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch !== "\\") {
      push(ch ?? "");
      continue;
    }
    const next = body[i + 1];
    if (next === undefined) break;
    const simple = SIMPLE_ESCAPES[next];
    if (simple !== undefined) {
      bytes.push(simple);
      i += 1;
      continue;
    }
    const octal = body.slice(i + 1, i + 4);
    if (/^[0-7]{3}$/.test(octal)) {
      bytes.push(Number.parseInt(octal, 8));
      i += 3;
      continue;
    }
    push(next);
    i += 1;
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function findClosingQuote(text: string): number {
  for (let i = 1; i < text.length; i++) {
    if (text[i] === "\\") {
      i += 1;
      continue;
    }
    if (text[i] === '"') return i;
  }
  return -1;
}
