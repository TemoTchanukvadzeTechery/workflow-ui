"use client";

/**
 * Line diff with +/- markers (never color only), line numbers and collapsed context. Takes either
 * two texts (diffed with jsdiff) or a diff text: a unified/git diff (file headers, hunks) or the
 * "+ line" / "- line" format po-brd's memory review attaches.
 */
import { diffLines } from "diff";
import { ChevronDown, ChevronRight, FileCode2 } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

type RowType = "add" | "del" | "ctx" | "hunk" | "meta";
export interface DiffRow {
  type: RowType;
  text: string;
  oldNo?: number;
  newNo?: number;
}
export interface DiffFile {
  path?: string;
  rows: DiffRow[];
  adds: number;
  dels: number;
}

export type TextDiffProps = ({ before: string; after: string; diffText?: undefined } | { diffText: string; before?: undefined; after?: undefined }) & {
  className?: string;
  /** Unchanged lines kept around each change; the rest collapse. Default 3. */
  context?: number;
  /** Tailwind max-height class for the scroll area, e.g. "max-h-[60vh]". */
  maxHeightClass?: string;
  emptyText?: string;
};

function splitText(value: string): string[] {
  const lines = value.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Rows for two texts. */
export function diffTexts(before: string, after: string): DiffFile {
  const rows: DiffRow[] = [];
  let oldNo = 1;
  let newNo = 1;
  let adds = 0;
  let dels = 0;
  for (const change of diffLines(before, after)) {
    for (const line of splitText(change.value)) {
      if (change.added) {
        rows.push({ type: "add", text: line, newNo: newNo++ });
        adds++;
      } else if (change.removed) {
        rows.push({ type: "del", text: line, oldNo: oldNo++ });
        dels++;
      } else {
        rows.push({ type: "ctx", text: line, oldNo: oldNo++, newNo: newNo++ });
      }
    }
  }
  return { rows, adds, dels };
}

/** Changed line count between two texts (adds + dels), for "You edited N lines". */
export function changedLineCount(before: string, after: string): number {
  if (before === after) return 0;
  const { adds, dels } = diffTexts(before, after);
  return Math.max(adds, dels);
}

const UNIFIED = /^(diff --git |--- |\+\+\+ |@@ )/m;

/** Files and rows of a diff text (unified/git, or "+ "/"- " lines). */
export function parseDiffText(text: string): DiffFile[] {
  if (!UNIFIED.test(text)) {
    const rows: DiffRow[] = [];
    let adds = 0;
    let dels = 0;
    for (const line of splitText(text)) {
      if (line.startsWith("+ ") || line === "+") {
        rows.push({ type: "add", text: line.slice(2) });
        adds++;
      } else if (line.startsWith("- ") || line === "-") {
        rows.push({ type: "del", text: line.slice(2) });
        dels++;
      } else rows.push({ type: "ctx", text: line.startsWith("  ") ? line.slice(2) : line });
    }
    return rows.length > 0 ? [{ rows, adds, dels }] : [];
  }

  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let oldNo = 0;
  let newNo = 0;
  const open = (path?: string) => {
    file = { path, rows: [], adds: 0, dels: 0 };
    files.push(file);
    return file;
  };
  const lines = splitText(text);
  lines.forEach((line, i) => {
    if (line.startsWith("diff --git ")) {
      const m = / b\/(.+)$/.exec(line);
      open(m?.[1]);
      return;
    }
    // File headers come in "--- " + "+++ " pairs; a lone "--- x" is a removed "-- x" line.
    if (line.startsWith("--- ") && lines[i + 1]?.startsWith("+++ ")) {
      // A bare "--- a/x" without "diff --git" starts a file too.
      const current: DiffFile | null = file;
      if (!current || current.rows.some((r) => r.type !== "meta")) open(stripPrefix(line.slice(4)));
      return;
    }
    if (line.startsWith("+++ ") && lines[i - 1]?.startsWith("--- ")) {
      const path = stripPrefix(line.slice(4));
      const current: DiffFile = file ?? open(path);
      if (path && path !== "/dev/null") current.path = path;
      return;
    }
    const f: DiffFile = file ?? open();
    if (line.startsWith("@@")) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      oldNo = m ? Number(m[1]) : oldNo;
      newNo = m ? Number(m[2]) : newNo;
      f.rows.push({ type: "hunk", text: line });
    } else if (line.startsWith("+")) {
      f.rows.push({ type: "add", text: line.slice(1), newNo: newNo++ });
      f.adds++;
    } else if (line.startsWith("-")) {
      f.rows.push({ type: "del", text: line.slice(1), oldNo: oldNo++ });
      f.dels++;
    } else if (line.startsWith(" ")) {
      f.rows.push({ type: "ctx", text: line.slice(1), oldNo: oldNo++, newNo: newNo++ });
    } else if (/^(index |new file mode|deleted file mode|similarity|rename |old mode|new mode|Binary files)/.test(line) || line.startsWith("\\")) {
      f.rows.push({ type: "meta", text: line });
    } else if (line !== "") {
      f.rows.push({ type: "ctx", text: line });
    }
  });
  return files;
}

