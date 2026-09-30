import "server-only";
/**
 * PPR, Privacy Policy Re-acceptance Prompt: re-acceptance of the 2026-11-01 Privacy Policy at
 * login for every customer type, reusing the terms gate.
 */
import { Cites } from "../doc/cites";
import { draftBrd, type BrdSpec } from "../doc/brd";
import { genericAad } from "../generic/aad";
import type { ContentPack } from "./types";

const NOTE = "notes/policy-reacceptance/privacy-update.md";

function spec(n: string): BrdSpec {
  return {
    title: "Privacy Policy Re-acceptance Prompt",
    lead: [`Legal owns the Privacy Policy change and decided the decline behaviour on 2026-08-07 [${n} L7]. No Product Manager is named — see Q4.`],
    problem: [
      `A new Privacy Policy version takes effect on 2026-11-01 [${n} L3, {R:5518822401}] and every customer type must re-accept it: Brand Ambassadors, Preferred customers and Retail customers [${n} L4]. The login terms gate only prompts Brand Ambassadors today [{R:CP-52301}, M Standing decisions and constraints].`,
      "Customer tie-back: customers need to see and accept the policy that governs their data, in their language, before it applies to them [" + n + " L6].",
    ],
    solution: [
      `Reuse the post-login terms gate built for the ambassador agreements so any customer who has not accepted the current Privacy Policy is prompted at their next login [${n} L5, {R:CP-50893}]. Legal publishes the new version early and the prompt starts on the effective date [${n} L8, {R:5432049666}].`,
    ],
    requirements: [
      { text: `When a new Privacy Policy version takes effect, every customer who has not accepted it is prompted at their next login [${n} L3, ${n} L5, {R:CP-52300}].` },
      { text: `The prompt applies to Brand Ambassadors, Preferred customers and Retail customers [${n} L4, {R:CP-52301}].` },
      { text: `The policy is shown in the customer's language, English or Spanish [${n} L6, {R:5518822401}].` },
      { text: `A customer who declines cannot use their account until they accept [${n} L7].` },
      { text: "Each acceptance is recorded with the version, the time and the same evidence as agreement acceptances [{R:CP-50891}]." },
      { text: `Legal can publish the new version ahead of the effective date and the prompt starts on that date [${n} L8, {R:5432049666}].` },
      { text: `(Candidate) Customers receive an email 30 days before the effective date [${n} L9]; Marketing owns it.`, candidate: true },
    ],
    metrics: {
      intro: "Candidates only; validate with BI (template contact: Thomas Hamilton).",
      items: [
        "(Candidate) Share of active customers who accepted the 2026-11-01 version within 30 days of the effective date. Baseline not applicable (new version).",
        "(Candidate) Customer Service contacts about the prompt in the first two weeks. Baseline not provided.",
      ],
    },
    outOfScope: [
      `Reporting on re-acceptance coverage [${n} L10]; the Agreement Progress page can add it later [M Document register].`,
      "New screen designs; the existing terms gate is reused [" + n + " L5].",
      "Writing the policy text; Legal supplies it.",
      "Technical solution design and ticket breakdown.",
    ],
    questions: [
      { text: `Declining blocks the account [${n} L7]: does that include placing orders already in progress, and auto-orders?`, who: "Legal", blocking: true },
      { text: "Retail and Preferred customers were excluded from the Phase 1 population [M Standing decisions and constraints]. Do their accounts have the requirement rows the gate needs?", who: "Engineering / Data Engineering", blocking: true },
      { text: "The effective date falls near the holiday code freeze. Is 2026-11-01 fixed?", who: "Legal / PO" },
      { text: "Who is the Product Manager for this change?", who: "PO" },
    ],
    planIntro: "Status and dates only where the sources provide them.",
    plan: [`Not yet provided. An email 30 days ahead is owned by Marketing [${n} L9].`, "Not yet provided.", "Not yet provided.", "Not yet provided.", `Not yet provided. The prompt must start on 2026-11-01 [${n} L3].`],
  };
}

