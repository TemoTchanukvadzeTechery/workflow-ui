import "server-only";
/**
 * The generic drafting agent for AADs: reads the accepted BRD (B1), picks the systems from the
 * shared memory and the BRD's wording, traces one functional requirement to each BRD
 * requirement, and fills the architect-aad template. Authored packs pass overrides for the parts
 * they know better (systems, design elements, tradeoffs, questions, decisions).
 */
import type { AadReport } from "@/lib/delivery/types";
import { keywords } from "@/server/mock/workflows/lib/text";
import { draftAad, type AadFrSpec, type AadReportSpec, type AadSpec, type AadSystem, systemKind } from "../doc/aad";
import type { QuestionSpec } from "../doc/brd";
import { Cites } from "../doc/cites";
import { brdRequirements, bulletItems, docTitle, numberedItems, openQuestions, sectionBody, stripCites } from "../doc/parse";
import type { DocResult, DraftContext } from "../types";
import { titleFor } from "./brd";

interface LibrarySystem extends AadSystem {
  match: RegExp;
  order: number;
}

/** Plexus systems the generic architect can pick, with the roles the shared memory records. */
const LIBRARY: LibrarySystem[] = [
  {
    name: "website-customer-portal",
    role: "Internal customer-management web app (Node 22 + Angular 21, SSR disabled, Okta OIDC) [M Systems and services]. Proposed host for the new internal surface.",
    status: "Proposed",
    change: "New page or section for the BRD capabilities; route-level authorization for the intended role; feature-flag gating.",
    kind: "host",
    match: /\b(legal|compliance|internal|customer service|cs agent|support agent|portal|look ?up|report|analytics|dashboard|export)\b/i,
    order: 1,
  },
  {
    name: "My Account V3",
    role: "Customer-facing account area where customers manage their orders and preferences. Proposed host for the customer-facing changes.",
    status: "Proposed",
    change: "New or changed customer-facing screens behind a feature flag; English and Spanish copy.",
    kind: "host",
    match: /\b(my account|snooze|turn off|preferences?|customers? (can|should|must)|retail|preferred|opt[- ]?in|opt[- ]?out)\b/i,
    order: 2,
  },
  {
    name: "api-gateway",
    role: "Existing edge; authenticates and forwards, owns no domain SQL [M Integration conventions].",
    status: "Proposed",
    change: "New route for the new endpoint, authenticate and forward only.",
    kind: "gateway",
    match: /./,
    order: 3,
  },
  {
    name: "customer-service-v2",
    role: "Java service that owns the customer and agreement domain SQL [M Systems and services]. Proposed owner of the new endpoint.",
    status: "Proposed",
    change: "New read or write endpoint owned by the domain service, defined in api-contracts first.",
    kind: "service",
    match: /\b(agreement|acceptance|consent|customer|preference|policy|ambassador|opt)\b/i,
    order: 4,
  },
  {
    name: "order-service-v2",
    role: "Order domain service. Source of order history per customer and product.",
    status: "Proposed",
    change: "New read endpoint returning the last order date and quantity per product.",
    kind: "service",
    match: /\b(order|reorder|auto-?order|subscription|consumable|stockout|run out)\b/i,
    order: 5,
  },
  {
    name: "ThatOtherGuy database",
    role: "Holds the customer, agreement and acceptance tables [M Systems and services].",
    status: "Proposed, read-only",
    change: "Indexed, set-based queries; any stored procedure or index owned by Data Engineering. No schema change identified.",
    kind: "db",
    match: /\b(agreement|acceptance|consent|customer|record|history|audit)\b/i,
    order: 6,
  },
  {
    name: "Exigo",
    role: "MLM back office holding orders and auto-orders.",
    status: "No change",
    change: "Read through the existing order services only.",
    kind: "external",
    match: /\b(auto-?order|subscription|reorder|order history)\b/i,
    order: 7,
  },
  {
    name: "Messaging provider (email/SMS)",
    role: "Sends customer email and SMS. The provider is not named in any source.",
    status: "Proposed",
    change: "New templates and sends; opt-out keywords handled by the provider.",
    kind: "external",
    match: /\b(sms|email|text message|notification|remind|reminder|message)\b/i,
    order: 8,
  },
  {
    name: "Auth0 terms gate",
    role: "Auth0 post-login action that presents outstanding agreements and records acceptance [M Glossary].",
    status: "Proposed",
    change: "Extended to present the new prompt; no new dependency in the login path beyond the existing post-login-context call.",
    kind: "identity",
    match: /\b(login|log in|sign[- ]?in|auth0|terms gate|re-?accept|prompt)\b/i,
    order: 9,
  },
  {
    name: "Okta",
    role: "Authentication for internal apps; the access-control point for the internal audience [M Systems and services].",
    status: "No change",
    change: "No change beyond group or role assignment for the intended audience.",
    kind: "identity",
    match: /\b(legal|compliance|internal|customer service|portal|restrict)\b/i,
    order: 10,
  },
  {
    name: "Contentful",
    role: "Source of truth for agreement and policy content and versions [M Systems and services].",
    status: "No change",
    change: "Content authoring is unchanged.",
    kind: "external",
    match: /\b(agreement|policy|content|copy|template|version)\b/i,
    order: 11,
  },
  {
    name: "reports-service-v3",
    role: "Being decommissioned under CP-51485 [M Standing decisions and constraints].",
    status: "Explicitly not used",
    change: "No new dependency on the service being shut down.",
    kind: "other",
    match: /\b(report|reporting|analytics|dashboard|export)\b/i,
    order: 12,
  },
  {
    name: "LaunchDarkly",
    role: "Platform mechanism for gating a new surface without a deploy [M Integration conventions].",
    status: "Proposed",
    change: "One flag gating the new surface, defaulted off.",
    kind: "flag",
    match: /./,
    order: 13,
  },
];