function stripPrefix(path: string): string {
  const p = path.replace(/\t.*$/, "").trim();
  return p.startsWith("a/") || p.startsWith("b/") ? p.slice(2) : p;
}

type Segment = { kind: "rows"; rows: DiffRow[] } | { kind: "gap"; id: number; rows: DiffRow[] };

function segment(rows: DiffRow[], context: number): Segment[] {
  const changed = rows.map((r) => r.type === "add" || r.type === "del" || r.type === "hunk");
  if (!changed.some(Boolean)) return rows.length > 0 ? [{ kind: "rows", rows }] : [];
  const keep = rows.map((_, i) => {
    for (let d = -context; d <= context; d++) if (changed[i + d]) return true;
    return rows[i]?.type === "meta";
  });
  const out: Segment[] = [];
  let gapId = 0;
  let buf: DiffRow[] = [];
  let bufKeep = keep[0] ?? true;
  const flush = () => {
    if (buf.length === 0) return;
    // A gap of one or two lines is not worth a button.
    if (!bufKeep && buf.length > 2) out.push({ kind: "gap", id: gapId++, rows: buf });
    else out.push({ kind: "rows", rows: buf });
    buf = [];
  };
  rows.forEach((row, i) => {
    const k = keep[i] ?? true;
    if (k !== bufKeep) {
      flush();
      bufKeep = k;
    }
    buf.push(row);
  });
  flush();
  return out;
}

// Dark mode tints the rows at 60% (full-strength tints read as solid blocks there); the +/- gutter keeps the tone.
const ROW_CLASS: Record<RowType, string> = {
  add: "bg-status-success-bg dark:bg-status-success-bg/60",
  del: "bg-status-danger-bg dark:bg-status-danger-bg/60",
  ctx: "",
  hunk: "bg-status-running-bg text-status-running-fg",
  meta: "text-muted-foreground",
};
const MARK: Record<RowType, string> = { add: "+", del: "-", ctx: " ", hunk: "", meta: "" };
const MARK_CLASS: Partial<Record<RowType, string>> = { add: "text-status-success-fg", del: "text-status-danger-fg" };

function Rows({ rows, showNumbers }: { rows: DiffRow[]; showNumbers: boolean }) {
  return (
    <>
      {rows.map((row, i) => (
        <div key={i} className={cn("grid min-w-full", showNumbers ? "grid-cols-[3rem_3rem_1.25rem_1fr]" : "grid-cols-[1.25rem_1fr]", ROW_CLASS[row.type])}>
          {showNumbers ? (
            <>
              <span className="pr-2 text-right text-muted-foreground/70 select-none">{row.oldNo ?? ""}</span>
              <span className="pr-2 text-right text-muted-foreground/70 select-none">{row.newNo ?? ""}</span>
            </>
          ) : null}
          <span aria-hidden className={cn("text-center select-none", MARK_CLASS[row.type])}>
            {MARK[row.type]}
          </span>
          <span className="pr-3 break-words whitespace-pre-wrap">
            {row.type === "add" ? <span className="sr-only">Added: </span> : row.type === "del" ? <span className="sr-only">Removed: </span> : null}
            {row.text === "" ? " " : row.text}
          </span>
        </div>
      ))}
    </>
  );
}

