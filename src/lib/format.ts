/**
 * Display formatting shared by every screen. Pinned to en-US so server and client render the
 * same strings. Formats follow SPEC 7: money "$6.92", tokens "46,099 tok", durations "2m 14s" or
 * "05:24", relative times "3m ago".
 */
import { format, formatDistanceStrict } from "date-fns";

type Num = number | null | undefined;

const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** "$6.92"; "<$0.01" for a non-zero spend that rounds to zero; "$0.00" for none. */
export function formatUsd(usd: Num, opts: { compact?: boolean } = {}): string {
  const v = usd ?? 0;
  if (!Number.isFinite(v)) return "$0.00";
  if (v > 0 && v < 0.005) return "<$0.01";
  if (opts.compact && Math.abs(v) >= 10_000) return `$${compact.format(v)}`;
  return usd2.format(v);
}

/** "46,099 tok", or weft's compact "11.6M tok" / "941.9k tok". */
export function formatTokens(n: Num, opts: { compact?: boolean; unit?: boolean } = {}): string {
  const v = Math.round(n ?? 0);
  const num = opts.compact && Math.abs(v) >= 1_000 ? compact.format(v).replace("K", "k") : int.format(v);
  return opts.unit === false ? num : `${num} tok`;
}

/** "1,284" */
export function formatNumber(n: Num): string {
  return int.format(n ?? 0);
}

/** "75%" from a 0..1 ratio. */
export function formatPercent(ratio: Num, digits = 0): string {
  const v = (ratio ?? 0) * 100;
  return `${v.toFixed(digits)}%`;
}

/** "12.4 KB" */
export function formatBytes(n: Num): string {
  const v = n ?? 0;
  if (v < 1024) return `${v} B`;
  const units = ["KB", "MB", "GB"];
  let x = v / 1024;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x >= 100 ? x.toFixed(0) : x.toFixed(1)} ${units[i]}`;
}

export type DurationStyle = "human" | "clock";

/**
 * Elapsed time. "human": "2m 14s", "45s", "1h 05m", "3d 4h". "clock": weft's "05:24" / "1:05:24".
 */
export function formatDuration(ms: Num, style: DurationStyle = "human"): string {
  if (style === "clock") return formatClock(ms);
  const v = Math.max(0, ms ?? 0);
  if (v < 1_000) return v === 0 ? "0s" : "<1s";
  const s = Math.floor(v / 1_000);
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const min = Math.floor((s % 3_600) / 60);
  const sec = s % 60;
  if (d > 0) return h ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return `${h}h ${String(min).padStart(2, "0")}m`;
  if (min > 0) return `${min}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

/** Stopwatch form used in run headers and ledgers: "05:24", "1:05:24". */
export function formatClock(ms: Num): string {
  const s = Math.floor(Math.max(0, ms ?? 0) / 1_000);
  const h = Math.floor(s / 3_600);
  const mm = String(Math.floor((s % 3_600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// date-fns strict distance with one-letter units: "3m", "2h", "5d", "4mo", "1y".
const SHORT_UNITS: Record<string, string> = {
  xSeconds: "s",
  xMinutes: "m",
  xHours: "h",
  xDays: "d",
  xWeeks: "w",
  xMonths: "mo",
  xYears: "y",
};
const shortLocale = {
  formatDistance: (token: string, count: number) => `${count}${SHORT_UNITS[token] ?? ""}`,
};

/** "3m ago", "in 2h", "just now". `now` is injectable so a shared ticker can drive it. */
export function formatRelative(at: number | Date, now: number = Date.now()): string {
  const t = typeof at === "number" ? at : at.getTime();
  if (!Number.isFinite(t)) return "-";
  const diff = now - t;
  if (Math.abs(diff) < 10_000) return "just now";
  const dist = formatDistanceStrict(t, now, { locale: shortLocale, roundingMethod: "floor" });
  return diff >= 0 ? `${dist} ago` : `in ${dist}`;
}

// date-fns throws on invalid dates; a bad timestamp in seed data should render "-", not crash.
const valid = (at: number | Date) => Number.isFinite(typeof at === "number" ? at : at.getTime());

/** "Sep 2, 2026" */
export function formatDate(at: number | Date): string {
  return valid(at) ? format(at, "MMM d, yyyy") : "-";
}

/** "14:32" */
export function formatTime(at: number | Date): string {
  return valid(at) ? format(at, "HH:mm") : "-";
}

/** "Sep 2, 2026, 14:32:05": the absolute time behind every relative one (title attributes). */
export function formatDateTime(at: number | Date, opts: { seconds?: boolean } = {}): string {
  if (!valid(at)) return "-";
  return format(at, opts.seconds === false ? "MMM d, yyyy, HH:mm" : "MMM d, yyyy, HH:mm:ss");
}

/** Initials for avatars: "Demo user" -> "DU", "priya" -> "PR". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** Singular/plural: plural(3, "task") -> "3 tasks". */
export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${formatNumber(n)} ${n === 1 ? word : pluralWord}`;
}
