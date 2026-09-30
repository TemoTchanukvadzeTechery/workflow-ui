import "server-only";
/**
 * ASL, Agreement Acceptance Status Lookup: the individual-lookup work (CP-50908 under CP-51709)
 * that the AGR BRD left out of scope. The seeded project waits on its AAD review:1, whose
 * question reads "3 blocking questions, 4 decisions needed" (brief F.3).
 */
import { Cites } from "../doc/cites";
import { draftBrd, type BrdSpec } from "../doc/brd";
import { genericAad } from "../generic/aad";
import type { ContentPack } from "./types";

const NOTE = "notes/agreement-status-lookup/cs-escalations.md";

function spec(n: string): BrdSpec {
  return {
    title: "Agreement Acceptance Status Lookup",
    lead: [
      "Not yet provided. No source names a business stakeholder or the Product Manager leading this work. Legal/Compliance is the consuming group [{R:CP-50908}, M Stakeholders and teams]; Customer Service raises the escalations [" + n + " L3]. See Open Questions Q1.",
    ],
    problem: [
      `When an ambassador's acceptance is questioned in a dispute or escalation, Legal needs to confirm exactly what that ambassador accepted and when [{R:CP-50908}]. Today every such question becomes a data pull request to Engineering: Customer Service logged 14 in Q3 2026, with a median of 3 business days to answer [${n} L3, ${n} L4, {R:CS-1240}].`,
      "The acceptance record exists — captured at login with evidence since the PLAN-818 work [{R:CP-50889}, {R:CP-50891}] — but no one outside Engineering can read it.",
      `Customer tie-back: the ambassador waits while their status is confirmed, and an escalation stays open for days [{R:CS-1240}]. A typical case is whether an ambassador accepted the current Policies & Procedures before a termination notice [${n} L5].`,
    ],
    solution: [
      `A lookup that finds one ambassador by Customer ID or name and shows, for each of the Brand Ambassador Agreement, Policies & Procedures and Privacy Policy, the version accepted and when, flagging when the current version has not been accepted [{R:CP-50908}, ${n} L6].`,
      "It should sit next to the aggregate acceptance reporting described in the registered BRD \"Ambassador Agreement Acceptance Reporting\", which leaves individual lookup to this work [M Document register]. The surface and access model are not decided here; see Q3 and Q4.",
    ],
    requirements: [
      { text: `Legal/Compliance can find an individual ambassador by Customer ID or by name [{R:CP-50908}, ${n} L6].` },
      { text: "For each of the three agreements, the lookup shows the version the ambassador accepted and the date and time of acceptance [{R:CP-50908}]." },
      { text: "The lookup flags when the ambassador has not accepted the current version of an agreement [{R:CP-50908}]." },
      { text: "The lookup shows the ambassador's acceptance history across versions, newest first [{R:CP-50908}, {R:CP-50893}]." },
      { text: `Acceptances made through D2A enrollment are shown once, not as a second set of agreements [${n} L9, {R:CP-51265}].` },
      { text: `Access is restricted to Legal/Compliance and, if confirmed, Customer Service team leads [${n} L7]; the control mechanism is an open question (Q3).` },
      { text: "(Candidate) The evidence captured with each acceptance (IP address, device, geolocation) can be viewed for a dispute [{R:CP-50891}]; see Q2.", candidate: true },
      { text: `(Candidate) The record for one ambassador can be printed or saved for the legal file [${n} L8]; see Q2.`, candidate: true },
    ],
    metrics: {
      intro: "Candidates only. Each must be validated with BI (template contact: Thomas Hamilton) before use.",
      items: [
        `(Candidate) Data pull requests to Engineering for an individual acceptance record, per quarter — 14 in Q3 2026 [${n} L3, {R:CS-1240}]; expected to fall to zero after launch. Target not provided.`,
        `(Candidate) Time to answer an individual acceptance question — median 3 business days today [${n} L4, {R:CS-1240}]. Target not provided.`,
      ],
      outro: "The product line's core KPI is not stated in any source [M Product KPIs].",
    },
    outOfScope: [
      "Aggregate acceptance reporting across the ambassador base — covered by the registered BRD \"Ambassador Agreement Acceptance Reporting\" and CP-50909 [M Document register, {R:CP-50909}].",
      "Capturing acceptance, enforcing it at login, and logging evidence — delivered under CP-50889, CP-50890 and CP-50891 [{R:CP-50889}, {R:CP-50891}].",
      "Editing, correcting or deleting acceptance records.",
      `Weekly lists of open escalations to Legal [${n} L10]; an operational request, not part of this work.`,
      "Technical solution design and ticket breakdown; this BRD stops at requirements.",
    ],
    questions: [
      { text: "Who is the business stakeholder owning this work, and who is the Product Manager leading it? No source names them.", who: "PO" },
      { text: `Is the acceptance evidence (IP address, device, geolocation) in scope for display, and is a printable record needed [{R:CP-50891}, ${n} L8]? Both raise the data classification.`, who: "PO / Legal", blocking: true },
      { text: `Who besides Legal/Compliance may use the lookup — Customer Service team leads [${n} L7]? Which group or role controls it?`, who: "Legal / Security Engineering", blocking: true },
      { text: "Should the lookup live on the same surface as the aggregate report of the registered BRD \"Ambassador Agreement Acceptance Reporting\" [M Document register]?", who: "PO", blocking: true },
      { text: "How should an ambassador who used the 30-day written opt-out be shown [{R:CP-50416}]?", who: "Legal (Michael Ruppert)" },
      { text: "Does the lookup cover VIP and Retail customer types, or US Ambassadors only [M Standing decisions and constraints]?", who: "PO / Legal" },
      { text: "Is a target date expected? CP-51709 sits in the Q4 project PLAN-577 [{R:CP-51709}].", who: "PO" },
    ],
    planIntro: "Status and dates only where the sources provide them. No source provides any; all items are unstarted and unscheduled.",
  };
}

