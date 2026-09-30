import "server-only";
/**
 * The generic drafting agent for BRDs: turns any request text plus note files and confirmed
 * dependencies into a template-conformant BRD. It classifies each source line the way the
 * po-brd skill's requirement ledger does (need, fact, decision, question, instruction) and cites
 * every item back to its line, so a user-created project gets a believable first draft.
 */
import type { DraftReport } from "@/lib/delivery/types";
import { capitalize, keywords, numberedLines, sentences, titleCase } from "@/server/mock/workflows/lib/text";
import { Cites } from "../doc/cites";
import { draftBrd, type BrdSpec, type QuestionSpec } from "../doc/brd";
import { registerTitles } from "../memory-doc";
import type { DocResult, DraftContext } from "../types";

interface Statement {
  cite: string;
  text: string;
}

type Class = "instruction" | "reference" | "outOfScope" | "lead" | "metric" | "date" | "detail" | "question" | "need" | "fact";

const RX: Record<Exclude<Class, "need" | "fact">, RegExp> = {
  // "See ECOM-2210", "Review this ticket CP-50908 and the parent epic": pointers that seed discovery, not needs.
  reference: /^(see|review|check|read|look at|refer to|per|also see)\b[^.]*(\b[A-Z][A-Z0-9]+-\d+\b|\/pages\/\d+|\bticket|\bepic|\bpage)/i,
  instruction: /\b(agent|assistant|claude|ai|llm|bot)\b[^.]*\b(mark|approve|approved|email|send|publish|share|post|delete|ignore|skip)\b/i,
  outOfScope: /^(not doing|out of scope|won'?t|excluding|exclude)\b|\bnot (doing|in scope)\b|\bout of scope\b/i,
  lead: /\b(wants this|sponsor|i'?m leading|leading as|product manager|\bpm\b|business owner|stakeholder)\b/i,
  metric: /\b(metric|kpi|measure|rate|fewer|reduce|increase|conversion|baseline)\b|%/i,
  date: /\b(launch|deadline|go[- ]live|release date|holiday|before (the )?(end|start)|by (q[1-4]|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec))\b/i,
  detail: /\b(postgres|mysql|trigger|cron|kafka|lambda|redis|sql|stored procedure|microservice|react|angular|java|node\.?js|use [a-z]+ (to|for))\b/i,
  question: /\?|\bmaybe\b|\bcheck with\b|\btbd\b|\bnot sure\b|\bunclear\b/i,
};

const STRONG_NEED = /\b(need|needs|should|must|want|wants|able to|allow|let|require|requires)\b|^idea:/i;
const NEED = /\b(need|needs|should|must|want|wants|able to|allow|let|show|send|display|support|track|capture|restrict|filter|notify|remind|export|see|view|list|record|snooze|turn off|opt[- ]?out|opt[- ]?in|prompt|block|require|search|look ?up)\b/i;
const FACT =
  /\b(forget|forgets|run out|runs out|ran out|angry|manual|manually|no way|cannot|can'?t|today|currently|problem|pain|tickets|complain|complains|depend|lack|missing|slow|says|wait|waits|waiting|call|calls|calling|lose|losing|lost|confused|errors?|churn)\b/i;

// Complaints and observations that mention a need word but describe the problem, not a requirement.
const STRONG_FACT = /\b(keeps?|kept) (asking|calling|forgetting|emailing)\b|\bcomplain|\bwaits? (two|three|several|\d+) (days|weeks)|\bcalls? support\b|\btoday\b|\bcurrently\b|\bright now\b/i;

// Base-form verbs an imperative requirement starts with, and their third-person form.
const IMPERATIVE: Record<string, string> = {
  send: "sends", show: "shows", display: "displays", notify: "notifies", remind: "reminds", let: "lets", allow: "allows",
  capture: "captures", record: "records", track: "tracks", export: "exports", block: "blocks", prompt: "prompts",
  require: "requires", restrict: "restricts", filter: "filters", list: "lists", support: "supports", flag: "flags",
  store: "stores", keep: "keeps", hide: "hides", add: "adds", provide: "provides", offer: "offers", email: "emails",
};

function classify(text: string): Class {
  if (RX.instruction.test(text)) return "instruction";
  if (RX.reference.test(text)) return "reference";
  if (RX.outOfScope.test(text)) return "outOfScope";
  if (RX.lead.test(text)) return "lead";
  if (/^(metrics?|kpis?|success)\b/i.test(text)) return "metric";
  if (STRONG_FACT.test(text)) return "fact";
  const imperative = IMPERATIVE[/^([a-z]+)\b/i.exec(text)?.[1]?.toLowerCase() ?? ""] !== undefined;
  if (RX.metric.test(text) && !FACT.test(text) && !imperative && !STRONG_NEED.test(text)) return "metric";
  if (RX.date.test(text)) return "date";
  if (RX.detail.test(text)) return "detail";
  if (RX.question.test(text)) return "question";
  if (STRONG_NEED.test(text)) return "need";
  if (FACT.test(text)) return "fact";
  if (NEED.test(text)) return "need";
  return "fact";
}

function statements(ctx: DraftContext): Statement[] {
  const out: Statement[] = [];
  for (const note of ctx.notes) {
    for (const line of numberedLines(note.content)) {
      if (/^#{1,6}\s/.test(line.text)) continue;
      for (const s of sentences(line.text)) out.push({ cite: `${note.id} L${line.n}`, text: s.replace(/^\s*[-*]\s*/, "") });
    }
  }
  return out;
}

/** Rewrites a need statement as an observable capability ("<actor> can <verb> …", "The solution <verb>s …"). */
function toRequirement(text: string): string {
  let t = text
    .replace(/^(idea|note|req|requirement|ask)s?:\s*/i, "")
    .replace(/^(maybe|perhaps|ideally|also|and)\s+(also\s+)?/i, "")
    .replace(/^(we|i|they|legal|support|the business)\s+(really\s+)?(need|needs|want|wants|would like)\s+(to\s+)?/i, "")
    .replace(/^(need|needs|must|should)\s+(to\s+)?/i, "")
    .replace(/\?+$/, "")
    .trim();
  // "It should show X" -> "The solution shows X".
  t = t.replace(/^(it|this|that)\s+(should|must|will|needs to|has to)\s+([a-z]+)/i, (_m, _p: string, _v: string, verb: string) => `The solution ${third(verb)}`);
  // "a rank progress widget on the dashboard" (after "we want") -> "The solution provides a …".
  if (/^(a|an|some)\s/i.test(t)) t = `The solution provides ${t.charAt(0).toLowerCase()}${t.slice(1)}`;
  // "customers to see X" (after "we need") and "support should be able to look up X".
  t = t.replace(/^((?:the\s+)?[a-z][\w/-]*(?:\s+[a-z][\w/-]*)?)\s+to\s+(?=[a-z])/i, "$1 can ");
  t = t.replace(/\b(should|must|need to|needs to|want to|wants to)\s+be\s+able\s+to\b/i, "can");
  t = t.replace(/\b(is|are)\s+able\s+to\b/i, "can");
  const verb = /^([a-z]+)\b/i.exec(t)?.[1]?.toLowerCase();
  const actorFirst = /^[\w/-]+\s+(can|should|must|will|may|is|are|has|have|needs?|wants?|gets?|receives?)\b/i.test(t);
  if (verb && IMPERATIVE[verb] && !actorFirst) t = `The solution ${IMPERATIVE[verb]}${t.slice(verb.length)}`;
  t = capitalize(t);
  return /[.!]$/.test(t) ? t.replace(/[.!]$/, "") : t;
}

function third(verb: string): string {
  const v = verb.toLowerCase();
  return IMPERATIVE[v] ?? (/(s|sh|ch|x|z)$/.test(v) ? `${v}es` : /[^aeiou]y$/.test(v) ? `${v.slice(0, -1)}ies` : `${v}s`);
}

/** Lowercases ordinary words of a title for use mid-sentence; acronyms and mixed case stay. */
function topicOf(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => (/^[A-Z][a-z]+$/.test(w) ? w.toLowerCase() : w))
    .join(" ");
}

/** "Customers can …" -> "customers can …" mid-sentence; leaves acronyms such as "BI" alone. */
function lowerFirst(text: string): string {
  return /^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

function article(phrase: string): string {
  return /^[aeiou]/i.test(phrase) && !/^(uni|use|eu|one)/i.test(phrase) ? "An" : "A";
}

function uniq(items: readonly string[]): string[] {
  return [...new Set(items)];
}

function withCite(text: string, cite: string): string {
  return `${text.replace(/[.\s]+$/, "")} [${cite}].`;
}

function who(text: string): string {
  if (/\blegal|consent|privacy|tcpa|compliance\b/i.test(text)) return "Legal";
  if (/\bdata|report|bi\b|metric/i.test(text)) return "PO / BI (Thomas Hamilton)";
  if (/\bengineering|system|service|integration\b/i.test(text)) return "Engineering";
  return "PO";
}

export function titleFor(ctx: DraftContext, fallback?: string): string {
  if (fallback) return fallback;
  // The project's own name keeps its casing ("zz J1 Loyalty…"); a slug is title-cased.
  if (ctx.projectName?.trim()) return ctx.projectName.trim();
  if (ctx.projectId) return titleCase(ctx.projectId);
  const base = ctx.out.split("/").pop()?.replace(/\.md$/, "") ?? "";
  if (base && !/^(brd|aad)$/i.test(base)) return titleCase(base);
  const words = keywords(ctx.request || ctx.notes.map((n) => n.content).join("\n"), 4);
  return words.length > 0 ? titleCase(words.join(" ")) : "New Initiative";
}

/** A BRD for any request, following the po-brd template. */
export function genericBrd(ctx: DraftContext, title?: string): DocResult<DraftReport> {
  const cites = new Cites(ctx);
  const name = titleFor(ctx, title);
  const all = statements(ctx);
  const by = (c: Class) => all.filter((s) => classify(s.text) === c);
  const needs = by("need");
  const facts = by("fact");
  const questionsSrc = by("question");
  const details = by("detail");
  const instructions = by("instruction");
  const dates = by("date");
  const metricsSrc = by("metric");
  const exclusions = by("outOfScope");
  const leads = by("lead");
  const topic = topicOf(name);
  const text = all.map((s) => s.text).join(" ");
  const customerFacing = /\bcustomer|ambassador|member|shopper|retail|preferred\b/i.test(text);
  const questions: QuestionSpec[] = [];

  // Requirements: one observable capability per need statement, then candidates to reach five.
  const seen = new Set<string>();
  const requirements: BrdSpec["requirements"] = [];
  for (const s of needs) {
    const t = toRequirement(s.text);
    const key = t.toLowerCase().slice(0, 40);
    if (t.length < 8 || seen.has(key)) continue;
    seen.add(key);
    requirements.push({ text: withCite(t, s.cite) });
    if (requirements.length >= 7) break;
  }
  for (const s of questionsSrc) {
    if (requirements.length >= 8 || /^(check|confirm|ask|find out|clarify|who|which|what|when|how)\b|\bwhether\b/i.test(s.text)) continue;
    if (!NEED.test(s.text) && !/phase 2|one-click|could|would be great/i.test(s.text)) continue;
    requirements.push({ text: withCite(toRequirement(s.text.split("?")[0] ?? s.text), s.cite), candidate: true });
  }
  for (const e of ctx.evidence) {
    if (requirements.length >= 5) break;
    if (!/related ticket|spec/.test(e.relation)) continue;
    requirements.push({ text: `The capability described in ${e.ref} "${e.title}" is covered by this work [${e.id}].`, candidate: true });
  }
  const fillers = [
    `Access to the ${topic} capability is limited to its intended audience; who that is and how access is controlled are open questions [${cites.note("request")}].`,
    `The people affected by ${topic} are told about the change before it goes live [${cites.note("request")}].`,
    `The current state of ${topic} can be seen without asking another team for it [${cites.note("request")}].`,
    `Changes made through ${topic} are recorded so that who changed what, and when, can be shown later [${cites.note("request")}].`,
    `Customer Support can answer a customer's question about ${topic} from the tools they already use [${cites.note("request")}].`,
  ];
  for (const f of fillers) {
    if (requirements.length >= 5) break;
    requirements.push({ text: f, candidate: true });
  }

  // Business and Product Lead.
  const lead =
    leads.length > 0
      ? [
          `Named in the sources: ${leads.map((s) => withCite(s.text, s.cite)).join(" ")} The business stakeholder and the Product Manager should confirm these roles.`,
        ]
      : [`Not yet provided. No source names a business stakeholder or the Product Manager leading this work. See Open Questions Q1.`];
  if (leads.length === 0) questions.push({ text: "Who is the business stakeholder owning this work, and who is the Product Manager leading it? No source names them.", who: "PO" });

  // Problem to be Solved, tied back to the customer. Only statements of fact; a need is not a problem.
  const problemSrc = facts.slice(0, 3);
  const problem =
    problemSrc.length > 0
      ? [problemSrc.map((s) => withCite(s.text, s.cite)).join(" ")]
      : [
          `The sources say what is wanted${needs[0] ? ` (${lowerFirst(toRequirement(needs[0].text))} [${needs[0].cite}])` : ""} but not the problem behind it, how often it happens, or what it costs [${cites.note("request")}]. See Open Questions.`,
        ];
  if (problemSrc.length === 0) questions.push({ text: `What problem does ${topic} solve today, for whom, and how often does it happen?`, who: "PO", blocking: true });
  if (customerFacing) {
    const where = uniq(problemSrc.map((s) => s.cite)).join(", ") || cites.note("request");
    problem.push(`Customer tie-back: the sources name customers directly [${where}]. They do not quantify how often the problem happens or what it costs; see Open Questions.`);
  } else {
    problem.push("Customer tie-back: the sources describe an internal need only; the customer impact is not stated. See Open Questions.");
    questions.push({ text: `What is the customer impact of the problem ${topic} addresses? The sources describe only an internal need.`, who: "PO", blocking: true });
  }

  // Proposed Solution, high level; implementation detail becomes a suggestion for engineering.
  const first = requirements.find((r) => !r.candidate) ?? requirements[0];
  const firstText = first ? first.text.replace(/\s*\[[^\]]*\]\.?$/, "") : "";
  const solution = [
    first
      ? `${article(topic)} ${topic} capability that meets the needs listed under Requirements, first of all: ${lowerFirst(firstText)} [${cites.note("request")}].`
      : `${article(topic)} ${topic} capability that addresses the need described in the request [${cites.note("request")}].`,
    "The surface, the owning service and the rollout are deliberately not decided here; they belong to the architecture step.",
  ];
  for (const d of details) solution.push(`The notes suggest an implementation detail: "${d.text}" [${d.cite}]. It is recorded as a suggestion for engineering, not as a requirement.`);

  // Success Metrics: candidates only.
  const metricItems = metricsSrc.slice(0, 3).map((s) => `(Candidate) ${withCite(toRequirement(s.text.replace(/^metric:\s*/i, "")), s.cite)} Baseline not provided.`);
  if (metricItems.length < 2) metricItems.push("(Candidate) Share of the intended users who use the new capability within 30 days of launch. Baseline not provided.");
  if (metricItems.length < 2) metricItems.push("(Candidate) Reduction in the manual work or support contacts the request describes. Baseline not provided.");
  const kpiLine = /### Product KPIs\s*\n+\s*- ([^\n]+)/.exec(ctx.memory.content)?.[1];

  // Out of Scope.
  const outOfScope = [
    ...exclusions.map((s) => withCite(capitalize(s.text.replace(/^(not doing|out of scope)\s*:?\s*/i, "")), s.cite)),
    "Technical solution design and ticket breakdown; this BRD stops at requirements.",
  ];

  // Open Questions.
  for (const s of questionsSrc) {
    questions.push({
      text: withCite(capitalize(s.text.replace(/\.$/, "")), s.cite).replace(/\.$/, ""),
      who: who(s.text),
      blocking: /phase 2|scope|legal|consent|in or out/i.test(s.text),
    });
  }
  const conflicts: string[] = [];
  for (const e of ctx.evidence.filter((d) => /parent epic/.test(d.relation)).slice(0, 2)) {
    questions.push({ text: `Overlap: ${e.ref} "${e.title}" already exists [${e.id}]. Does this BRD supersede, feed, or duplicate it, and which is the system of record?`, who: "PO", blocking: true });
    conflicts.push(`Overlap with existing backlog: ${e.ref} [${e.id}] already frames this work; recorded as an open question rather than resolved.`);
  }
  const words = new Set(keywords(`${name} ${text}`, 12));
  const overlap = registerTitles(ctx.memory.content).find(
    (r) => r.path !== ctx.out && r.type === "BRD" && r.title.toLowerCase().split(/\W+/).filter((w) => w.length > 4 && words.has(w)).length >= 2,
  );
  if (overlap) {
    questions.push({ text: `The shared memory registers the BRD "${overlap.title}" (\`${overlap.path}\`) [M Document register], which covers related ground. How does this BRD relate to it?`, who: "PO", blocking: true });
    conflicts.push(`Possible overlap with the registered BRD "${overlap.title}" (\`${overlap.path}\`) [M Document register]; see Open Questions.`);
  }
  questions.push({ text: "What is the product line's core KPI these metrics should tie to?", who: "PO / BI (Thomas Hamilton)" });
  questions.push({ text: "Are the candidate success metrics measurable in the BI stack, and what are their baselines, targets, owners, and dates?", who: "BI (Thomas Hamilton)" });
  for (const s of dates.slice(0, 1)) questions.push({ text: `Is "${s.text.replace(/\.$/, "")}" [${s.cite}] a committed date, and which release window does it mean?`, who: "PO", blocking: false });
  for (const d of details) conflicts.push(`${d.cite} names a solution detail ("${d.text.replace(/\.$/, "")}"); recorded under Proposed Solution as a PO suggestion, not a requirement.`);

  // Keep between two and six blocking questions, as the skill reports only the ones that block scope.
  let blocking = questions.filter((q) => q.blocking).length;
  for (const q of questions) {
    if (blocking >= 2) break;
    if (!q.blocking) {
      q.blocking = true;
      blocking++;
    }
  }
  for (const q of [...questions].reverse()) {
    if (blocking <= 6) break;
    if (q.blocking) {
      q.blocking = false;
      blocking--;
    }
  }

  const plan = [undefined, undefined, undefined, undefined, dates[0] ? `Not yet provided. The notes name "${dates[0].text.replace(/\.$/, "")}" as the target [${dates[0].cite}].` : undefined].map((p) => p ?? "Not yet provided.");

  const spec: BrdSpec = {
    title: name,
    lead,
    problem,
    solution,
    requirements,
    metrics: {
      intro: "Candidates only. No baseline, target, owner, or date is stated in any source; each candidate must be validated with BI (template contact: Thomas Hamilton) before use.",
      items: metricItems,
      outro: kpiLine ? `The shared memory records: "${kpiLine.replace(/\s*\[`[^`]+`\]$/, "")}" [M Product KPIs].` : "The product line's core KPI is not stated in any source. See Open Questions.",
    },
    outOfScope,
    outOfScopeNote: "Likely but unstated exclusions are recorded in Open Questions rather than asserted here.",
    questions,
    planIntro: dates.length > 0 ? "Status and dates only where the sources provide them." : "Status and dates only where the sources provide them. No source provides any; all items are unstarted and unscheduled.",
    plan,
  };

  const noteIds = ctx.notes.map((n) => n.id);
  const refIds = ctx.evidence.map((e) => e.id);
  const main = requirements.filter((r) => !r.candidate).length;
  return draftBrd(
    spec,
    {
      conflicts,
      ignoredInstructions: [
        ...instructions.map((s) => `${s.cite} — a line addressed to the agent ("${s.text.replace(/\.$/, "")}"); ignored, because the skill never approves, sends, or publishes documents.`),
        "No file was sent, published, or shared; no ticket or memory update was written (a memory update is only proposed after the PO accepts the BRD).",
      ],
      changes: [
        `Created ${ctx.out} as a first draft from ${noteIds.join(", ") || "the request"}${refIds.length > 0 ? ` and the confirmed references ${refIds.length > 1 ? `${refIds[0]}–${refIds[refIds.length - 1]}` : refIds[0]}` : ""}, plus the shared memory M.`,
        `Requirements 1–${main} written as observable capabilities from the source lines they cite; ${requirements.length - main} candidate requirements held back for the PO to confirm.`,
        `Success Metrics offered as ${metricItems.length} candidates marked for BI validation; no baselines, targets, owners, or dates invented.`,
        `${questions.length} open questions recorded with who can answer them; ${questions.filter((q) => q.blocking).length} block the problem statement or scope.`,
        "Sources appendix added with every identifier cited in the body, noted as removable before circulation.",
      ],
    },
    cites,
    ctx.out,
  );
}
