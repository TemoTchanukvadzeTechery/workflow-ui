import { ApiError, memory } from "@/lib/api/client";
import { qk } from "@/lib/api/keys";
import { checkAnchor, formatPoints, HEALTH_BAND_META, HEALTH_CHECK_META, HEALTH_GROUP_META, HEALTH_STATUS_META, pointsLost, topHealthIssues } from "@/components/memory/health/check-meta";
import { formatDate, formatRelative, plural } from "@/lib/format";
import { MEMORY_TIMELINE_KINDS, MEMORY_WORKING_SHA, type MemoryChangeStatus, type MemoryCommitFile, type MemoryHealthPayload, type MemoryNoteType, type MemorySearchHit, type MemoryTimelineEvent } from "@/lib/memory/types";
import type { Tone } from "@/lib/weft/labels";
import { defineTool } from "../define";
import type { ResultBlock, ResultItem, ToolResult } from "../types";

const enc = encodeURIComponent;
const noteHref = (id: string) => `/memory/${id.split("/").map(enc).join("/")}`;
const commitHref = (shortSha: string, file?: string) => `/memory?view=timeline&commit=${enc(shortSha)}${file ? `&file=${enc(file)}` : ""}`;
const clip = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const pill = (m: { label: string; tone: Tone }) => ({ label: m.label, tone: m.tone });
const when = (iso: string) => formatRelative(Date.parse(iso));

/** components/memory/status-meta.tsx labels, without its icons. */
const TYPE_LABEL: Record<MemoryNoteType, string> = {
  org: "Org",
  project: "Project",
  system: "System",
  team: "Team",
  stakeholder: "Stakeholder",
  decision: "Decision",
  convention: "Convention",
  kpi: "KPI",
  glossary: "Glossary",
  document: "Document",
};
const typeLabel = (t: string | null | undefined) => (t && t in TYPE_LABEL ? TYPE_LABEL[t as MemoryNoteType] : (t ?? "Note"));

const CHANGE_STATUS: Record<MemoryChangeStatus, { label: string; tone: Tone }> = {
  A: { label: "Added", tone: "success" },
  M: { label: "Edited", tone: "running" },
  D: { label: "Removed", tone: "danger" },
  R: { label: "Renamed", tone: "neutral" },
  C: { label: "Copied", tone: "neutral" },
  T: { label: "Type changed", tone: "neutral" },
};

const EVENT_KIND: Record<MemoryTimelineEvent["kind"], { label: string; tone: Tone }> = {
  signoff: { label: "Sign-off", tone: "success" },
  commit: { label: "Commit", tone: "neutral" },
  uncommitted: { label: "Uncommitted", tone: "attention" },
};

/** Where a search hit opens (the command palette's memoryHitHref): the note, or its claim. */
function hitHref(hit: MemorySearchHit): string | null {
  if (hit.kind === "card") return noteHref(hit.id);
  if (!hit.note) return null;
  return hit.kind === "claim" ? `${noteHref(hit.note)}#${hit.id}` : noteHref(hit.note);
}

/** "3 notes added, 2 edited, 4 claims added": an event's change chips in words. */
function changeLine(e: MemoryTimelineEvent): string {
  const t = e.totals;
  const parts = [
    t.notesAdded && `${plural(t.notesAdded, "note")} added`,
    t.notesChanged && `${t.notesChanged} edited`,
    t.notesRemoved && `${t.notesRemoved} removed`,
    t.notesRenamed && `${t.notesRenamed} renamed`,
    t.claims.added && `${plural(t.claims.added, "claim")} added`,
    t.claims.retired && `${t.claims.retired} retired`,
    !t.notesAdded && !t.notesChanged && !t.notesRemoved && !t.notesRenamed && t.otherFiles && plural(t.otherFiles, "other file"),
  ].filter(Boolean);
  return parts.join(", ") || `+${t.linesAdded} −${t.linesRemoved}`;
}

const eventRow = (e: MemoryTimelineEvent): ResultItem => ({
  title: e.subject,
  subtitle: [e.author?.name ?? "Not committed yet", changeLine(e)].join(" · "),
  meta: when(e.committedAt),
  href: commitHref(e.kind === "uncommitted" ? MEMORY_WORKING_SHA : e.shortSha),
  status: EVENT_KIND[e.kind],
});