function pickSystems(text: string): AadSystem[] {
  const picked = LIBRARY.filter((s) => s.match.test(text));
  const hosts = picked.filter((s) => s.kind === "host");
  if (hosts.length === 0) picked.unshift(LIBRARY[0]!);
  const withoutPortalOkta = picked.some((s) => s.name === "website-customer-portal") ? picked : picked.filter((s) => s.name !== "Okta");
  return withoutPortalOkta
    .sort((a, b) => a.order - b.order)
    .map((s) => ({ name: s.name, role: s.role, status: s.status, change: s.change, kind: s.kind }));
}

function designFor(text: string, sys: { host: string; customerHost?: string; service: string; db?: string; messaging?: string; identity?: string }): string {
  // A customer-facing need lands on the customer-facing host when the design has one.
  const host = sys.customerHost && /\b(my account|customers? can|customers? see|shopper)\b/i.test(text) ? sys.customerHost : sys.host;
  if (/\b(restrict|access|role|permission|audience)\b/i.test(text)) return `${sys.identity ?? "SSO"} sign-in plus a role check on ${host} ([Security](#security))`;
  if (/\b(filter|segment|search|look ?up)\b/i.test(text)) return `Filter parameters on the ${sys.service} endpoint`;
  if (/\b(send|notify|remind|email|sms|message)\b/i.test(text)) return `Scheduled job in ${sys.service} that sends through the ${sys.messaging ?? "messaging provider"}, applying the customer's stored preferences first`;
  if (/\b(export|download|csv)\b/i.test(text)) return `Streaming export endpoint on ${sys.service}, one audit entry per request`;
  if (/\b(snooze|turn off|opt|preference)\b/i.test(text)) return `Preference stored per customer by ${sys.service} and read before every send`;
  if (/\b(record|audit|history|evidence|capture|consent)\b/i.test(text)) return `Append-only records in ${sys.db ?? "the service database"} written by ${sys.service}`;
  if (/\b(show|view|see|list|display|report)\b/i.test(text)) return `${host} view reading a new read-only ${sys.service} endpoint`;
  return `${sys.service} logic behind ${host} (proposed)`;
}

