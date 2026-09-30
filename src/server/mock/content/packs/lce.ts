import "server-only";
/**
 * LCE, Legal & Compliance Reporting Export: CSV export from the Agreement Progress page. Its
 * record-level export moves into scope what the AGR BRD left as candidate requirement 8, so the
 * memory proposal names that BRD under "Affects other documents".
 */
import { Cites } from "../doc/cites";
import { draftBrd, type BrdSpec } from "../doc/brd";
import { genericAad } from "../generic/aad";
import { brdMemory } from "../memory";
import type { ContentPack } from "./types";

const NOTE = "notes/compliance-export/legal-export-request.md";

function spec(n: string): BrdSpec {
  return {
    title: "Legal & Compliance Reporting Export",
    lead: [
      `Not yet provided. Legal/Compliance asked for the export [${n} L3] and is the consuming group [M Stakeholders and teams]; no business stakeholder or Product Manager is named. See Open Questions Q4.`,
    ],
    problem: [
      `Legal/Compliance can see acceptance coverage on the Agreement Progress page, but cannot take it with them: the quarterly board pack and litigation holds need the figures and the list behind them as a file [${n} L4, ${n} L6, {N:request}]. Today that list is a data pull request to Engineering [{R:CP-50909}].`,
      `Customer tie-back: litigation holds concern individual ambassadors; a complete, traceable list protects both the ambassador and the company in a dispute [${n} L6, {R:CP-50891}].`,
    ],
    solution: [
      `An "Export CSV" action on the Agreement Progress page that exports what the user is looking at — the filtered figures, or the list behind them — with the as-of date in the file name [${n} L3, ${n} L4, ${n} L8].`,
      "Exports stay inside the data classification standard: no email distribution, logged per export [{R:5501234567}, " + n + " L10].",
    ],
    requirements: [
      { text: `Legal/Compliance can export the figures shown on the Agreement Progress page to CSV, for the filters currently applied [${n} L3, ${n} L4].` },
      { text: `Legal/Compliance can export the list behind the figures — ambassador ID, name, acceptance status, version accepted — to CSV [${n} L4, {R:CP-50909}].` },
      { text: `An export of the full ambassador base, 50,000 rows or more, completes without failing [${n} L5].` },
      { text: `Every export records who exported, when, and with which filters [${n} L7, {R:5501234567}].` },
      { text: `The file name and first rows show the as-of date and the filters used [${n} L8].` },
      { text: `Only Legal/Compliance can export [{R:5501234567}, M Standing decisions and constraints].` },
      { text: `(Candidate) Column headers in Spanish for the es-US market [${n} L9].`, candidate: true },
    ],
    metrics: {
      intro: "Candidates only; validate with BI (template contact: Thomas Hamilton).",
      items: [
        "(Candidate) Data pull requests to Engineering for acceptance lists, per quarter — expected to fall to zero [{R:CP-50909}]. Baseline not provided.",
        `(Candidate) Time to assemble the quarterly board pack's acceptance section [${n} L6]. Baseline not provided.`,
      ],
    },
    outOfScope: [
      `Emailing or scheduling exports [${n} L10, {R:5501234567}].`,
      "Formats other than CSV (XLSX, PDF).",
      "Changing the figures or the Agreement Progress page itself — covered by the registered BRD \"Ambassador Agreement Acceptance Reporting\" [M Document register].",
      "Technical solution design and ticket breakdown.",
    ],
    questions: [
      { text: "Does exporting the record-level list settle Q3 of the registered BRD \"Ambassador Agreement Acceptance Reporting\", which left that list as a candidate [M Document register]?", who: "PO / Legal", blocking: true },
      { text: "What retention period applies to exported files [{R:LEGAL-81}, {R:5501234567}]?", who: "Legal", blocking: true },
      { text: `Must an export of 50,000+ rows finish within the 30-second api-gateway limit [{R:DV-6120}], or may it be delivered asynchronously [${n} L5]?`, who: "PO / Engineering", blocking: true },
      { text: "Who is the business stakeholder and who is the Product Manager?", who: "PO" },
      { text: `Are Spanish headers needed at launch, and for which market [${n} L9]?`, who: "PO" },
    ],
    planIntro: "Status and dates only where the sources provide them. No source provides any.",
  };
}

