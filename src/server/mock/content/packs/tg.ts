import "server-only";
/**
 * TG, Agreement Acceptance at Login: the Phase 1 terms gate (PLAN-818), signed off 2026-09-02.
 * Its AAD describes the systems the shared memory already records (Auth0 terms gate,
 * api-gateway, the Kafka acceptance topic, customer-service-v2, ThatOtherGuy, Contentful).
 */
import { Cites } from "../doc/cites";
import { draftBrd, type BrdSpec } from "../doc/brd";
import { genericAad } from "../generic/aad";
import type { ContentPack } from "./types";

const NOTE = "notes/terms-gate/kickoff.md";

function spec(n: string): BrdSpec {
  return {
    title: "Agreement Acceptance at Login",
    lead: [`Legal is the business owner of the acceptance record [${n} L3, {R:PLAN-818}]. No Product Manager is named in the sources — see Q3.`],
    problem: [
      `Plexus has no defensible record that its ambassadors accepted the current Brand Ambassador Agreement, Policies & Procedures and Privacy Policy after enrollment [${n} L3, {R:CP-50889}]. Rising PAGA and class-action suits against direct sellers make the gap urgent [${n} L4, {R:PLAN-818}].`,
      "Customer tie-back: ambassadors are asked once, at login, on any device and in their language; the record then protects them and the company in a dispute [" + n + " L5].",
    ],
    solution: [
      `Right after login, ambassadors review and accept the current agreements before they can use the site [${n} L5, ${n} L6]. Each acceptance is recorded with the version, time, IP address and device [${n} L7, {R:CP-50891}], and a new version triggers re-acceptance [${n} L9, {R:CP-50893}].`,
    ],
    requirements: [
      { text: `Ambassadors review and accept the current Brand Ambassador Agreement, Policies & Procedures and Privacy Policy right after login [${n} L3, ${n} L5, {R:CP-50889}].` },
      { text: `The acceptance works on any device, in English and Spanish [${n} L5].` },
      { text: `Until they accept, ambassadors cannot use the site [${n} L6, {R:CP-50890}].` },
      { text: `Each acceptance records who accepted which version, when, and from which IP address and device [${n} L7, {R:CP-50891}].` },
      { text: `Internal (ARC) logins can never accept on an ambassador's behalf [${n} L8, {R:CP-50892}].` },
      { text: `Publishing a new version triggers re-acceptance automatically [${n} L9, {R:CP-50893}].` },
    ],
    metrics: {
      intro: "Candidates only; validate with BI (template contact: Thomas Hamilton).",
      items: ["(Candidate) Share of active US Ambassadors with an acceptance of the current version of all three agreements, against the 100% goal [{R:PLAN-818}]. Baseline: no record exists today.", "(Candidate) Login drop-off at the gate in the first 30 days. Baseline not provided."],
    },
    outOfScope: [`VIP and Retail customer types [${n} L10, {R:CP-50416}].`, "Reporting on acceptance coverage; a later phase.", "Changing the agreement texts; Legal supplies them.", "Technical solution design and ticket breakdown."],
    questions: [
      { text: `How is an ambassador who opts out in writing within 30 days recorded [{R:CP-50416}]?`, who: "Legal (Michael Ruppert)", blocking: true },
      { text: `Is "before the end of Q3 2026" [${n} L11] a committed date?`, who: "PO", blocking: true },
      { text: "Who is the Product Manager?", who: "PO" },
    ],
    planIntro: "Status and dates only where the sources provide them.",
    plan: ["Done. Ambassador email and VO news bulletin sent 2026-08-18.", "Done. Help Center article \"Accepting your agreements\" published 2026-08-20.", "Done. Customer Service trained 2026-08-21.", "Done. Pre-implementation kick-off 2026-05-12 [" + n + " L1].", "Done. Launch readiness meeting 2026-08-25."],
  };
}