/** The Health tab's summary as blocks, for both the cached read and "Run checks again". */
function healthResult(h: MemoryHealthPayload, lead: string): ToolResult {
  const band = h.band ? HEALTH_BAND_META[h.band].label : null;
  const issues = topHealthIssues(h.checks, 5);
  const facts = [
    { label: "Score", value: h.score === null ? "Not scored" : `${h.score}/100${band ? ` · ${band}` : ""}`, href: "/memory?view=health" },
    { label: "Checks", value: [`${h.counts.pass} pass`, h.counts.warn && `${h.counts.warn} warning${h.counts.warn === 1 ? "" : "s"}`, h.counts.fail && `${h.counts.fail} failing`, h.counts.skipped && `${h.counts.skipped} not checked`].filter(Boolean).join(" · ") },
    ...h.groups.map((g) => ({ label: HEALTH_GROUP_META[g.id].label, value: `${formatPoints(g.earned)} of ${formatPoints(g.possible)} points` })),
    { label: "Vault", value: `${plural(h.vault.notes, "note")}, ${plural(h.vault.claims, "claim")}, ${plural(h.vault.edges, "link")}${h.vault.uncommitted ? `, ${h.vault.uncommitted} uncommitted` : ""}` },
    ...(h.vault.lastCommit ? [{ label: "Last commit", value: `${h.vault.lastCommit.subject} · ${when(h.vault.lastCommit.at)}`, href: commitHref(h.vault.lastCommit.shortSha) }] : []),
  ];
  const blocks: ResultBlock[] = [{ type: "facts", facts }];
  if (h.state === "building") blocks.push({ type: "text", tone: "attention", text: "An index build is running; some checks are skipped until it finishes." });
  for (const e of h.errors) blocks.push({ type: "text", tone: "danger", text: `${e.source}: ${e.message}` });
  if (issues.length)
    blocks.push({
      type: "items",
      title: "Top issues",
      items: issues.map((c) => ({
        title: HEALTH_CHECK_META[c.id].label,
        subtitle: c.measure.summary,
        meta: `−${formatPoints(pointsLost(c))} pts`,
        href: `/memory?view=health#${checkAnchor(c.id)}`,
        status: pill(HEALTH_STATUS_META[c.status]),
      })),
    });
  const score = h.score === null ? "Memory health couldn't be scored" : `Memory health is ${h.score}/100${band ? ` (${band.toLowerCase()})` : ""}`;
  const tail = issues.length ? ` The biggest issue: ${HEALTH_CHECK_META[issues[0].id].label.toLowerCase()}, ${issues[0].measure.summary.charAt(0).toLowerCase()}${issues[0].measure.summary.slice(1)}.` : " Every check passes.";
  return { text: `${lead}${score}.${tail}`, blocks };
}

