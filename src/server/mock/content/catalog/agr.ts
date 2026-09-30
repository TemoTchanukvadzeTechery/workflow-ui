import "server-only";
/**
 * Jira and Confluence items behind the AGR (Ambassador Agreement Acceptance Reporting) fixture.
 * Titles, relations and "why" texts come from the real runs' dependency lists (agr-fixture.json);
 * types, statuses and hierarchy are as those lists describe them; descriptions are short
 * summaries written for the mock, not copies of the tickets.
 */
import { agrFixture } from "../agr-fixture";
import type { CatalogItem } from "./types";

type Meta = Omit<CatalogItem, "ref" | "kind" | "title"> & { title?: string };

const META: Record<string, Meta> = {
  "CP-50894": {
    type: "Epic",
    status: "In Progress",
    parent: "PLAN-358",
    labels: ["Legal", "Data"],
    description:
      "Purpose & Value\nLegal and Compliance need on-demand visibility into agreement acceptance status, by ambassador and by agreement version, instead of asking Engineering for a data pull.\nBranch: feature-CP-50894-amb-agreement-phase-2\nLD Flag: ambassador-upgrade-agreements-enabled",
    keywords: ["acceptance reporting", "legal", "compliance", "agreement"],
    modified: "2026-09-15",
  },
  "CP-50909": {
    type: "Story",
    status: "Backlog",
    parent: "CP-50894",
    labels: ["Auth0", "Data", "Legal"],
    links: [{ type: "depends on", ref: "CP-51264" }],
    description:
      "As a member of Legal/Compliance I want to retrieve acceptance status across all ambassadors, filterable by agreement and version, so that I can assess coverage toward the 100% acceptance goal without a data pull request.\nAcceptance Criteria\n- Retrieve on demand for a given agreement and version\n- Includes at minimum ambassador ID, name, acceptance status and version accepted",
    keywords: ["acceptance status", "coverage", "ambassador base"],
    modified: "2026-09-10",
  },
  "CP-50908": {
    type: "Story",
    status: "Backlog",
    parent: "CP-50894",
    labels: ["Auth0", "Data", "Legal"],
    links: [{ type: "relates to", ref: "CP-51709" }],
    description:
      "As a member of Legal/Compliance I want to look up a specific ambassador by Customer ID or name and see which version of the Brand Ambassador Agreement, Policies & Procedures and Privacy Policy they accepted and when, so that I can confirm it during a dispute or escalation. Flag when the current version has not been accepted.",
    keywords: ["individual lookup", "acceptance status", "ambassador"],
    modified: "2026-09-10",
    assignee: "Nikoloz Gabunia",
  },
  "CP-51264": {
    type: "Spike",
    status: "Done",
    parent: "CP-50894",
    labels: ["Auth0", "Data", "Legal", "done"],
    links: [
      { type: "clones", ref: "CP-50908" },
      { type: "is depended on by", ref: "CP-50909" },
    ],
    description: "Spike for the Phase 2 lookup and coverage stories. Findings are written up on Confluence page 5454659585.",
    keywords: ["spike", "acceptance status", "lookup"],
    modified: "2026-08-28",
  },
  "CP-50891": {
    type: "Epic",
    status: "Done",
    parent: "PLAN-818",
    description:
      "Capture and store evidence of each acceptance event (identity, action, timestamp, IP address, device) so the record is defensible at full ambassador-base scale.",
    keywords: ["evidence", "audit", "acceptance"],
  },
  "CP-50889": {
    type: "Epic",
    status: "Done",
    parent: "PLAN-818",
    links: [
      { type: "is depended on by", ref: "DATA-3141" },
      { type: "relates to", ref: "DATA-3142" },
      { type: "relates to", ref: "DV-5907" },
    ],
    description:
      "Require ambassadors to review and actively accept the current Brand Ambassador Agreement, Policies & Procedures and Privacy Policy right after login, on any device, in English or Spanish.",
    keywords: ["ambassador agreement", "acceptance", "login", "terms gate"],
  },
  "CP-50893": {
    type: "Epic",
    status: "Done",
    parent: "PLAN-818",
    description: "Version agreements and trigger re-acceptance when a new version is published.",
    keywords: ["versioning", "re-acceptance", "agreement"],
  },
  "PLAN-818": {
    type: "Project",
    status: "Done",
    description: "Ambassador agreement compliance programme: capture a defensible, current record of consent from the ambassador base to reduce litigation exposure.",
    keywords: ["ambassador agreement", "compliance"],
  },
  "PLAN-358": {
    type: "Project",
    status: "Development",
    description: "Quarterly bucket for defects, general tasks and smaller changes to the shopping experience in 2026 Q3.",
  },
  "PLAN-577": {
    type: "Project",
    status: "Intake",
    description: "Quarterly bucket for defects, general tasks and smaller changes to the shopping experience in 2026 Q4.",
  },
  "CP-50892": {
    type: "Epic",
    status: "Done",
    parent: "PLAN-818",
    description: "Prevent internal (ARC) logins from accepting agreements on an ambassador's behalf.",
    keywords: ["arc login", "acceptance"],
  },
  "CP-50890": {
    type: "Epic",
    status: "Done",
    parent: "PLAN-818",
    description: "QA for enforcing site access until the ambassador accepts the current agreements.",
    keywords: ["enforcement", "acceptance"],
  },
  "CP-51347": {
    type: "Epic",
    status: "Done",
    description: "Follow-up adjustments to the agreement gate copy and Help Center links after Phase 1.",
    keywords: ["ambassador agreement", "terms gate"],
  },
  "CP-50416": {
    type: "Epic",
    status: "Done",
    description:
      "Research into capturing consent to the BA Agreement and P&P. Scoped to US Ambassadors; VIP and Retail were raised and excluded. Notes a 30-day written opt-out after publication.",
    keywords: ["consent", "research", "agreement"],
  },
  "CP-51485": {
    type: "Epic",
    status: "In Progress",
    description: "Disable and then delete reports-service-v3. reporting-service now serves the Virtual Office reports.",
    keywords: ["reports-service-v3", "reporting-service", "decommission", "reporting"],
  },
  "CP-51709": {
    type: "Epic",
    status: "To Do",
    parent: "PLAN-577",
    links: [{ type: "relates to", ref: "CP-50894" }],
    description: "Epic for looking up an individual ambassador's agreement acceptance status.",
    keywords: ["acceptance status", "lookup"],
  },
  "CP-51441": {
    type: "Story",
    status: "PO Review",
    parent: "CP-51485",
    description:
      "Remove the reports-service-v3 client from website-backoffice-v3 and move its routes to reportingServiceApi (/api/v1/report-builder/...). Authorization stays in the app (validateCustomerDownline) because reporting-service cannot know the caller.",
    keywords: ["reporting-service", "reports-service-v3", "backoffice"],
  },
  "DATA-3141": {
    type: "Task",
    status: "Done",
    description: "Create and alter CustomerAgreementType and CustomerAgreement tables in ThatOtherGuy for re-acceptance on login; promote TEST, STAGE, PROD.",
    keywords: ["customeragreement", "schema"],
  },
  "DATA-3142": {
    type: "Task",
    status: "Done",
    description: "Read the current CustomerAgreementType values in PROD to configure the Contentful model.",
    keywords: ["customeragreementtype"],
  },
  "DV-5907": {
    type: "Task",
    status: "Done",
    description:
      "Create customerflow.auth0.agreement.accepted.v1 (3 partitions) and its .dlt topic in PROD MSK; api-gateway produces, customer-service-v2 consumes, least-privilege IAM.",
    keywords: ["kafka", "customerflow.auth0.agreement.accepted"],
  },
  "CP-51265": {
    type: "Bug",
    status: "In Progress",
    description: "D2A enrollment creates a second set of CustomerAgreementTypeIDs for the same three agreements, so D2A users are asked to sign twice.",
    keywords: ["d2a", "duplicate", "agreement"],
  },
  "CP-51058": {
    type: "Bug",
    status: "Won't Do",
    description: "Agreements scoped to Arizona were applied to customers outside Arizona.",
    keywords: ["arizona", "agreement", "state"],
  },
  "5454659585": {
    type: "page",
    space: "SD",
    description:
      "Findings of spike CP-51264. Individual customer agreements: reuse CustomerAgreementGet_v2 and the outstanding-agreements endpoint; a PoC adds the sections to customer-portal (pull request 275). Overall agreement progress: must be built from scratch. Options: direct retrieval from ThatOtherGuy and PlexusSync (real time, adds PROD load) or the BI Platform (daily, no PROD load, another team).",
    keywords: ["spike", "customer agreements", "progress", "customer portal"],
  },
  "5302779911": {
    type: "page",
    space: "SE",
    description: "Architecture approach for the Auth0 post-login agreement gate: terms-gate.js, api-gateway, Kafka acceptance topic, customer-service-v2 consumer, Contentful-driven agreement definitions.",
    keywords: ["architecture approach", "terms gate", "customeragreement", "post-login"],
  },
  "5329387522": {
    type: "page",
    space: "SD",
    description: "Decision: provisioning of agreement definitions from Contentful is a synchronous HTTP webhook; clickwrap acceptance events go over Kafka. api-gateway authenticates and forwards; the domain service owns the SQL.",
    keywords: ["decision record", "kafka", "contentful", "clickwrap"],
  },
  "5289967628": { type: "page", space: "SD", description: "Parent page for proposals A-D for the T&C post-login gate, with the chosen approach.", keywords: ["terms gate", "proposals", "agreement acceptance"] },
  "5318967303": { type: "page", space: "SD", description: "Proposal D: Auth0 Forms plus Contentful-driven agreements, delivered by webhook and CDN fetch.", keywords: ["proposal", "contentful", "auth0"] },
  "5289672706": { type: "page", space: "SD", description: "Proposal A: Auth0 Forms plus a Contentful webhook, full end-to-end design.", keywords: ["proposal", "auth0", "clickwrap"] },
  "5289443332": { type: "page", space: "SD", description: "Proposal C: the consent UI as a monoreact page, same Contentful webhook lifecycle.", keywords: ["proposal", "monoreact"] },
  "5289836547": { type: "page", space: "SD", description: "Proposal B: Auth0 Forms with versions managed by hand in Terraform (POC).", keywords: ["proposal", "terraform"] },
  "5433360403": { type: "page", space: "REL", description: "Release record for PLAN-818: database configuration, Kafka topics, environment variables, rollout and rollback steps.", keywords: ["release", "ambassador data tracking", "clickwrap"] },
  "5432049666": { type: "page", space: "CMS", description: "How Legal and Content Management add a Login Agreement Consent Form in Contentful, and how publishing provisions it.", keywords: ["contentful", "consent form", "agreement"] },
  "5490999297": { type: "page", space: "AR", description: "Implementation plan for keeping website-customer-portal alive (CP-51569): Node 22 + Angular 21, SSR disabled, Snyk remediation under CP-51568.", keywords: ["customer portal", "website-customer-portal"] },
  "4834295809": { type: "page", space: "AR", description: "Decision record: customer-portal disables server-side rendering.", keywords: ["customer portal", "ssr", "decision record"] },
  "4772069402": { type: "page", space: "AR", description: "Decision record: direction for renovating customer-portal.", keywords: ["customer portal", "decision record"] },
  "4834066514": { type: "page", space: "AR", description: "Decision record: customer-portal builds with webpack.", keywords: ["customer portal", "webpack"] },
  "4757061657": { type: "page", space: "ENG", description: "Steps to migrate from reports-service-v3-client to the reporting-service client.", keywords: ["reporting-service", "reporting", "migration"] },
  "4877025299": { type: "page", space: "ENG", description: "Status of each report's move from reports-service-v3 to reporting-service.", keywords: ["reporting-service", "reports-service-v3", "reporting"] },
  "5193105409": { type: "page", space: "AR", description: "Architecture approach for migrating the Node customer-service to Java Spring Boot: layered services, api-contracts, Istio, Micrometer to Dynatrace.", keywords: ["architecture approach", "customer-service", "spring boot"] },
};

/** AGR catalog entries, merging META with the titles and planner notes of the real runs. */
export function agrCatalog(): CatalogItem[] {
  const fx = agrFixture();
  const seen = new Map<string, { title: string; relation: string; why: string; kind: "jira" | "confluence" }>();
  for (const run of [fx.aad, fx.brd]) {
    const last = run.rounds[run.rounds.length - 1];
    for (const d of last?.relevant ?? []) if (!seen.has(d.ref)) seen.set(d.ref, d);
  }
  return Object.entries(META).map(([ref, meta]) => {
    const dep = seen.get(ref);
    return {
      ref,
      kind: dep?.kind ?? (/^\d+$/.test(ref) ? "confluence" : "jira"),
      title: meta.title ?? dep?.title ?? ref,
      relation: dep?.relation,
      why: dep?.why,
      modified: meta.modified ?? "2026-09-01",
      ...meta,
    };
  });
}
