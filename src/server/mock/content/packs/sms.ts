import "server-only";
/**
 * SMS, SMS Consent Capture: seeded with an intake only (Stage 1 not started). Starting its run
 * drafts this BRD from notes/sms-consent/requirements-call.md; its AAD is generic.
 */
import { Cites } from "../doc/cites";
import { draftBrd, type BrdSpec } from "../doc/brd";
import type { ContentPack } from "./types";

const NOTE = "notes/sms-consent/requirements-call.md";

function spec(n: string): BrdSpec {
  return {
    title: "SMS Consent Capture",
    lead: [`Not yet provided. Marketing wants the capability [${n} L3] and Legal sets the consent rules [${n} L3, ${n} L9]; neither a business stakeholder nor a Product Manager is named. See Q4.`],
    problem: [
      `Marketing wants to start SMS campaigns in Q1 2027, but Legal allows no marketing SMS without express written consent [${n} L3]. Plexus has no record of SMS marketing consent today: existing customers never gave it [${n} L11].`,
      `Customer tie-back: customers must choose to receive marketing texts, and must be able to stop them at any time [${n} L5, ${n} L6].`,
    ],
    solution: [
      `Capture SMS marketing consent where customers already give their phone number — enrollment and checkout — with an unchecked checkbox and the approved disclosure [${n} L4, {R:CP-52011}], keep proof of each consent [${n} L7], and honour opt-outs by keyword or in My Account [${n} L5, ${n} L6, {R:48214410}].`,
      `Order and shipping texts stay transactional and separate from marketing consent [${n} L8, {R:48213377}].`,
    ],
    requirements: [
      { text: `At enrollment and at checkout, the customer can opt in to marketing SMS with an unchecked checkbox showing the approved disclosure text [${n} L4, {R:CP-52011}].` },
      { text: `No marketing SMS is sent to a number without recorded consent [${n} L3, ${n} L11].` },
      { text: `Each consent keeps the phone number, the disclosure version, where it was captured, the timestamp and the IP address [${n} L7, {R:DATA-3310}].` },
      { text: `Replies STOP, END, CANCEL, UNSUBSCRIBE or QUIT opt the number out immediately; HELP returns support information [${n} L6, {R:48214410}].` },
      { text: `The customer can turn marketing SMS off, and back on, in My Account at any time [${n} L5, {R:CP-52012}].` },
      { text: `Transactional order and shipping texts are unaffected by marketing consent [${n} L8, {R:48213377}].` },
      { text: `(Candidate) Double opt-in: the customer confirms by replying YES before consent counts [${n} L10]; Legal to decide.`, candidate: true },
      { text: "(Candidate) Legal can retrieve the proof of consent for one phone number for a dispute.", candidate: true },
    ],
    metrics: {
      intro: "Candidates only; validate with BI (template contact: Thomas Hamilton).",
      items: ["(Candidate) Opt-in rate at checkout. Baseline not applicable (new).", "(Candidate) Opt-out rate per campaign. Baseline not provided."],
    },
    outOfScope: [`Messages to customers who never consented [${n} L11].`, `Transactional texts [${n} L8].`, "Campaign content and scheduling; Marketing owns them.", "Technical solution design and ticket breakdown."],
    questions: [
      { text: `Is double opt-in required [${n} L10]?`, who: "Legal", blocking: true },
      { text: `What is the approved disclosure text, and when will LEGAL-77 conclude [${n} L9, {R:LEGAL-77}]?`, who: "Legal", blocking: true },
      { text: "Which messaging provider sends marketing SMS, and does it handle the opt-out keywords?", who: "Marketing / Engineering", blocking: true },
      { text: "Who is the business stakeholder and who is the Product Manager?", who: "PO" },
      { text: "Is Q1 2027 a committed launch window?", who: "Marketing" },
    ],
    planIntro: "Status and dates only where the sources provide them. No source provides any.",
  };
}

export const smsPack: ContentPack = {
  id: "sms-consent",
  key: "SMS",
  title: "SMS Consent Capture",
  brd: (ctx) => {
    const cites = new Cites(ctx);
    const n = cites.note(NOTE);
    return draftBrd(
      spec(n),
      {
        conflicts: [`Timing: Marketing plans campaigns for Q1 2027 [${n} L3] while the disclosure wording is still under Legal review [${n} L9, {R:LEGAL-77}].`],
        ignoredInstructions: ["No file was sent, published, or shared; no ticket or memory update was written."],
        changes: [`Created ${ctx.out} as a first draft from the request, ${n} and the confirmed references.`, "Double opt-in and proof-of-consent retrieval held back as candidates."],
      },
      cites,
      ctx.out,
    );
  },
  discovery: {
    BRD: {
      rounds: [
        {
          queries: [
            { purpose: "Find the SMS consent epic and stories", args: ["jira", "issue", "list", 'project = CP AND text ~ "sms consent" ORDER BY created DESC', "--limit", "25"] },
            { purpose: "Find decision records on SMS opt-out keywords", args: ["confluence", "search", 'text ~ "sms" AND text ~ "stop"', "--limit", "10"] },
            { purpose: "Find the notification preference model", args: ["confluence", "search", 'text ~ "notification preferences"', "--limit", "10"] },
          ],
          relevant: ["CP-52010", "CP-52011", "CP-52012"],
        },
        {
          queries: [
            { purpose: "Read the STOP/HELP decision record", args: ["confluence", "page", "get", "48214410", "--body"] },
            { purpose: "Fetch the consent table ticket", args: ["jira", "issue", "get", "DATA-3310", "-o", "json"] },
          ],
          relevant: ["CP-52010", "CP-52011", "CP-52012", "48214410", "48213377", "DATA-3310", "LEGAL-77"],
        },
      ],
    },
  },
};