export const pprPack: ContentPack = {
  id: "policy-reacceptance",
  key: "PPR",
  title: "Privacy Policy Re-acceptance Prompt",
  brd: (ctx) => {
    const cites = new Cites(ctx);
    const n = cites.note(NOTE);
    return draftBrd(
      spec(n),
      {
        conflicts: ["Population: Phase 1 scoped the gate to US Ambassadors and excluded VIP and Retail [M Standing decisions and constraints]; this BRD widens it to every customer type. Recorded as Q2."],
        ignoredInstructions: ["No file was sent, published, or shared; no ticket or memory update was written."],
        changes: [`Created ${ctx.out} as a first draft from the request, ${n} and the confirmed references.`, "The 30-day email held back as a candidate; Marketing owns it."],
      },
      cites,
      ctx.out,
    );
  },
  aad: (ctx) =>
    genericAad(ctx, {
      actor: "Customer",
      systems: [
        { name: "Auth0 terms gate", role: "Post-login action that presents outstanding agreements and records acceptance [M Glossary].", status: "Proposed", change: "Eligibility widened from Brand Ambassadors to every customer type; no new call in the login path.", kind: "identity" },
        { name: "api-gateway", role: "Existing edge for GET /v1/sso/post-login-context and POST /v1/agreements [M Systems and services].", status: "No change", change: "Existing routes reused.", kind: "gateway" },
        { name: "customer-service-v2", role: "Owns provisioning, the outstanding-agreements query and the acceptance consumer [M Systems and services].", status: "Proposed", change: "Requirement rows for Preferred and Retail customer types; outstanding-agreements query covers them.", kind: "service" },
        { name: "ThatOtherGuy database", role: "Holds CustomerAgreementType, CustomerAgreementRequirement and CustomerAgreement [M Systems and services].", status: "Proposed", change: "New CustomerAgreementRequirement rows for Preferred and Retail; no schema change.", kind: "db" },
        { name: "Contentful", role: "Source of truth for agreement and policy versions [M Systems and services].", status: "No change", change: "Legal authors the new Privacy Policy version with a scheduled publish [{R:5432049666}].", kind: "external" },
        { name: "LaunchDarkly", role: "Gates new behaviour without a deploy [M Integration conventions].", status: "Proposed", change: "Flag widening the gate to all customer types, defaulted off.", kind: "flag" },
      ],
      designs: {
        1: "Scheduled Contentful publish provisions the new version; the outstanding-agreements query returns it from the effective date",
        2: "CustomerAgreementRequirement rows for Preferred and Retail customer types",
        3: "Existing English and Spanish consent form in the Auth0 terms gate",
        4: "Terms gate keeps the session blocked until acceptance, as today",
        5: "Existing Kafka acceptance topic and CustomerAgreement write in customer-service-v2",
        6: "Contentful scheduled publish plus the existing webhook provisioning",
      },
      questions: [
        { text: "Do Preferred and Retail accounts need backfilled requirement rows before the effective date, and who runs the backfill [B1 Q2]?", who: "Data Engineering", blocking: true },
        { text: "Does a blocked session also stop auto-orders and orders in progress [B1 Q1]?", who: "Legal / Engineering", blocking: true },
        { text: "What login peak is expected on 2026-11-01, when every customer type is prompted at once?", who: "DevOps" },
      ],
      report: {
        decisionsNeeded: [
          "Backfill strategy for requirement rows: one migration before the effective date, or provisioning on first login.",
          "Flag strategy: widen by customer type in steps, or all at once on the effective date.",
        ],
      },
    }),
  discovery: {
    BRD: {
      rounds: [
        {
          queries: [
            { purpose: "Find the re-acceptance epic and stories", args: ["jira", "issue", "list", 'project = CP AND text ~ "re-acceptance" ORDER BY created DESC', "--limit", "25"] },
            { purpose: "Find the Privacy Policy change summary", args: ["confluence", "search", 'space = LEG AND title ~ "Privacy Policy"', "--limit", "10"] },
            { purpose: "Find how agreement versions are authored in Contentful", args: ["confluence", "search", 'text ~ "consent form" AND text ~ "contentful"', "--limit", "10"] },
          ],
          relevant: ["CP-52300", "CP-52301", "CP-50893"],
        },
        {
          queries: [
            { purpose: "Read the change summary", args: ["confluence", "page", "get", "5518822401", "--body"] },
            { purpose: "Read the Contentful authoring spec", args: ["confluence", "page", "get", "5432049666", "--body"] },
          ],
          relevant: ["CP-52300", "CP-52301", "CP-50893", "5518822401", "5432049666", "CP-50889", "CP-50891", "5302779911"],
        },
      ],
    },
  },
};
