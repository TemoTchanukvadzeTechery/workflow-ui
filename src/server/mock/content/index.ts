import "server-only";
/**
 * Content for the Stage 1-2 mock workflows: the initial workspace (the real po-workspace memory,
 * skills, documents and notes, plus demo notes), the drafting, revision, discovery and memory
 * "agents", and mockConfluenceDoc for "Import from Confluence". Pure functions over files in
 * ./files; nothing here journals anything.
 */
import type { AadReport, DraftReport } from "@/lib/delivery/types";
import { extractRefs, hashInt, titleCase } from "@/server/mock/workflows/lib/text";
import { catalogItem } from "./catalog";
import { contentFile } from "./files";
import { genericAad } from "./generic/aad";
import { genericBrd } from "./generic/brd";
import { MEMORY_PATH } from "./memory-doc";
import { pickPack } from "./packs";
import { reviseDocument as revise } from "./revise";
import type { DocResult, DraftContext, ReviseContext } from "./types";

export { agrRequests } from "./agr-fixture";
export { catalogItem, catalogItems, runAtl, searchCatalog } from "./catalog";
export type { CatalogItem } from "./catalog";
export { discoveryPlanner } from "./discovery";
export { proposeMemory } from "./memory";
export { MEMORY_PATH, MEMORY_TEMPLATE, lineDiff, registerEntries } from "./memory-doc";
export { PACKS, packById, pickPack } from "./packs";
export { aadFrs, brdRequirements, docTitle, openQuestions, systemChanges } from "./doc/parse";
export type * from "./types";

/** Note files seeded into the workspace, by workspace path. */
const NOTE_FILES: Record<string, string> = {
  "notes/examples/reorder-reminders.md": "notes/examples/reorder-reminders.md",
  "notes/agreement-reporting/legal-call.md": "notes/agreement-reporting/legal-call.md",
  "notes/agreement-status-lookup/cs-escalations.md": "notes/agreement-status-lookup/cs-escalations.md",
  "notes/compliance-export/legal-export-request.md": "notes/compliance-export/legal-export-request.md",
  "notes/policy-reacceptance/privacy-update.md": "notes/policy-reacceptance/privacy-update.md",
  "notes/terms-gate/kickoff.md": "notes/terms-gate/kickoff.md",
  "notes/sms-consent/requirements-call.md": "notes/sms-consent/requirements-call.md",
};

function initialWorkspace(): Record<string, string> {
  const files: Record<string, string> = {
    [MEMORY_PATH]: contentFile("memory.md"),
    ".claude/skills/po-brd/SKILL.md": contentFile("skills/po-brd.SKILL.md"),
    ".claude/skills/architect-aad/SKILL.md": contentFile("skills/architect-aad.SKILL.md"),
    // The documents the real memory register points at, so its entries are not reported stale.
    "brd/brd.md": contentFile("agr-brd.md"),
    "aad/aad.md": contentFile("agr-aad.md"),
  };
  for (const [path, file] of Object.entries(NOTE_FILES)) files[path] = contentFile(file);
  return files;
}

/**
 * The mock po-workspace at first start: memory/memory.md (the real shared memory), both skills,
 * the real brd/brd.md and aad/aad.md, notes/examples/reorder-reminders.md and demo notes.
 */
export const INITIAL_WORKSPACE: Record<string, string> = initialWorkspace();

/** Round 1 of the drafting agent: the project's pack if it has one, else the generic generator. */
export function draftDocument(ctx: DraftContext): DocResult<DraftReport | AadReport> {
  const pack = pickPack(ctx.projectId, ctx.out);
  if (ctx.docType === "BRD") return pack?.brd?.(ctx) ?? genericBrd(ctx, pack?.title);
  return pack?.aad?.(ctx) ?? genericAad(ctx);
}

/** Round 2 and later: revise the current file (with the human's edits) from the feedback. */
export function reviseDocument(ctx: ReviseContext): DocResult<DraftReport | AadReport> {
  return revise(ctx);
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "imported"
  );
}

/**
 * A template-conformant BRD or AAD standing in for a Confluence page the mock "fetches" on
 * import. `ref` is a page id or a Confluence URL (/pages/<id> or ?pageId=<id>).
 */
export function mockConfluenceDoc(kind: "brd" | "aad", ref: string, title?: string): { title: string; content: string } {
  const id = extractRefs(ref)[0] ?? ref.trim();
  const item = catalogItem(id);
  const fallback = UNKNOWN_PAGES[hashInt(id) % UNKNOWN_PAGES.length]!;
  const name = title?.trim() || item?.title || fallback.title;
  const cleanName = name.replace(/^(BRD|AAD)\s*[-:–]\s*/i, "").replace(/^Architecture Approach\s*[-–]\s*/i, "");
  const page = importedPageText(cleanName, item ? item.description : title?.trim() ? undefined : fallback.description);
  const file = slug(cleanName);
  const brdCtx: DraftContext = {
    docType: "BRD",
    runId: "import",
    round: 1,
    out: `brd/${file}.md`,
    request: page,
    notes: [{ id: "N1", path: "inline", content: page, type: "Confluence page", entry: page }],
    evidence: item
      ? [{ id: "R1", ref: item.ref, kind: item.kind, title: item.title, relation: "imported page", why: "The page being imported", text: item.description }]
      : [],
    memory: { path: MEMORY_PATH, content: contentFile("memory.md"), stale: [] },
    now: Date.now(),
  };
  const brd = genericBrd(brdCtx, titleCase(cleanName));
  if (kind === "brd") return { title: cleanName, content: brd.content };
  const aad = genericAad({ ...brdCtx, docType: "AAD", out: `aad/${file}.md`, notes: [], brd: { path: brdCtx.out, content: brd.content } });
  return { title: cleanName, content: aad.content };
}

/** Stand-ins for page ids the catalog does not know, so an import still reads like a real page. */
const UNKNOWN_PAGES: ReadonlyArray<{ title: string; description: string }> = [
  {
    title: "Ambassador Agreement Renewal Reminders",
    description: "Ambassadors whose Brand Ambassador Agreement is due for renewal today find out only when they are blocked at login, and Customer Support takes the calls.",
  },
  {
    title: "Customer Consent History",
    description: "Legal currently cannot show which consent wording a customer saw and when without a data pull from Engineering.",
  },
  {
    title: "Autoship Skip Window",
    description: "Customers who want to skip one autoship shipment currently have to call Customer Support, because My Account only offers cancel.",
  },
  {
    title: "Rank Qualification Snapshot",
    description: "Ambassadors keep asking Customer Support whether an order placed today counts toward this month's rank qualification.",
  },
];

/**
 * The body the mock "fetches" for an imported page: the page's problem statement, then the needs
 * a reviewed Plexus BRD on that topic typically states, so the generated document has a full
 * Requirements list instead of placeholders.
 */
function importedPageText(name: string, description?: string): string {
  const topic = name.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  const lower = topic
    .split(/\s+/)
    .map((w) => (/^[A-Z][a-z]+$/.test(w) ? w.toLowerCase() : w))
    .join(" ");
  return [
    `# ${name}`,
    description ?? `Today the teams involved have no single place to see or manage ${lower}, so questions go to Customer Support or Engineering.`,
    `Customers must be able to see the current state of ${lower} in My Account.`,
    `Customer Support should be able to look up ${lower} for one customer by Customer ID.`,
    `Every change to ${lower} must be recorded with who made it, what changed, and when.`,
    `The business needs a report of ${lower} that can be filtered by market and date.`,
    `Customers must be told about changes to ${lower} before they take effect.`,
    `Which markets are in the first release?`,
  ].join("\n");
}