export const aslPack: ContentPack = {
  id: "agreement-status-lookup",
  key: "ASL",
  title: "Agreement Acceptance Status Lookup",
  brd: (ctx) => {
    const cites = new Cites(ctx);
    const n = cites.note(NOTE);
    return draftBrd(
      spec(n),
      {
        conflicts: [
          "Scope boundary with the registered BRD \"Ambassador Agreement Acceptance Reporting\", which excludes individual lookup and leaves it to CP-50908 [M Document register]; this BRD takes that scope. Recorded for the PO as Q4.",
          `D2A enrollees carry a second set of agreement type ids [${n} L9, {R:CP-51265}], so "shown once" (requirement 5) needs a counting rule from Data Engineering.`,
        ],
        ignoredInstructions: [
          `${n} L10 — "Please send the list of open escalations to Legal every Friday"; an operational request inside a source, not acted on.`,
          "No file was sent, published, or shared; no ticket or memory update was written.",
        ],
        changes: [
          `Created ${ctx.out} as a first draft from the request, ${n}, the confirmed references and the shared memory M.`,
          "Scope set to individual lookup, consistent with the out-of-scope line of the registered AGR BRD [M Document register].",
          "Evidence display and a printable record held back as candidate requirements 7 and 8 pending Q2.",
          "Success Metrics offered as two candidates with the Q3 baseline from CS-1240; no targets invented.",
        ],
      },
      cites,
      ctx.out,
    );
  },
  aad: (ctx) =>
    genericAad(ctx, {
      revisionPurpose: "Initial draft assembled from the accepted BRD [B1], the architect's request [{A:request}], the CP-51264 spike write-up [{R:5454659585}], the terms-gate AAD [{R:5302779911}] and the shared memory [M].",
      scope: [
        "This document describes the architecture approach for letting Legal/Compliance look up one ambassador's agreement acceptance status and history, without a data pull request to Engineering [B1 §Requirements 1-4].",
      ],
      inScope: [
        "A customer agreements section on the customer record in website-customer-portal [B1 §Requirements 1-4, {R:5454659585}].",
        "A read-only history endpoint for all versions a customer accepted [B1 §Requirements 4].",
        "Collapsing D2A duplicate acceptance sets for display [B1 §Requirements 5].",
        "Access restricted to the intended internal audience [B1 §Requirements 6].",
      ],
      problem: [
        "The acceptance record lives in the ThatOtherGuy CustomerAgreement tables, written by the terms gate [{R:5302779911}, M Systems and services]. Per-customer reads exist today — CustomerAgreementGet_v2 behind customer-service and the outstanding-agreements query in customer-service-v2 [{R:5454659585}] — but no surface exposes them to Legal [B1 §Problem to be Solved].",
        "The spike found the per-customer view can be built by reusing those endpoints, and a PoC already adds the sections to customer-portal (pull request 275) [{R:5454659585}]. History across versions and D2A duplicates are the new parts.",
      ],
      systems: [
        { name: "website-customer-portal", role: "Internal customer-management app, Okta OIDC, SSR disabled [M Systems and services]. Proposed host of the customer agreements section.", status: "Proposed", change: "New customer agreements section on the customer record, based on the PoC in pull request 275 [{R:5454659585}]; route-level authorization; feature-flag gating.", kind: "host" },
        { name: "customer-service", role: "Node service already integrated with customer-portal; consumer of CustomerAgreementGet_v2 [M Systems and services].", status: "No change", change: "Reused as-is for accepted agreements per customer [{R:5454659585}].", kind: "service" },
        { name: "customer-service-v2", role: "Owns the agreement domain SQL written by the terms gate [M Systems and services].", status: "Proposed", change: "New read-only history endpoint returning every version a customer accepted; reuse of the outstanding-agreements query for \"current version not accepted\".", kind: "service" },
        { name: "api-gateway", role: "Existing edge for agreement endpoints; authenticates and forwards [M Systems and services].", status: "Proposed", change: "New route for the history endpoint, only if the portal cannot reach customer-service-v2 internally (decision needed).", kind: "gateway" },
        { name: "ThatOtherGuy database", role: "Holds CustomerAgreement, CustomerAgreementType and CustomerAgreementRequirement [M Systems and services].", status: "Proposed, read-only", change: "Reads by CustomerID; index check with Data Engineering. No schema change.", kind: "db" },
        { name: "Okta", role: "Authentication for customer-portal; access-control point for the Legal audience [M Systems and services].", status: "No change", change: "Group or role assignment only (Q1).", kind: "identity" },
        { name: "LaunchDarkly", role: "Gates new surfaces without a deploy [M Integration conventions].", status: "Proposed", change: "One flag for the customer agreements section, defaulted off.", kind: "flag" },
      ],
      designs: {
        1: "Search by Customer ID or name on the existing customer search of website-customer-portal",
        2: "Accepted agreements from CustomerAgreementGet_v2 via customer-service, one row per agreement type",
        3: "Outstanding-agreements query in customer-service-v2, reused per customer [{R:5454659585}]",
        4: "New read-only history endpoint on customer-service-v2, newest first",
        5: "D2A agreement type ids mapped to their base agreement before display (rule pending Q3)",
        6: "Okta OIDC plus a route-level role check on website-customer-portal ([Security](#security))",
      },
      questions: [
        { text: "Which Okta group gates the section: Legal/Compliance only, or Legal plus Customer Service team leads [B1 Q3]?", who: "Legal / Security Engineering", blocking: true },
        { text: "Is the acceptance evidence (IP address, device, geolocation) shown? It changes the data classification of the section [B1 Q2, {R:CP-50891}].", who: "PO / Legal", blocking: true },
        { text: "How are D2A duplicate acceptance sets collapsed for display, and who owns the mapping [{R:CP-51265}]?", who: "Data Engineering", blocking: true },
        { text: "Does the portal call customer-service-v2 through api-gateway or directly inside the cluster [M Systems and services]?", who: "Engineering" },
        { text: "Which feature flag gates the section?", who: "Engineering" },
        { text: "Which environment holds representative acceptance data, including D2A enrollees, for testing?", who: "QA / Data Engineering" },
        { text: "Is a printable record for the legal file needed in the first release [B1 §Requirements 8]?", who: "PO" },
      ],
      report: {
        decisionsNeeded: [
          "Owning service for the history read: customer-service-v2, the domain owner per the decision record [{R:5329387522}], versus extending customer-service (Node), which is being migrated [M Systems and services].",
          "Transport: website-customer-portal calls customer-service-v2 through a new api-gateway route, or directly inside the cluster.",
          "Placement: a section on the existing customer record versus a standalone Legal lookup page next to the Agreement Progress page [B1 Q4].",
          "Feature flag: reuse the Agreement Progress page flag or create a flag for the customer agreements section.",
        ],
        conflicts: [
          "Service-ownership convention: the portal's existing agreement reads go through customer-service (Node) [{R:5454659585}], while the domain-ownership rule places new agreement SQL in customer-service-v2 [{R:5329387522}]. Drafted with both, pending the decision.",
        ],
        changes: [
          `Created ${ctx.out} as a first draft with all template sections in order, plus Open Questions and Sources appendices.`,
          "System Overview reuses the spike's per-customer findings [{R:5454659585}]; only the history endpoint and the D2A mapping are new.",
          "Functional requirements traced one-to-one to BRD requirements 1-6; candidates 7 and 8 carried but not designed.",
          "Seven open questions recorded, three marked blocking.",
        ],
      },
    }),
  discovery: {
    BRD: {
      rounds: [
        {
          queries: [
            { purpose: "List the stories under CP-51709, the epic for individual lookup", args: ["jira", "issue", "list", "parent = CP-51709 ORDER BY created ASC", "--limit", "25"] },
            { purpose: "Find Customer Service escalation logs about acceptance proof", args: ["jira", "issue", "list", 'project = CS AND text ~ "acceptance" ORDER BY created DESC', "--limit", "25"] },
            { purpose: "Find the spike write-up for CP-51264", args: ["confluence", "search", 'text ~ "CP-51264"', "--limit", "10"] },
            { purpose: "Find the delivered acceptance evidence epics", args: ["jira", "issue", "list", 'project = CP AND issuetype = Epic AND text ~ "acceptance" ORDER BY created DESC', "--limit", "25"] },
          ],
          relevant: ["CP-51709", "CP-50908", "CP-51264"],
        },
        {
          queries: [
            { purpose: "Fetch CS-1240 for the escalation counts", args: ["jira", "issue", "get", "CS-1240", "-o", "json"] },
            { purpose: "Read the spike findings", args: ["confluence", "page", "get", "5454659585", "--body"] },
            { purpose: "Fetch the D2A duplicate-agreements defect", args: ["jira", "issue", "get", "CP-51265", "-o", "json"] },
          ],
          relevant: ["CP-51709", "CP-50908", "CP-51264", "5454659585", "CS-1240", "CP-50889", "CP-50891", "CP-50893", "CP-51265", "CP-50909", "CP-50416"],
        },
      ],
      more: [["CP-50892", "5302779911"]],
    },
    AAD: {
      rounds: [
        {
          queries: [
            { purpose: "Find the spike write-up with the per-customer reuse findings", args: ["confluence", "search", 'text ~ "CP-51264" OR title ~ "Customer Agreements Status Lookup"', "--limit", "10"] },
            { purpose: "Find the terms-gate AAD that defines the acceptance record", args: ["confluence", "search", 'title ~ "Architecture Approach" AND text ~ "terms gate"', "--limit", "25"] },
            { purpose: "Find decision records on agreement service ownership", args: ["confluence", "search", 'space = SD AND text ~ "decision record" AND text ~ "clickwrap"', "--limit", "25"] },
            { purpose: "Find the customer-portal plan and decision records", args: ["confluence", "search", 'space = AR AND text ~ "customer portal"', "--limit", "25"] },
          ],
          relevant: ["CP-51709", "CP-50908", "5454659585", "5302779911"],
        },
        {
          queries: [
            { purpose: "Read the spike findings", args: ["confluence", "page", "get", "5454659585", "--body"] },
            { purpose: "Read the service-ownership decision record", args: ["confluence", "page", "get", "5329387522", "--body"] },
            { purpose: "Read the customer-portal Alive plan", args: ["confluence", "page", "get", "5490999297", "--body"] },
          ],
          relevant: ["CP-51709", "CP-50908", "5454659585", "5302779911", "5329387522", "5490999297", "4834295809", "5193105409", "CP-51265", "CP-50891"],
        },
      ],
    },
  },
};