function FileBlock({ file, context, defaultOpen }: { file: DiffFile; context: number; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const segments = useMemo(() => segment(file.rows, context), [file.rows, context]);
  const showNumbers = file.rows.some((r) => r.oldNo !== undefined || r.newNo !== undefined);
  return (
    <div className="border-b border-rule last:border-b-0">
      {file.path ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="sticky top-0 z-[1] flex w-full items-center gap-2 border-b border-rule bg-well/85 px-3.5 py-2 text-left font-mono text-xs text-heading backdrop-blur focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {open ? <ChevronDown aria-hidden className="size-3.5" /> : <ChevronRight aria-hidden className="size-3.5" />}
          <FileCode2 aria-hidden className="size-3.5 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{file.path}</span>
          <span className="text-status-success-fg">+{file.adds}</span>
          <span className="text-status-danger-fg">-{file.dels}</span>
        </button>
      ) : null}
      {open ? (
        <div className="py-1">
          {segments.map((seg, i) =>
            seg.kind === "rows" || expanded.has(seg.id) ? (
              <Rows key={i} rows={seg.rows} showNumbers={showNumbers} />
            ) : (
              <button
                key={i}
                type="button"
                onClick={() => setExpanded((s) => new Set(s).add(seg.id))}
                className="w-full bg-well/50 px-3.5 py-1 text-left text-xs text-muted-foreground hover:bg-well focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                Show {seg.rows.length} unchanged lines
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

export function TextDiff(props: TextDiffProps) {
  const { className, context = 3, maxHeightClass, emptyText = "No changes." } = props;
  const files = useMemo<DiffFile[]>(() => {
    if (props.diffText !== undefined) return props.diffText.trim() === "(no change)" ? [] : parseDiffText(props.diffText);
    const file = diffTexts(props.before, props.after);
    return file.adds + file.dels > 0 ? [file] : [];
  }, [props.diffText, props.before, props.after]);

  if (files.length === 0 || files.every((f) => f.rows.length === 0)) {
    return <div className={cn("rounded-[16px] bg-well/60 px-4 py-8 text-center text-sm text-muted-foreground", className)}>{emptyText}</div>;
  }
  const totals = files.reduce((acc, f) => ({ adds: acc.adds + f.adds, dels: acc.dels + f.dels }), { adds: 0, dels: 0 });
  return (
    <div className={cn("overflow-hidden rounded-[16px] bg-field shadow-[0_0_0_1px_var(--rule)]", className)}>
      <div className="flex items-center gap-3 border-b border-rule px-3.5 py-2 text-[13px] text-muted-foreground">
        {files.length > 1 ? <span>{files.length} files</span> : null}
        <span className="font-mono text-status-success-fg">+{totals.adds}</span>
        <span className="font-mono text-status-danger-fg">-{totals.dels}</span>
      </div>
      <div className={cn("relative overflow-auto font-mono text-xs leading-5", maxHeightClass)}>
        {files.map((file, i) => (
          <FileBlock key={`${file.path ?? ""}:${i}`} file={file} context={context} defaultOpen={files.length <= 12} />
        ))}
      </div>
    </div>
  );
}

/** Two versions of a document, labeled. */
export function VersionDiff({ before, after, beforeLabel, afterLabel, className }: { before: string; after: string; beforeLabel: string; afterLabel: string; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="rounded-[6px] bg-status-danger-bg px-1.5 py-0.5 font-mono text-status-danger-fg">- {beforeLabel}</span>
        <span className="rounded-[6px] bg-status-success-bg px-1.5 py-0.5 font-mono text-status-success-fg">+ {afterLabel}</span>
      </div>
      <TextDiff before={before} after={after} />
    </div>
  );
}
