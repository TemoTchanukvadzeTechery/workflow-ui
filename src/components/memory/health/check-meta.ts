/**
 * Copy and presentation for the vault health checks (plan §3), shared by the Health tab and the
 * Home card: each check's label, icon, why it matters and how to fix it; the group, status and
 * band labels with their tones; and the "top issues" order. Fix hints mark code with backticks
 * (CheckRow renders it mono). Data only and hook-free, like status-meta.tsx. Status is never
 * color alone: every status and band carries an icon and a label.
 */
import {
  Archive,
  BadgeCheck,
  CalendarClock,
  CircleAlert,
  CircleCheck,
  CircleMinus,
  CircleX,
  Clock3,
  Database,
  FileCheck2,
  FileWarning,
  GitCommitHorizontal,
  Layers,
  Library,
  Link as LinkIcon,
  ListChecks,
  PencilLine,
  Quote,
  ShieldAlert,
  ShieldCheck,
  Sprout,
  Tags,
  TriangleAlert,
  Users,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import type { MemoryHealthBand, MemoryHealthCheck, MemoryHealthCheckId, MemoryHealthGroupId, MemoryHealthStatus } from "@/lib/memory/types";
import type { Tone } from "@/lib/weft/labels";

/** The memory CLI as run from the po-workspace root. */
const CLI = "node tools/memory/memory.mjs";

export interface HealthCheckMeta {
  label: string;
  icon: LucideIcon;
  /** Why the check matters, one or two sentences. */
  why: string;
  /** How to fix it; `code` in backticks. */
  fix: string;
}

export const HEALTH_CHECK_META: Record<MemoryHealthCheckId, HealthCheckMeta> = {
  loads: {
    label: "Notes load",
    icon: FileWarning,
    why: "A fatal lint finding (no frontmatter, an id that does not match its path, a duplicate id or block id) stops the index build, so search, context packs and this page stop seeing changes.",
    fix: `Fix each listed finding in Obsidian, then rebuild the index. \`${CLI} lint\` in the po-workspace lists every finding.`,
  },
  lint: {
    label: "Lint",
    icon: ListChecks,
    why: "Lint keeps notes in the shape agents and Obsidian expect: required keys, valid statuses and dates, one-line claims with a source and a block id.",
    fix: `Fix each listed finding in the note. \`${CLI} lint\` in the po-workspace prints the full list with line numbers.`,
  },
  links: {
    label: "Links resolve",
    icon: LinkIcon,
    why: "An unresolved wikilink is a dead end: the graph loses an edge and context packs miss the neighbour it names.",
    fix: "Point the link at an existing note, e.g. `[[systems/<slug>]]`, or create the missing note from its template in `_templates/`.",
  },
  index: {
    label: "Search index",
    icon: Database,
    why: "The derived index (`memory/.index/memory.sqlite`) powers search, context packs and this page. Without embeddings, search matches keywords only.",
    fix: `Rebuild it here or run \`${CLI} index build\`. Embeddings stay off while \`MEMORY_NO_EMBEDDINGS=1\` is set.`,
  },
  committed: {
    label: "Committed to git",
    icon: GitCommitHorizontal,
    why: "po-brd and architect-aad refuse to run while the vault has uncommitted changes, so every agent reads the memory a reviewer can see in git.",
    fix: "Review the listed notes, then commit them in the po-workspace: `git add memory && git commit`.",
  },
  "stale-docs": {
    label: "Signed-off documents",
    icon: FileCheck2,
    why: "Claims cite the version of a document that was signed off. When the file changes afterwards, those claims may no longer hold.",
    fix: "Sign the new version off by re-running its stage, or restore the file to the accepted version.",
  },
  recency: {
    label: "Recently updated",
    icon: CalendarClock,
    why: "A note nobody has touched for half a year is likely out of date, and agents cite it as if it were current.",
    fix: "Review each listed note and set `updated:` to today once it is confirmed current.",
  },
  connected: {
    label: "Connected",
    icon: Waypoints,
    why: "Context packs reach notes through their links, so a note without any is seldom included.",
    fix: "Add `related`, `depends_on` or `consumers` wikilinks to the frontmatter, or mention the note as `[[...]]` in another note's body.",
  },
  owners: {
    label: "Owners",
    icon: Users,
    why: "An owner tells reviewers and agents which team to ask, and lets context packs pull the owning team in.",
    fix: 'Owners point at team notes, so create those first: copy `_templates/team.md` to `teams/<slug>.md` for each team and fill it in. Then set `owner: "[[teams/<slug>]]"` in each listed note\'s frontmatter.',
  },
  claims: {
    label: "Claims",
    icon: Quote,
    why: "Claims are the citable facts agents quote as `[M note-id]`; a note without claims adds prose only.",
    fix: "Claims arrive when documents are signed off and memory updates are applied. By hand: one bullet per claim under `## Claims`, with a source and a `^c-<6 hex>` id.",
  },
  sources: {
    label: "Sources",
    icon: Library,
    why: "A source shows where a note's knowledge came from, so a reviewer can check it.",
    fix: "Add a `sources:` list to the frontmatter: a repository (`bitbucket.org/<workspace>/<repo>`), a Jira key (`CP-123`), `confluence:<page id>` or `[[documents/<slug>]]`.",
  },
  tags: {
    label: "Tags",
    icon: Tags,
    why: "Tags group notes across folders for Obsidian bases and search filters.",
    fix: "Add a `tags:` list to the frontmatter, e.g. `tags: [payments, checkout]`.",
  },
  "seed-blocked": {
    label: "Seed stubs",
    icon: Sprout,
    why: "The seed wrote these notes as stubs because its secret scan hit the source, so they hold no real content yet.",
    fix: "Fill each note in from its repository (without the secret), then remove the `seed_blocked` key.",
  },
  proposed: {
    label: "Proposed claims",
    icon: PencilLine,
    why: "A proposed claim has not been reviewed, yet context packs still carry a few of them after the accepted ones.",
    fix: "Review each one: accept it by removing `(proposed)`, or move it to `## Retired claims` with a `(retired: <reason>)`.",
  },
  "retired-deps": {
    label: "Retired dependencies",
    icon: Archive,
    why: "A live note that depends on a retired or deprecated one points readers at something that is going away.",
    fix: "Point `depends_on` at the replacement, or retire the dependent note as well.",
  },
};

export interface HealthGroupMeta {
  label: string;
  icon: LucideIcon;
  /** One muted line under the group title. */
  blurb: string;
}

export const HEALTH_GROUP_META: Record<MemoryHealthGroupId, HealthGroupMeta> = {
  integrity: { label: "Integrity", icon: ShieldCheck, blurb: "Notes load, lint cleanly, link up and are indexed." },
  freshness: { label: "Freshness", icon: Clock3, blurb: "Committed, in step with signed-off documents, recently updated." },
  coverage: { label: "Coverage", icon: Layers, blurb: "How many notes have connections, owners, claims, sources and tags." },
  trust: { label: "Trust", icon: BadgeCheck, blurb: "Seed stubs, unreviewed claims and links to retired notes." },
};

export interface HealthToneMeta {
  label: string;
  tone: Tone;
  icon: LucideIcon;
}

export const HEALTH_STATUS_META: Record<MemoryHealthStatus, HealthToneMeta> = {
  pass: { label: "Pass", tone: "success", icon: CircleCheck },
  warn: { label: "Warning", tone: "attention", icon: TriangleAlert },
  fail: { label: "Fail", tone: "danger", icon: CircleX },
  skipped: { label: "Not checked", tone: "neutral", icon: CircleMinus },
};

export const HEALTH_BAND_META: Record<MemoryHealthBand, HealthToneMeta> = {
  excellent: { label: "Excellent", tone: "success", icon: ShieldCheck },
  good: { label: "Good", tone: "success", icon: BadgeCheck },
  fair: { label: "Fair", tone: "attention", icon: CircleAlert },
  poor: { label: "Poor", tone: "danger", icon: ShieldAlert },
};

/** The stripe color of a tone, for SVG fills (Tailwind classes cannot reach a pattern's rect). */
export const TONE_SOLID: Record<Tone, string> = {
  running: "var(--status-running-solid)",
  attention: "var(--status-attention-solid)",
  review: "var(--status-review-solid)",
  success: "var(--status-success-solid)",
  danger: "var(--status-danger-solid)",
  neutral: "var(--status-neutral-solid)",
};

/** Points earned (weight × score); 0 when skipped. */
export function pointsEarned(check: MemoryHealthCheck): number {
  return check.score === null ? 0 : check.weight * check.score;
}

/** Points the check gives up; 0 when skipped. */
export function pointsLost(check: MemoryHealthCheck): number {
  return check.score === null ? 0 : check.weight - pointsEarned(check);
}

/** "5", "9.2": one decimal only when it is not a whole number. */
export function formatPoints(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

const STATUS_RANK: Record<MemoryHealthStatus, number> = { fail: 0, warn: 1, pass: 2, skipped: 3 };

/** Warnings and failures, failures first, then the most points lost (catalogue order breaks ties). */
export function topHealthIssues(checks: readonly MemoryHealthCheck[], limit = 3): MemoryHealthCheck[] {
  return checks
    .map((check, i) => ({ check, i }))
    .filter(({ check }) => check.status === "warn" || check.status === "fail")
    .sort((a, b) => STATUS_RANK[a.check.status] - STATUS_RANK[b.check.status] || pointsLost(b.check) - pointsLost(a.check) || a.i - b.i)
    .slice(0, limit)
    .map(({ check }) => check);
}

/** The anchor id of a check's row on the Health tab (`#check-owners`). */
export const checkAnchor = (id: MemoryHealthCheckId) => `check-${id}`;