/** The memory vault: search, notes, health, history, the graph, and rebuilding its index. */
export const memoryTools = [
  defineTool({
    name: "search_memory",
    group: "memory",
    title: "Search memory",
    description: "Search the memory vault (notes, their claims and sections) with its hybrid search, and list the hits with links to the notes.",
    effect: "read",
    params: { query: { kind: "text", description: "What to search for" } },
    utterances: [
      "search [the] (memory|vault|memory vault|knowledge base) (for|about|on) {query}",
      "search [the] (memory|vault|memory vault|knowledge base)",
      "(search|look up|lookup|look for|find|search for) {query} in [the] (memory|vault|memory vault|knowledge base)",
      "(what does|what do|does) [the] (memory|vault) (say|know|have) (about|on) {query}",
      "(what do we|what do i|do we) know about {query} [in memory]",
      "memory search [for] {query}",
      "(any|are there any) [memory] notes (about|on|for|mentioning) {query}",
    ],
    examples: ["Search memory for checkout", "What does memory say about customer service?"],
    covers: ["memory.search"],
    summary: ({ query }) => `Search memory for “${query}”`,
    run: async ({ query }) => {
      const res = await memory.search(query, { limit: 10 });
      const seen = new Set<string>();
      const hits = res.hits.filter((h) => {
        const key = `${h.kind}:${h.id}`;
        if (!hitHref(h) || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const blocks: ResultBlock[] = res.warnings.map((w) => ({ type: "text" as const, tone: "attention" as const, text: w }));
      if (!hits.length) return { text: `Nothing in memory matches “${query}”.`, blocks };
      const items: ResultItem[] = hits.map((h) =>
        h.kind === "claim"
          ? { title: clip(h.snippet || h.id), subtitle: `Claim in ${h.title ?? h.note}`, href: hitHref(h) ?? undefined, status: { label: "Claim", tone: "neutral" } }
          : {
              title: h.title || (h.kind === "card" ? h.id : (h.note ?? h.id)),
              subtitle: [h.kind === "section" && h.heading ? `§ ${h.heading}` : null, h.snippet ? clip(h.snippet) : null].filter(Boolean).join(" · ") || undefined,
              meta: typeLabel(h.type),
              href: hitHref(h) ?? undefined,
            },
      );
      blocks.push({ type: "items", items, more: { label: "Search in Memory", href: `/memory?q=${enc(query)}` } });
      return { text: `${plural(hits.length, "hit")} for “${query}”, best first.`, blocks };
    },
  }),
  defineTool({
    name: "memory_overview",
    group: "memory",
    title: "Summarize the memory vault",
    description: "Summarize the memory vault: how many notes, claims and links it holds, notes by type, recently updated notes, stale documents, and the state of its search index.",
    effect: "read",
    params: {},
    utterances: [
      "(what's|what is|whats) in [the] (memory|vault|memory vault|knowledge base)",
      "(memory|vault) (overview|stats|statistics|summary|status)",
      "(show|give|get) [me] [a|the] (memory|vault) (overview|summary|stats|statistics|status)",
      "(summarize|summarise|describe) [the] (memory|vault|memory vault|knowledge base)",
      "how many (notes|memory notes|claims) (are there|do we have|are in memory) [in memory|in the vault]",
      "how big is [the] (memory|vault)",
    ],
    examples: ["What's in memory?", "Summarize the memory vault"],
    covers: ["memory.overview", "memory.status"],
    summary: () => "Summarize the memory vault",
    run: async () => {
      const [overview, status] = await Promise.all([memory.overview(), memory.status()]);
      const s = overview.stats;
      const facts = [
        { label: "Notes", value: String(s.notes) },
        { label: "Claims", value: `${s.claims}${s.proposedClaims ? ` (${s.proposedClaims} proposed)` : ""}` },
        { label: "Links", value: String(s.edges), href: "/memory?view=graph" },
        { label: "Stale documents", value: String(s.staleDocs) },
        { label: "Search index", value: status.indexState === "ready" ? "Ready" : status.indexState === "building" ? "Building" : "Missing" },
        { label: "Workspace", value: status.check.workspace },
      ];
      const byType = (Object.entries(s.byType) as Array<[MemoryNoteType, number]>).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
      const recent = [...overview.notes].sort((a, b) => b.card.updated.localeCompare(a.card.updated)).slice(0, 5);
      const blocks: ResultBlock[] = [{ type: "facts", facts }];
      if (!status.check.ok) blocks.push({ type: "text", tone: "danger", text: `The vault or its CLI is missing under ${status.check.workspace}.` });
      if (byType.length) blocks.push({ type: "items", title: "By type", items: byType.map(([t, n]) => ({ title: TYPE_LABEL[t], meta: plural(n, "note") })) });
      if (recent.length) blocks.push({ type: "items", title: "Recently updated", items: recent.map((n) => ({ title: n.card.title, subtitle: clip(n.card.summary), meta: n.card.updated, href: noteHref(n.card.id) })), more: { label: "All notes", href: "/memory" } });
      if (overview.stale.length) blocks.push({ type: "text", tone: "attention", text: `${plural(overview.stale.length, "signed-off document")} changed since sign-off; claims citing ${overview.stale.length === 1 ? "it" : "them"} may be stale.` });
      return {
        text: `The vault holds ${plural(s.notes, "note")} of ${plural(byType.length, "type")}, ${plural(s.claims, "claim")} and ${plural(s.edges, "link")}; the search index is ${status.indexState}.`,
        blocks,
      };
    },
  }),
  defineTool({
    name: "show_memory_note",
    group: "memory",
    title: "Summarize a memory note",
    description: "Show one memory note in the chat: its type, status, summary and the start of its text, claims, owner and connections.",
    effect: "read",
    params: { noteId: { kind: "note", description: "Memory note id (`<type>/<slug>`) or what it is about; defaults to the page's note" } },
    utterances: [
      "(summarize|summarise|describe|explain|read) [the] [memory] note [about|on|for|called] {noteId}",
      "(summarize|summarise|describe|explain|read) (this|the current) [memory] note",
      "what does [the] [memory] note [about|on|for] {noteId} say",
      "(what's|what is|whats) in [the] [memory] note [about|on|for] {noteId}",
      "(summarize|summarise|describe) {noteId} from memory",
      "(details|info) (of|for|on|about) [the] [memory] note {noteId}",
    ],
    examples: ["Summarize the memory note about customer service"],
    covers: ["memory.note"],
    summary: ({ noteId }) => `Summarize memory note ${noteId}`,
    run: async ({ noteId }) => {
      const n = await memory.note(noteId);
      const c = n.card;
      const proposed = n.claims.filter((x) => x.proposed).length;
      const facts = [
        { label: "Type", value: typeLabel(c.type) },
        ...(c.status ? [{ label: "Status", value: c.status }] : []),
        { label: "Updated", value: c.updated },
        ...(c.props.owner ? [{ label: "Owner", value: c.props.owner }] : []),
        ...(c.props.category ? [{ label: "Category", value: c.props.category }] : []),
        { label: "Claims", value: `${n.claims.length}${proposed ? ` (${proposed} proposed)` : ""}${n.retired.length ? `, ${n.retired.length} retired` : ""}` },
        { label: "Connections", value: `${n.neighbors.out.length} out · ${n.neighbors.in.length} in` },
        { label: "File", value: c.path },
      ];
      const prose = n.prose.trim();
      const body = prose.length > 1500 ? `${prose.slice(0, Math.max(prose.lastIndexOf("\n", 1500), 750))}\n\n…` : prose;
      const blocks: ResultBlock[] = [{ type: "markdown", title: c.title, text: [c.summary, body].filter(Boolean).join("\n\n"), href: noteHref(c.id) }, { type: "facts", facts }];
      const flags = [
        n.flags.seedBlocked && "This note is a seed stub: the secret scan blocked its content.",
        n.flags.isStaleDoc && "The signed-off document behind this note changed since it was accepted.",
        n.flags.hasProposed && "Some claims are still proposed, not reviewed.",
      ].filter((x): x is string => !!x);
      if (flags.length) blocks.push({ type: "text", tone: "attention", text: flags.join(" ") });
      const neighbors = [...n.neighbors.out.map((x) => ({ ...x, dir: "links to" })), ...n.neighbors.in.map((x) => ({ ...x, dir: "linked from" }))];
      if (neighbors.length)
        blocks.push({
          type: "items",
          title: "Connections",
          items: neighbors.slice(0, 8).map((x) => ({ title: x.title ?? x.id, subtitle: `${x.dir}${x.property ? ` · ${x.property}` : ""}`, meta: typeLabel(x.type), href: noteHref(x.id) })),
        });
      return { text: `${c.title}: ${typeLabel(c.type).toLowerCase()} note${c.status ? `, ${c.status}` : ""}, updated ${c.updated}, ${plural(n.claims.length, "claim")}.`, blocks };
    },
  }),
  defineTool({
    name: "memory_health",
    group: "memory",
    title: "Check memory health",
    description: "Show the memory vault's health score and band, its check counts and the checks that lose the most points, from the last run of the checks.",
    effect: "read",
    params: {},
    utterances: [
      "(how healthy is|how's|how is|hows) [the] (memory|vault) [health|doing|looking]",
      "[show|check|get] [me] [the] (memory|vault) health [score|check|checks|report]",
      "(what's|what is|whats) [the] (memory|vault) health [score]",
      "(what's|what is|whats) wrong with [the] (memory|vault)",
      "(is|are) [the] (memory|vault) [notes] healthy",
    ],
    examples: ["How healthy is memory?", "Show the memory health"],
    covers: ["memory.health"],
    summary: () => "Check memory health",
    run: async (_input, ctx) => {
      const h = await ctx.qc.fetchQuery({ queryKey: qk.memoryHealth, queryFn: () => memory.health(), staleTime: 15_000 });
      return healthResult(h, "");
    },
  }),
  defineTool({
    name: "recheck_memory_health",
    group: "memory",
    title: "Run the memory checks again",
    description: "Re-run the memory vault's health checks (lint and git) instead of reusing the cached results, like the Health tab's “Run checks again”.",
    effect: "read",
    params: {},
    utterances: [
      "(run|rerun|re-run|redo|repeat) [the] [memory|vault] [health] checks [again]",
      "(recheck|re-check|refresh) [the] (memory|vault) [health]",
      "check [the] (memory|vault) [health] again",
    ],
    examples: ["Run the memory checks again"],
    covers: ["memory.health"],
    summary: () => "Run the memory checks again",
    run: async (_input, ctx) => {
      const h = await memory.health({ refresh: true });
      ctx.qc.setQueryData(qk.memoryHealth, h);
      return healthResult(h, "Memory checks finished. ");
    },
  }),
  defineTool({
    name: "memory_timeline",
    group: "memory",
    title: "Show recent memory changes",
    description: "Show the memory vault's recent git history, newest first: commits, project sign-offs that wrote to memory, and uncommitted changes.",
    effect: "read",
    params: {
      kind: {
        kind: "enum",
        description: "all, signoff (project sign-offs only) or edit (every other commit)",
        required: false,
        values: MEMORY_TIMELINE_KINDS,
        synonyms: { all: ["everything", "all changes"], signoff: ["sign-off", "sign-offs", "signoffs", "sign offs", "sign off"], edit: ["edits", "manual edits", "other commits"] },
      },
    },
    utterances: [
      "(show|list|get) [me] [the] [recent|latest|last] (memory|vault) (timeline|history|commits|changes|activity|updates)",
      "(show|list|get) [me] [the] [recent|latest|last] (memory|vault) {kind}",
      "(recent|latest|last) (memory|vault) (changes|commits|updates|activity)",
      "what changed in [the] (memory|vault) [recently|lately|today|this week]",
      "(who|what) (changed|updated|edited) [the] (memory|vault) [recently|lately|last]",
      "(show|list) [me] [the] [recent|latest] {kind} in [the] (memory|vault)",
    ],
    examples: ["Show recent memory changes", "What changed in memory lately?"],
    covers: ["memory.timeline"],
    summary: ({ kind }) => (kind === "signoff" ? "Show recent memory sign-offs" : kind === "edit" ? "Show recent memory edits" : "Show recent memory changes"),
    run: async ({ kind }) => {
      const t = await memory.timeline({ limit: 10, kind });
      if (!t.git.ok) return { text: `The vault's history isn't available: ${t.git.message}`, blocks: [{ type: "links", links: [{ label: "Memory timeline", href: "/memory?view=timeline" }] }] };
      const events = [...(t.working ? [t.working] : []), ...t.events];
      const s = t.summary;
      const blocks: ResultBlock[] = [];
      if (s)
        blocks.push({
          type: "facts",
          facts: [
            { label: "Commits", value: String(s.commits) },
            { label: "Sign-offs", value: String(s.signoffs) },
            { label: "Notes touched", value: String(s.notesTouched) },
            ...(s.lastChangeAt ? [{ label: "Last change", value: when(s.lastChangeAt) }] : []),
            ...(t.git.branch ? [{ label: "Branch", value: `${t.git.branch}${t.git.shortHead ? ` · ${t.git.shortHead}` : ""}` }] : []),
          ],
        });
      if (!events.length) return { text: kind && kind !== "all" ? `No ${kind === "signoff" ? "sign-offs" : "edits"} in the vault's history yet.` : "The vault has no history yet.", blocks };
      blocks.push({ type: "items", items: events.map(eventRow), more: { label: "Open the timeline", href: `/memory?view=timeline${kind && kind !== "all" ? `&kind=${kind}` : ""}` } });
      const latest = t.events[0];
      return {
        text: `${t.working ? "There are uncommitted changes in the vault. " : ""}${latest ? `The latest ${latest.kind === "signoff" ? "sign-off" : "commit"} is “${latest.subject}” by ${latest.author?.name ?? "someone"}, ${when(latest.committedAt)}.` : ""}`.trim(),
        blocks,
      };
    },
  }),
  defineTool({
    name: "note_history",
    group: "memory",
    title: "Show a memory note's history",
    description: "List the commits that touched one memory note, newest first, with what changed in each (lines, claims).",
    effect: "read",
    params: { noteId: { kind: "note", description: "Memory note id or what it is about; defaults to the page's note" } },
    utterances: [
      "(show|get|list) [me] [the] history (of|for) [the] [memory] note [about|on|for] {noteId}",
      "(show|get|list) [me] [the] [memory] note history (of|for|about) {noteId}",
      "(show|get|list) [me] [the] (history|changes) of {noteId} in memory",
      "(show|get|list) [me] (this|the) note's history",
      "(show|get|list) [me] [the] history of (this|the current) note",
      "(who|what) (changed|edited|updated) [the] [memory] note [about|on|for] {noteId}",
      "when was [the] [memory] note [about|on|for] {noteId} (changed|updated|edited|last changed)",
    ],
    examples: ["Show the history of the memory note about customer service", "Who changed the memory note about checkout?"],
    covers: ["memory.noteHistory"],
    summary: ({ noteId }) => `Show the history of ${noteId}`,
    run: async ({ noteId }) => {
      const h = await memory.noteHistory(noteId, { limit: 10 });
      if (!h.git.ok) return { text: `The vault's history isn't available: ${h.git.message}` };
      if (!h.entries.length) return { text: `${noteId} has no history yet; it has never been committed.`, blocks: [{ type: "links", links: [{ label: "Open the note", href: noteHref(noteId) }] }] };
      const items: ResultItem[] = h.entries.map((e) => {
        const claims = e.claims ? Object.entries(e.claims).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`) : [];
        return {
          title: e.subject,
          subtitle: [e.author?.name ?? "Not committed yet", e.additions !== null ? `+${e.additions} −${e.deletions ?? 0}` : null, claims.length ? `claims: ${claims.join(", ")}` : null].filter(Boolean).join(" · "),
          meta: when(e.committedAt),
          href: commitHref(e.kind === "uncommitted" ? MEMORY_WORKING_SHA : e.shortSha, e.path),
          status: e.kind === "uncommitted" ? EVENT_KIND.uncommitted : e.kind === "signoff" ? EVENT_KIND.signoff : (CHANGE_STATUS[e.status] ?? EVENT_KIND.commit),
        };
      });
      const last = h.entries.find((e) => e.kind !== "uncommitted");
      return {
        text: `${plural(h.entries.length, "change")} to ${noteId}${h.hasMore ? " (the newest shown)" : ""}${last ? `; last committed ${when(last.committedAt)} by ${last.author?.name ?? "someone"}` : ""}.`,
        blocks: [{ type: "items", items }, { type: "links", links: [{ label: "Open the note", href: noteHref(noteId) }] }],
      };
    },
  }),
  defineTool({
    name: "show_commit",
    group: "memory",
    title: "Show a memory commit",
    description: "Show what one vault commit changed: its notes and files with lines added and removed, and the claims it added, edited, retired or removed. 'latest' is the newest commit, 'working' the uncommitted changes.",
    effect: "read",
    params: { sha: { kind: "text", description: "A commit sha (7+ hex), 'latest', or 'working' for the uncommitted changes" } },
    utterances: [
      "(show|describe|explain|open|inspect) [me] [the] [memory|vault] commit {sha}",
      "(show|describe|explain|inspect) [me] [the] {sha} (memory|vault) commit",
      "what changed in [the] [memory|vault] commit {sha}",
      "what changed in [the] {sha} (memory|vault) commit",
      "(what's|what is|whats) in [the] {sha} (memory|vault) commit",
      "(show|list) [me] [the] {sha} (memory|vault) changes",
    ],
    examples: ["What changed in the latest memory commit?", "Show the uncommitted memory changes"],
    covers: ["memory.commit", "memory.timeline"],
    summary: ({ sha }) => `Show memory commit ${sha}`,
    run: async ({ sha: raw }) => {
      const s = raw.trim().replace(/^commit\s+/i, "");
      let sha = s;
      if (/^(?:uncommitted|working|working tree|local|unsaved|pending|current)$/i.test(s)) sha = MEMORY_WORKING_SHA;
      else if (/^(?:latest|last|newest|most recent|head|recent)$/i.test(s)) {
        const t = await memory.timeline({ limit: 1 });
        if (!t.events[0]) return { text: "The vault has no commits yet." };
        sha = t.events[0].sha;
      }
      let c: { commit: MemoryTimelineEvent | null; files: MemoryCommitFile[] };
      let tooLarge = false;
      try {
        const res = await memory.commit(sha);
        if (!res.git.ok) return { text: `The vault's history isn't available: ${res.git.message}` };
        c = res;
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        if (sha === MEMORY_WORKING_SHA && err.status === 404) return { text: "The vault has no uncommitted changes." };
        if (err.status !== 400) throw err;
        // Too large to diff without a file (the diff sheet's case): describe it from its timeline entry.
        const t = await memory.timeline({ limit: 50 });
        const ev = [t.working, ...t.events].find((x) => x && (x.sha.startsWith(sha) || x.shortSha === sha));
        if (!ev) throw err;
        c = { commit: ev, files: ev.files.map((f) => ({ ...f, claims: [] })) };
        tooLarge = true;
      }
      if (!c.commit) return { text: sha === MEMORY_WORKING_SHA ? "The vault has no uncommitted changes." : `No commit ${sha} in the vault's history.` };
      const e = c.commit;
      const claimCounts = Object.entries(e.totals.claims).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`);
      const facts = [
        { label: "Subject", value: e.subject },
        { label: "Kind", value: EVENT_KIND[e.kind].label },
        ...(e.author ? [{ label: "Author", value: e.author.name }] : []),
        { label: "Date", value: formatDate(Date.parse(e.committedAt)) },
        ...(e.project ? [{ label: "Project", value: e.project, href: `/projects/${enc(e.project)}` }] : []),
        { label: "Lines", value: `+${e.totals.linesAdded} −${e.totals.linesRemoved}` },
        { label: "Claims", value: claimCounts.join(", ") || "No claim changes" },
      ];
      const files: ResultItem[] = c.files.slice(0, 12).map((f) => ({
        title: f.title ?? f.noteId ?? f.path,
        subtitle: [f.title || f.noteId ? f.path : null, f.claims.length ? plural(f.claims.length, "claim change") : null].filter(Boolean).join(" · ") || undefined,
        meta: f.additions !== null ? `+${f.additions} −${f.deletions ?? 0}` : "binary",
        status: CHANGE_STATUS[f.status] ?? { label: f.status, tone: "neutral" },
        href: f.noteId && f.status !== "D" ? noteHref(f.noteId) : commitHref(e.kind === "uncommitted" ? MEMORY_WORKING_SHA : e.shortSha, f.path),
      }));
      const claims = c.files.flatMap((f) => f.claims).slice(0, 8);
      const blocks: ResultBlock[] = [
        { type: "facts", facts },
        { type: "items", title: "Files", items: files, ...(c.files.length > files.length ? { more: { label: `All ${c.files.length} files`, href: commitHref(e.shortSha) } } : {}) },
      ];
      if (claims.length)
        blocks.push({
          type: "items",
          title: "Claim changes",
          items: claims.map((x) => ({ title: clip(x.text), subtitle: `${x.kind}${x.reason ? `: ${x.reason}` : ""} · ${x.noteId}`, href: `${noteHref(x.noteId)}#c-${x.blockId}` })),
        });
      if (tooLarge) blocks.push({ type: "text", tone: "attention", text: "This commit is too large to diff in one go, so its claim changes aren't listed; open a file from the timeline to see its diff." });
      else if (e.claimsAnalysed !== "yes") blocks.push({ type: "text", tone: "attention", text: e.claimsAnalysed === "truncated" ? "The diff was cut short, so claim counts are a lower bound." : "This commit was too large to count its claim changes." });
      blocks.push({ type: "links", links: [{ label: "Open in the timeline", href: commitHref(e.kind === "uncommitted" ? MEMORY_WORKING_SHA : e.shortSha) }] });
      return { text: `${e.kind === "uncommitted" ? "Uncommitted changes" : `“${e.subject}” (${e.shortSha})`}: ${changeLine(e)}, ${plural(c.files.length, "file")} in all.`, blocks };
    },
  }),
  defineTool({
    name: "stale_memory",
    group: "memory",
    title: "List stale memory",
    description: "List signed-off documents whose files changed since they were accepted, so the claims citing them may be out of date.",
    effect: "read",
    params: {},
    utterances: [
      "(list|show [me]) [the|all] stale (memory|notes|documents|docs|memory notes|sources|claims)",
      "(what's|what is|whats) stale [in [the] (memory|vault)]",
      "(which|what) (notes|documents|docs|claims) are stale",
      "(is|are) (anything|any notes|any documents|any claims) stale [in [the] (memory|vault)]",
      "(any|are there any) stale (documents|notes|docs|claims|memory)",
      "(is|are) [the] (memory|vault) [out of date|stale]",
    ],
    examples: ["What's stale in memory?", "Show stale documents"],
    covers: ["memory.stale"],
    summary: () => "List stale memory",
    run: async () => {
      const { stale } = await memory.stale();
      if (!stale.length) return { text: "Nothing is stale: every signed-off document still matches what was accepted." };
      const claims = stale.reduce((n, s) => n + s.claims, 0);
      return {
        text: `${plural(stale.length, "signed-off document")} changed since ${stale.length === 1 ? "it was" : "they were"} accepted; ${plural(claims, "claim")} cite ${stale.length === 1 ? "it" : "them"}.`,
        blocks: [{ type: "items", items: stale.map((s) => ({ title: s.title ?? s.document, subtitle: `${s.path} · ${plural(s.claims, "claim")} cite it`, href: noteHref(s.document), status: { label: "Stale", tone: "attention" } })) }],
      };
    },
  }),
  defineTool({
    name: "memory_graph",
    group: "memory",
    title: "Summarize the memory graph",
    description: "Summarize how memory notes link to each other: note and link counts, notes without any connection, and the most connected notes.",
    effect: "read",
    params: {},
    utterances: [
      "(show|describe|summarize|summarise) [me] [the] (memory|vault|knowledge) graph",
      "(memory|vault|knowledge) graph [stats|summary|overview]",
      "(what|which) (notes|systems) are [the] (most connected|best connected|most linked|central)",
      "[the] (most connected|best connected|most linked) (notes|systems)",
      "(what|which) notes (have no|lack|are missing) (links|connections)",
      "how (connected|linked) is [the] (memory|vault)",
    ],
    examples: ["Which notes are most connected?", "Summarize the memory graph"],
    covers: ["memory.graph"],
    summary: () => "Summarize the memory graph",
    run: async () => {
      const g = await memory.graph();
      const isolated = g.nodes.filter((n) => n.linkCount === 0);
      const top = [...g.nodes].sort((a, b) => b.linkCount - a.linkCount).filter((n) => n.linkCount > 0).slice(0, 8);
      const blocks: ResultBlock[] = [
        { type: "facts", facts: [{ label: "Notes", value: String(g.nodes.length) }, { label: "Links", value: String(g.edges.length) }, { label: "Unconnected", value: String(isolated.length) }] },
      ];
      if (top.length) blocks.push({ type: "items", title: "Most connected", items: top.map((n) => ({ title: n.title, subtitle: typeLabel(n.type), meta: plural(n.linkCount, "link"), href: noteHref(n.id) })) });
      if (isolated.length) blocks.push({ type: "items", title: "No connections", items: isolated.slice(0, 6).map((n) => ({ title: n.title, subtitle: typeLabel(n.type), href: noteHref(n.id) })), ...(isolated.length > 6 ? { more: { label: `All ${isolated.length} on the Health tab`, href: "/memory?view=health#check-connected" } } : {}) });
      blocks.push({ type: "links", links: [{ label: "Open the graph", href: "/memory?view=graph" }] });
      return { text: `The graph has ${plural(g.nodes.length, "note")} and ${plural(g.edges.length, "link")}; ${plural(isolated.length, "note")} ${isolated.length === 1 ? "has" : "have"} no connection.${top[0] ? ` Most connected: ${top[0].title} (${plural(top[0].linkCount, "link")}).` : ""}`, blocks };
    },
  }),
  defineTool({
    name: "rebuild_memory_index",
    group: "memory",
    title: "Rebuild the memory index",
    description: "Rebuild the memory vault's derived search index (memory/.index, safe to regenerate). The first build may download a small embeddings model and take a few minutes.",
    effect: "write",
    params: {},
    utterances: [
      "(rebuild|reindex|re-index|regenerate|refresh|update) [the] (memory|vault|memory vault|search) index",
      "(rebuild|reindex|re-index) [the] (memory|vault|memory vault)",
      "(rebuild|refresh) [the] memory search",
    ],
    examples: ["Rebuild the memory index"],
    covers: ["memory.rebuildIndex"],
    summary: () => "Rebuild the memory search index",
    preview: () => [{ type: "text", text: "Rebuilds the derived search index from the vault's notes. The first build may download a small embeddings model and take a few minutes." }],
    run: async (_input, ctx) => {
      const stats = await memory.rebuildIndex();
      void ctx.qc.invalidateQueries({ queryKey: ["memory"] });
      const ch = stats.changed;
      const blocks: ResultBlock[] = [
        {
          type: "facts",
          facts: [
            { label: "Notes", value: `${stats.totals.notes} (${ch.notes} changed)` },
            { label: "Claims", value: `${stats.totals.claims} (${ch.claims} changed)` },
            { label: "Sections", value: String(stats.totals.sections) },
            { label: "Documents", value: String(stats.totals.documents) },
            { label: "Embeddings", value: stats.embeddings === "on" ? "On" : stats.embeddings === "off" ? "Off" : "Unavailable" },
            { label: "Lint findings", value: String(stats.lint.length), href: "/memory?view=health#check-lint" },
          ],
        },
      ];
      if (stats.unresolvedLinks.length) blocks.push({ type: "text", tone: "attention", text: `${plural(stats.unresolvedLinks.length, "link")} point at notes that don't exist.` });
      if (stats.stale.length) blocks.push({ type: "text", tone: "attention", text: `${plural(stats.stale.length, "signed-off document")} drifted since sign-off.` });
      for (const w of stats.warnings) blocks.push({ type: "text", tone: "attention", text: w });
      return { text: `Memory index rebuilt: ${stats.totals.notes} notes, ${stats.totals.claims} claims.`, blocks };
    },
  }),
] as const;