export type AadOverrides = Partial<AadSpec> & {
  report?: Partial<AadReportSpec>;
  extraQuestions?: QuestionSpec[];
  /** Design element per BRD requirement number, replacing the derived one. */
  designs?: Record<number, string>;
};

function specOverrides(o: AadOverrides): Partial<AadSpec> {
  const copy: AadOverrides = { ...o };
  delete copy.report;
  delete copy.extraQuestions;
  delete copy.designs;
  return copy;
}

/** An AAD for any accepted BRD, optionally shaped by a pack's overrides. */
export function genericAad(ctx: DraftContext, overrides: AadOverrides = {}): DocResult<AadReport> {
  const cites = new Cites(ctx);
  const brd = ctx.brd?.content ?? "";
  const noteText = ctx.notes.map((n) => n.content).join("\n");
  const title = overrides.title ?? (docTitle(brd) || titleFor(ctx));
  const brs = brdRequirements(brd);
  const allText = `${brd}\n${noteText}`;
  const systems = overrides.systems ?? pickSystems(allText);
  const host = systems.find((s) => systemKind(s) === "host")?.name ?? "the host app";
  const customerHost = systems.find((s) => systemKind(s) === "host" && /my account|website|ecom/i.test(s.name) && s.name !== host)?.name;
  const service = systems.find((s) => systemKind(s) === "service")?.name ?? host;
  const db = systems.find((s) => systemKind(s) === "db")?.name;
  const messaging = systems.find((s) => /messaging/i.test(s.name))?.name;
  const identity = systems.find((s) => systemKind(s) === "identity")?.name;
  const brdQuestions = openQuestions(brd);
  const metrics = numberedItems(sectionBody(brd, "Success Metrics") ?? "");
  const brdOut = bulletItems(sectionBody(brd, "Out of Scope") ?? "");
  const a1 = ctx.notes[0]?.id;

  const frs: AadFrSpec[] =
    overrides.frs ??
    (brs.length > 0
      ? brs.map((r) => {
          const text = stripCites(r.text.replace(/\(Candidate\)\s*/i, ""));
          return r.candidate
            ? { br: r.n, text, candidate: true, design: `Not designed in this draft; pending the PO's confirmation of BRD requirement ${r.n}` }
            : { br: r.n, text, design: overrides.designs?.[r.n] ?? designFor(text, { host, customerHost, service, db, messaging, identity }) };
        })
      : [{ br: null, text: `The ${title} capability described by the architect's request`, design: `${service} behind ${host} (proposed)` }]);

  // Carry the BRD's scope questions forward; add the design questions every AAD of this shape has.
  const carried: QuestionSpec[] = brdQuestions
    .filter((q) => /scope|overlap|in or out|population|which/i.test(q.text))
    .slice(0, 2)
    .map((q) => ({ text: `${stripCites(q.text).replace(/\.$/, "")} [B1 ${q.id}]`, who: q.who || "PO", blocking: true }));
  const hasAccess = brs.some((r) => /restrict|access|audience|role/i.test(r.text));
  const questions: QuestionSpec[] = overrides.questions ?? [
    ...carried,
    ...(hasAccess ? [{ text: "What access control gates the new surface — which group or role, and who administers it? No source states it.", who: "Security Engineering / Engineering", blocking: true }] : []),
    { text: `Which service owns the new endpoint — ${service}, as the domain-ownership convention suggests [M Integration conventions], or another?`, who: "Architect" },
    { text: "What volume and data freshness are expected? No source states a peak load or a freshness window.", who: "PO / Engineering", blocking: carried.length + (hasAccess ? 1 : 0) < 2 },
    { text: "Which feature flag gates the new surface: a new flag, or an existing one?", who: "Engineering" },
    { text: "Which environment holds representative data for meaningful testing?", who: "QA / Data Engineering" },
    ...(messaging ? [{ text: "Which messaging provider sends the messages, and does it handle opt-out keywords itself?", who: "Engineering / Marketing", blocking: true }] : []),
    ...(overrides.extraQuestions ?? []),
  ];

  const memSystems = ctx.memory.content.split("\n").filter((l) => /^- \*\*[^*]+\*\*/.test(l));
  const existing = overrides.existing ?? [
    ...memSystems
      .filter((l) => systems.some((s) => l.toLowerCase().includes(s.name.toLowerCase().split(" ")[0] ?? "")))
      .slice(0, 5)
      .map((l) => `${l.replace(/^- /, "").replace(/\s*\[`[^`]+`\]\s*$/, "")} [M Systems and services]`),
    ...ctx.evidence.filter((e) => /done/i.test(e.text.split("\n").find((l) => l.startsWith("STATUS ")) ?? "")).slice(0, 3).map((e) => `${e.ref} "${e.title}" is delivered [${e.id}].`),
  ];
  if (existing.length === 0) existing.push("No source describes the affected flows as they work today. See Open Questions.");

  const reporting = /\b(report|analytics|dashboard|export)\b/i.test(allText);
  const decisions = overrides.report?.decisionsNeeded ?? [
    `Hosting surface: confirm ${host} as the host for the new capability${a1 ? `, as the architect's request suggests [${a1}]` : ""}.`,
    `Owning service: ${service}, which owns the domain SQL per the recorded convention [M Integration conventions], or a new component.`,
    ...(reporting ? ["Data source for aggregate figures: direct retrieval from the production database versus the BI Platform; freshness against production load."] : []),
    ...(messaging ? ["Messaging provider and whether reminders count as transactional or marketing messages for opt-out purposes."] : []),
    "Feature flag: reuse an existing flag or create a new one for this surface.",
  ];

  const spec: AadSpec = {
    title,
    revisionPurpose: `Initial draft assembled from the accepted BRD [B1]${ctx.notes.length > 0 ? `, architect notes [${ctx.notes.map((n) => n.id).join(", ")}]` : ""}${ctx.evidence.length > 0 ? `, and the confirmed references ${ctx.evidence.length > 1 ? `${ctx.evidence[0]!.id}–${ctx.evidence[ctx.evidence.length - 1]!.id}` : ctx.evidence[0]!.id}` : ""}.`,
    scope: [`This document describes the architecture approach for ${title}: where the capability lives, which services own it, and what must be added to meet the BRD requirements [B1 §Requirements].`],
    successCriteria: metrics.length > 0 ? metrics.map((m, i) => `${stripCites(m.replace(/^\(Candidate\)\s*/i, ""))} [B1 §Success Metrics ${i + 1}]`) : ["None stated: the BRD has no success metrics yet [B1 §Success Metrics]."],
    inScope: [
      ...frs.filter((f) => !f.candidate && f.br !== null).slice(0, 4).map((f) => `${f.text} [B1 §Requirements ${f.br}]`),
      `Rollout behind a feature flag on ${host}.`,
    ],
    problem: [
      `${stripCites((sectionBody(brd, "Problem to be Solved") ?? "").split("\n\n")[0] ?? "") || `The BRD asks for ${title}.`} [B1 §Problem to be Solved]`,
      `In technical terms: ${frs.filter((f) => !f.candidate).length} functional requirements need a surface on ${host}, an owning service (${service}), and ${db ? `read-only access to ${db}` : "a data source"}; none of this exists today as one flow.`,
    ],
    systems,
    existing,
    frs,
    failure: [
      "If the owning service fails or times out, the surface shows an explicit error state and no partial data.",
      "A failed write is retried by the service and never reported to the user as done.",
      "Nothing on this path can block login or checkout.",
    ],
    nfrs: [
      { name: "Security", text: `Access is authenticated through the existing SSO and restricted to the intended audience; backend calls follow Istio mTLS with deny-by-default authorization and secrets in AWS Secrets Manager [M Integration conventions].` },
      { name: "Production database load", text: "Queries are bounded, indexed and set-based; no per-customer fan-out [M Standing decisions and constraints]." },
      { name: "Availability", text: "The new path is isolated from the login path and must not degrade it [M Standing decisions and constraints]." },
      { name: "Data integrity", text: "The same request at the same as-of time returns the same result; records are append-only where the BRD asks for evidence." },
      { name: "Rollout safety", text: "The surface is gated by a LaunchDarkly flag so it can be disabled without a deploy [M Integration conventions]." },
      ...(reporting ? [{ name: "Platform direction", text: "No new dependency on reports-service-v3, which is being decommissioned [M Standing decisions and constraints]." }] : []),
    ],
    assumptions: [
      `${service} can own the new endpoint without a schema change; to be confirmed with Data Engineering.`,
      "The intended audience can be expressed as an existing SSO group or role.",
      "The BRD's candidate requirements stay out of this design until the PO confirms them.",
    ],
    prerequisites: ["The BRD is accepted [B1].", "The api-contracts spec for the new endpoint is published before the service deploys [M Integration conventions].", "The feature flag exists in every environment, defaulted off."],
    logical: [
      `${host} presents the capability to its users. It calls a new endpoint on ${service}${systems.some((s) => systemKind(s) === "gateway") ? " through api-gateway, which authenticates and forwards only" : ""}. ${service} owns the logic${db ? ` and reads ${db}` : ""}.${messaging ? ` Outbound messages go through the ${messaging}.` : ""}`,
    ],
    process: [
      { name: `Use ${title}`, steps: [`The user opens the new surface on ${host}.`, `${host} calls the ${service} endpoint with the user's token.`, `${service} checks the role, runs the bounded query and returns the result with its as-of time.`, `${host} renders the result, or an explicit error state.`] },
    ],
    delivery: [
      "Publish the api-contracts spec for the new endpoint.",
      "Create the LaunchDarkly flag for the new surface, defaulted off.",
      "Promote any database change DEV → TEST → STAGE → PROD ahead of the service.",
      `Deploy ${service} with the endpoint unused.`,
      `Deploy ${host} with the flag off; enable it for an internal test group.`,
      "Verify the results against a manual check before widening the flag.",
      "Enable in PROD for the intended audience. Rollback: turn the flag off.",
    ],
    compliance: [
      ...(/\b(legal|consent|privacy|tcpa|litigation|agreement)\b/i.test(allText) ? ["Legal owns the rules the design must follow; any record used in a dispute must be complete and reproducible [B1]."] : []),
      "Personal data is shown only to the intended audience and never written to access logs.",
    ],
    outOfScope: [...brdOut.slice(0, 5).map((o) => `${stripCites(o)} [B1 §Out of Scope]`), "Low-level design and ticket breakdown."],
    questions,
    actor: /\b(legal|compliance|internal|agent)\b/i.test(allText) ? "Internal user" : "Customer",
    ...specOverrides(overrides),
  };

  const words = keywords(allText, 3).join(", ");
  return draftAad(
    spec,
    {
      decisionsNeeded: decisions,
      conflicts: overrides.report?.conflicts ?? [
        ...(reporting ? ["Freshness versus load: an on-demand view reads production data the Data team wants to protect [M Standing decisions and constraints]; recorded as a decision, not resolved."] : []),
        ...ctx.memory.stale.map((s) => `The shared memory entry ${s} may be out of date [M].`),
      ],
      ignoredInstructions: overrides.report?.ignoredInstructions ?? [
        "No Jira or Confluence write was made, no document was published, and no approval was recorded.",
      ],
      changes: overrides.report?.changes ?? [
        `Created ${ctx.out} as a first draft with all template sections in order, plus Open Questions and Sources appendices.`,
        `System Overview built from the shared memory and the BRD's wording (${words}); ${systems.filter((s) => /^proposed/i.test(s.status)).length} systems marked proposed.`,
        `Functional requirements traced one-to-one to BRD requirements${brs.some((r) => r.candidate) ? "; candidate requirements carried but not designed" : ""}.`,
        "High-Level Architecture Mermaid flowchart plus a change table covering every system in the System Overview; sequence diagrams with failure branches.",
        `${spec.questions.length} open questions recorded, ${spec.questions.filter((q) => q.blocking).length} marked blocking.`,
      ],
      untraced: overrides.report?.untraced,
    },
    cites,
    ctx.out,
  );
}