export const lcePack: ContentPack = {
  id: "compliance-export",
  key: "LCE",
  title: "Legal & Compliance Reporting Export",
  brd: (ctx) => {
    const cites = new Cites(ctx);
    const n = cites.note(NOTE);
    return draftBrd(
      spec(n),
      {
        conflicts: [
          "Record-level export (requirement 2) moves into scope data the registered AGR BRD kept as a candidate (its requirement 8, Q3) [M Document register]. Flagged as Q1; the memory update will name that BRD as affected.",
          `Size versus gateway limit: 50,000+ rows [${n} L5] against the 30-second api-gateway timeout [{R:DV-6120}].`,
        ],
        ignoredInstructions: ["No file was sent, published, or shared; no ticket or memory update was written."],
        changes: [
          `Created ${ctx.out} as a first draft from the request, ${n}, the confirmed references and the shared memory M.`,
          "Requirements 1-6 written from the Legal request; Spanish headers held back as candidate 7.",
          "Three blocking questions recorded: the AGR BRD's Q3, retention, and the gateway limit.",
        ],
      },
      cites,
      ctx.out,
    );
  },
  aad: (ctx) =>
    genericAad(ctx, {
      systems: [
        { name: "website-customer-portal", role: "Hosts the Agreement Progress page [M Systems and services].", status: "Proposed", change: "\"Export CSV\" button on Agreement Progress, hidden for non-Legal users; download handling for streamed files.", kind: "host" },
        { name: "api-gateway", role: "Existing edge; authenticates and forwards; 30-second upstream timeout [{R:DV-6120}].", status: "Proposed", change: "Route for the export endpoint with streaming passthrough; the 30-second limit applies to time-to-first-byte only (to confirm).", kind: "gateway" },
        { name: "customer-service-v2", role: "Owns the agreement domain SQL and the coverage endpoint [M Systems and services].", status: "Proposed", change: "Streaming CSV export endpoint next to the coverage endpoint, keyset-paginated reads, one audit entry per export.", kind: "service" },
        { name: "ThatOtherGuy database", role: "Holds the acceptance record [M Systems and services].", status: "Proposed, read-only", change: "Keyset-paginated reads over CustomerAgreement; no schema change.", kind: "db" },
        { name: "Export audit log", role: "Append-only record of who exported what and when.", status: "Proposed", change: "New ExportAudit table owned by customer-service-v2 (proposed).", kind: "db" },
        { name: "LaunchDarkly", role: "Gates new surfaces without a deploy [M Integration conventions].", status: "Proposed", change: "Flag for the export button, defaulted off.", kind: "flag" },
        { name: "reports-service-v3", role: "Being decommissioned [M Standing decisions and constraints].", status: "Explicitly not used", change: "No export path through the service being shut down.", kind: "other" },
      ],
      designs: {
        1: "GET coverage export on customer-service-v2 with the page's filters, CSV",
        2: "Streaming list export on customer-service-v2, keyset pagination over CustomerAgreement",
        3: "Chunked streaming; rows written as read, first byte well inside the 30-second limit [{R:DV-6120}]",
        4: "ExportAudit row per export: user, time, filters, row count (proposed)",
        5: "File name agreement-coverage-<as-of>.csv and a header row with the filters",
        6: "Okta group check on the button and the endpoint ([Security](#security))",
      },
      questions: [
        { text: "Can the gateway stream a response longer than 30 seconds, or must large exports become an asynchronous job with a download link [{R:DV-6120}, B1 Q3]?", who: "DevOps / Engineering", blocking: true },
        { text: "What retention applies to exported files and to ExportAudit rows [B1 Q2, {R:LEGAL-81}]?", who: "Legal", blocking: true },
        { text: "Which locale decides the CSV header language, and is es-US needed at launch [B1 Q5]?", who: "PO", blocking: true },
        { text: "Is there a hard row cap per export?", who: "PO / Data Engineering" },
        { text: "Which environment has a full-size ambassador base for load testing the export?", who: "QA / Data Engineering" },
      ],
      report: {
        decisionsNeeded: [
          "Streaming download versus asynchronous export job for large lists.",
          "Where export audit entries live: a new ExportAudit table in customer-service-v2 or the existing evidence store.",
          "Row cap per export, if any.",
          "CSV dialect: UTF-8 with BOM for Excel users, or plain UTF-8.",
        ],
      },
    }),
  memory: {
    BRD: (opts) => ({
      ...brdMemory(opts),
      affectsOtherDocuments: ["Ambassador Agreement Acceptance Reporting (BRD): its candidate requirement 8, the record-level list, is moved into scope by this BRD's requirement 2."],
    }),
  },
  discovery: {
    BRD: {
      rounds: [
        {
          queries: [
            { purpose: "Find the export epic and stories", args: ["jira", "issue", "list", 'project = CP AND text ~ "export" ORDER BY created DESC', "--limit", "25"] },
            { purpose: "Find the data classification rules for exports", args: ["confluence", "search", 'text ~ "data classification" AND text ~ "export"', "--limit", "10"] },
            { purpose: "Find gateway limits that constrain large downloads", args: ["jira", "issue", "list", 'project = DV AND text ~ "timeout" ORDER BY created DESC', "--limit", "25"] },
          ],
          relevant: ["CP-52190", "CP-50894", "CP-50909"],
        },
        {
          queries: [
            { purpose: "Read the data classification standard", args: ["confluence", "page", "get", "5501234567", "--body"] },
            { purpose: "Fetch the api-gateway timeout ticket", args: ["jira", "issue", "get", "DV-6120", "-o", "json"] },
            { purpose: "Fetch Legal's retention question", args: ["jira", "issue", "get", "LEGAL-81", "-o", "json"] },
          ],
          relevant: ["CP-52190", "CP-50894", "CP-50909", "5501234567", "DV-6120", "LEGAL-81", "CP-50891", "CP-51485"],
        },
      ],
    },
  },
};