export const tgPack: ContentPack = {
  id: "terms-gate",
  key: "TG",
  title: "Agreement Acceptance at Login",
  brd: (ctx) => {
    const cites = new Cites(ctx);
    const n = cites.note(NOTE);
    return draftBrd(
      spec(n),
      {
        conflicts: [],
        ignoredInstructions: ["No file was sent, published, or shared; no ticket or memory update was written."],
        changes: [`Created ${ctx.out} as a first draft from the request, ${n} and the confirmed references.`],
      },
      cites,
      ctx.out,
    );
  },
  aad: (ctx) =>
    genericAad(ctx, {
      actor: "Brand Ambassador",
      systems: [
        { name: "Auth0 terms gate", role: "Post-login action (terms-gate.js) with an Auth0 Form for the consent UI.", status: "Proposed", change: "New post-login action presenting outstanding agreements; blocks the session until acceptance.", kind: "identity" },
        { name: "api-gateway", role: "Edge for the Auth0 action and the Contentful webhook; authenticates and forwards.", status: "Proposed", change: "GET /v1/sso/post-login-context, POST /v1/agreements, POST /api/v1/webhooks/contentful; basic auth and IP allow-listing for the webhook.", kind: "gateway" },
        { name: "customer-service-v2", role: "Owns the agreement domain SQL.", status: "Proposed", change: "Provisioning from the webhook, the outstanding-agreements query, and the acceptance consumer.", kind: "service" },
        { name: "Kafka (customerflow.auth0.agreement.accepted.v1)", role: "Acceptance events from api-gateway to customer-service-v2 [{R:DV-5907}].", status: "Proposed", change: "New topic with 3 partitions plus a .dlt dead-letter topic; least-privilege IAM per service.", kind: "external" },
        { name: "ThatOtherGuy database", role: "Agreement and acceptance tables [{R:DATA-3141}].", status: "Proposed", change: "New CustomerAgreementType, CustomerAgreementRequirement and CustomerAgreement tables, promoted TEST → STAGE → PROD.", kind: "db" },
        { name: "Contentful", role: "Source of truth for agreement definitions and versions.", status: "Proposed", change: "Login Agreement Consent Form content type and publish webhook [{R:5432049666}].", kind: "external" },
        { name: "LaunchDarkly", role: "Gates new surfaces without a deploy.", status: "Proposed", change: "ambassador-upgrade-agreements-enabled, defaulted off.", kind: "flag" },
      ],
      designs: {
        1: "Auth0 post-login action calls post-login-context and shows the Auth0 Form with the outstanding agreements",
        2: "Auth0 Forms render on any device; English and Spanish content from Contentful",
        3: "The action denies the session until every outstanding agreement is accepted",
        4: "Acceptance event on customerflow.auth0.agreement.accepted.v1, consumed into a CustomerAgreement row with IP, user agent and geolocation",
        5: "The action skips the gate for ARC impersonation sessions and never records their acceptance",
        6: "Publishing a new version in Contentful provisions CustomerAgreementType and requirement rows; the outstanding query then returns it",
      },
      tradeoffs: [
        { title: "consent UI", body: ["Proposals A-D compared Auth0 Forms with a monoreact page and manual Terraform versioning [{R:5289967628}]. Auth0 Forms plus Contentful-driven versions keeps the gate inside the login flow and lets Legal publish without a deploy [{R:5318967303}]."] },
      ],
      questions: [
        { text: "How is a written opt-out within 30 days recorded [B1 Q1]?", who: "Legal", blocking: true },
        { text: "What retry and alerting applies to events on the .dlt topic?", who: "DevOps" },
      ],
      report: {
        decisionsNeeded: ["Consent UI: Auth0 Forms (Proposals A/D) versus a monoreact page (Proposal C) [{R:5289967628}].", "Provisioning: synchronous webhook versus Kafka for agreement definitions [{R:5329387522}]."],
      },
    }),
  discovery: {
    BRD: {
      rounds: [
        {
          queries: [
            { purpose: "List the Phase 1 epics under PLAN-818", args: ["jira", "issue", "list", "parent = PLAN-818 ORDER BY created ASC", "--limit", "25"] },
            { purpose: "Find the research epic on consent capture", args: ["jira", "issue", "list", 'project = CP AND text ~ "consent" ORDER BY created ASC', "--limit", "25"] },
          ],
          relevant: ["PLAN-818", "CP-50889", "CP-50416"],
        },
        {
          queries: [{ purpose: "Fetch the evidence epic", args: ["jira", "issue", "get", "CP-50891", "-o", "json"] }],
          relevant: ["PLAN-818", "CP-50889", "CP-50890", "CP-50891", "CP-50892", "CP-50893", "CP-50416"],
        },
      ],
    },
    AAD: {
      rounds: [
        {
          queries: [
            { purpose: "Find the architecture proposals for the post-login gate", args: ["confluence", "search", 'text ~ "terms gate" OR text ~ "clickwrap"', "--limit", "25"] },
            { purpose: "Find the database and Kafka promotion tickets", args: ["jira", "issue", "list", 'text ~ "agreement" ORDER BY created ASC', "--limit", "25"] },
          ],
          relevant: ["CP-50889", "5289967628", "5318967303", "5329387522"],
        },
        {
          queries: [
            { purpose: "Fetch the table creation ticket", args: ["jira", "issue", "get", "DATA-3141", "-o", "json"] },
            { purpose: "Fetch the Kafka topic promotion ticket", args: ["jira", "issue", "get", "DV-5907", "-o", "json"] },
          ],
          relevant: ["CP-50889", "5289967628", "5318967303", "5289672706", "5289443332", "5289836547", "5329387522", "5432049666", "DATA-3141", "DATA-3142", "DV-5907"],
        },
      ],
    },
  },
};
