import "server-only";
/**
 * Plans for the seeded projects past Stage 3, both built on the Auth0 terms gate as their AADs
 * design it: TG (done) creates the agreement tables, the post-login context, the acceptance
 * consumer, the gateway routes and the post-login action; PPR (at PO review) widens the gate to
 * Preferred and Retail customers for the Privacy Policy and to scheduled versions. Their code is in
 * gate-code.ts. Traces follow the seeded TG and PPR BRD/AAD numbering.
 */
import type { PlanPack } from "./types";

// ---------------------------------------------------------------------------------------------
// PPR: Privacy Policy Re-acceptance Prompt
// BR-1 prompt at next login, BR-2 every customer type, BR-3 English/Spanish, BR-4 decline blocks,
// BR-5 acceptance evidence, BR-6 publish ahead of the effective date, BR-7 (candidate) 30-day email.
// ---------------------------------------------------------------------------------------------

const PPR_CORE = { title: "Privacy Policy Re-acceptance Prompt: core experience", refs: ["BR-1", "BR-2", "BR-3", "BR-4", "BR-6"] };
const PPR_ROLLOUT = { title: "Access control and rollout", refs: ["BR-2"] };
const PPR_AUDIT = { title: "Audit trail and evidence", refs: ["BR-5"] };

export const PPR_PLAN: PlanPack = {
  summary:
    "Reuse the Auth0 terms gate for the 2026.3 Privacy Policy and every customer type: customer-service-v2 adds Privacy Policy requirement rows for Preferred and Retail customers behind a flag and honours the effective date of a version Legal schedules in Contentful; the post-login action is widened from Brand Ambassadors to every type with a Privacy Policy prompt; pww-automation covers each customer type. No new service, no schema change and no new call on the login path. Wave 1 is the service work, wave 2 the action, wave 3 the E2E suite.",
  tasks: [
    {
      id: "T-1",
      title: "[customer-service-v2] Privacy Policy requirement rows for Preferred and Retail customers",
      description:
        "Add CustomerAgreementRequirement rows so Preferred and Retail customers must accept the Privacy Policy (and nothing else), and gate those types in the post-login context behind privacy-reacceptance-all-customer-types, defaulted off.",
      priority: "high",
      tags: ["backend", "data"],
      dependencies: [],
      relatedFiles: ["src/main/java/com/plexus/customer/terms/PostLoginContextController.java"],
      acceptanceCriteria: [
        { id: "AC-1", text: "Preferred and Retail customers who have not accepted the current Privacy Policy get it in outstandingAgreements" },
        { id: "AC-2", text: "Preferred and Retail customers are never asked for the Brand Ambassador Agreement or Policies & Procedures" },
        { id: "AC-3", text: "With privacy-reacceptance-all-customer-types off, nothing changes for Preferred and Retail customers" },
      ],
      epic: PPR_ROLLOUT,
      type: "story",
      repo: "customer-service-v2",
      size: "M",
      wave: 1,
      traces: ["BR-2", "FR2"],
    },
    {
      id: "T-2",
      title: "[customer-service-v2] Scheduled Privacy Policy versions start on their effective date",
      description:
        "Store the effective date from the Contentful scheduled publish; keep the current version active until then and return the new version as outstanding from that date, so Legal can publish 2026.3 ahead of 2026-11-01.",
      priority: "high",
      tags: ["backend"],
      dependencies: [],
      relatedFiles: ["src/main/java/com/plexus/customer/terms/AgreementProvisioningService.java", "src/main/java/com/plexus/customer/terms/OutstandingAgreementsQuery.java"],
      acceptanceCriteria: [
        { id: "AC-1", text: "A version published before its effective date leaves the current version active" },
        { id: "AC-2", text: "From the effective date, every customer who has not accepted it gets it at their next login" },
        { id: "AC-3", text: "Customers who accepted the previous version keep access until the effective date" },
      ],
      epic: PPR_CORE,
      type: "story",
      repo: "customer-service-v2",
      size: "S",
      wave: 1,
      traces: ["BR-1", "BR-6", "FR1", "FR6"],
    },
    {
      id: "T-3",
      title: "[terraform-auth0] Terms gate: every customer type and the Privacy Policy prompt",
      description:
        "Widen terms-gate.js from Brand Ambassadors to every customer type (the post-login context decides what is outstanding), show the Privacy Policy update heading when only the policy is outstanding, and keep the session blocked when the customer declines.",
      priority: "high",
      tags: ["auth0", "login"],
      dependencies: ["T-1", "T-2"],
      relatedFiles: ["actions/post-login/terms-gate.js", "forms/agreement-acceptance.tf"],
      acceptanceCriteria: [
        { id: "AC-1", text: "Brand Ambassadors, Preferred and Retail customers with an outstanding Privacy Policy see the prompt at login" },
        { id: "AC-2", text: "The policy is shown in the customer's language, English or Spanish" },
        { id: "AC-3", text: "Declining keeps the session blocked until the customer accepts" },
        { id: "AC-4", text: "No new call is added to the login path" },
      ],
      epic: PPR_CORE,
      type: "story",
      repo: "terraform-auth0",
      size: "S",
      wave: 2,
      traces: ["BR-1", "BR-2", "BR-3", "BR-4", "FR1", "FR2", "FR3", "FR4"],
    },
    {
      id: "T-4",
      title: "[QA] E2E: Privacy Policy re-acceptance for every customer type",
      description: "pww-automation scenarios with ambassador, Preferred and Retail test customers: prompt once 2026.3 is effective, accept, decline and a Spanish session.",
      priority: "medium",
      tags: ["qa", "e2e"],
      dependencies: ["T-3"],
      relatedFiles: ["src/test/kotlin/com/plexus/pww/agreements/PrivacyReacceptanceTest.kt"],
      acceptanceCriteria: [
        { id: "AC-1", text: "Ambassador, Preferred and Retail test customers are prompted once 2026.3 is effective" },
        { id: "AC-2", text: "Accepting records a CustomerAgreement row with the version, time and evidence" },
        { id: "AC-3", text: "Declining keeps the customer out of their account" },
        { id: "AC-4", text: "A Spanish-language session shows the Spanish policy" },
      ],
      epic: PPR_AUDIT,
      type: "task",
      repo: "pww-automation",
      size: "S",
      wave: 3,
      traces: ["BR-1", "BR-2", "BR-3", "BR-4", "BR-5", "FR5"],
    },
  ],
  report: {
    assumptions: [
      "Re-acceptance reuses the terms gate, the acceptance topic and the CustomerAgreement write (CP-50891); no schema change and no new service.",
      "Legal authors 2026.3 in Contentful with a scheduled publish; the English and Spanish text comes from there.",
      "Acceptances by Preferred and Retail customers carry the same evidence as ambassadors' (IP address, user agent, geolocation, name snapshot).",
    ],
    openQuestions: [],
    uncovered: ["BR-7 (Candidate): the reminder email 30 days before the effective date is owned by Marketing; no engineering task."],
    risks: [
      "Preferred and Retail customers meet the gate for the first time; Customer Service should expect contacts in the first two weeks (BRD success metric 2).",
      "A late Contentful scheduled publish starts the prompt late; T-2 reads the effective date, not the publish time.",
    ],
  },
};

// ---------------------------------------------------------------------------------------------
// TG: Agreement Acceptance at Login
// BR-1 accept after login, BR-2 any device, English/Spanish, BR-3 blocked until accepted,
// BR-4 acceptance evidence, BR-5 ARC never accepts, BR-6 new versions re-prompt.
// ---------------------------------------------------------------------------------------------

const TG_CORE = { title: "Agreement Acceptance at Login: core experience", refs: ["BR-1", "BR-2", "BR-3", "BR-4", "BR-6"] };
const TG_ACCESS = { title: "Access control and rollout", refs: ["BR-5"] };

export const TG_PLAN: PlanPack = {
  summary:
    "Gate Brand Ambassadors at login until they accept the current Brand Ambassador Agreement, Policies & Procedures and Privacy Policy: customer-service-v2 owns the agreement tables, provisioning from the Contentful publish webhook, the post-login context and the acceptance consumer; api-gateway exposes the post-login context, publishes acceptances to customerflow.auth0.agreement.accepted.v1 and guards the webhook; the Auth0 post-login action shows the form and blocks the session. Wave 1 is the service work, wave 2 the routes and the action, wave 3 the E2E suite.",
  tasks: [
    {
      id: "T-1",
      title: "[customer-service-v2] Agreement tables and provisioning from the Contentful publish webhook",
      description:
        "Create CustomerAgreementType, CustomerAgreementRequirement and CustomerAgreement in the ThatOtherGuy database and provision a CustomerAgreementType row for every agreement version Legal publishes in Contentful (POST /api/v1/webhooks/contentful).",
      priority: "high",
      tags: ["backend", "data"],
      dependencies: [],
      relatedFiles: ["src/main/java/com/plexus/customer/terms/AgreementProvisioningService.java"],
      acceptanceCriteria: [
        { id: "AC-1", text: "Publishing an agreement version in Contentful creates one active CustomerAgreementType row for that version" },
        { id: "AC-2", text: "A re-delivered webhook does not create a duplicate version" },
        { id: "AC-3", text: "A new version deactivates the previous version of the same agreement, so customers are prompted again" },
      ],
      epic: TG_CORE,
      type: "story",
      repo: "customer-service-v2",
      size: "M",
      wave: 1,
      traces: ["BR-6", "FR6"],
    },
    {
      id: "T-2",
      title: "[customer-service-v2] Outstanding agreements in the post-login context",
      description:
        "GET /v1/sso/post-login-context returns the current agreement versions the customer's type requires and the customer has not accepted, with English and Spanish titles, and whether the gate is on (ambassador-upgrade-agreements-enabled).",
      priority: "critical",
      tags: ["backend", "login"],
      dependencies: [],
      relatedFiles: ["src/main/java/com/plexus/customer/terms/PostLoginContextController.java"],
      acceptanceCriteria: [
        { id: "AC-1", text: "An ambassador who has not accepted the current version of a required agreement gets it in outstandingAgreements" },
        { id: "AC-2", text: "An ambassador who accepted every current version gets an empty list" },
        { id: "AC-3", text: "Agreement titles are returned in English and Spanish" },
        { id: "AC-4", text: "The lookup adds under 50 ms p95 to the login" },
      ],
      epic: TG_CORE,
      type: "story",
      repo: "customer-service-v2",
      size: "M",
      wave: 1,
      traces: ["BR-1", "BR-2", "BR-6", "FR1", "FR2"],
    },
    {
      id: "T-3",
      title: "[customer-service-v2] Acceptance consumer with evidence",
      description:
        "Consume customerflow.auth0.agreement.accepted.v1 into append-only CustomerAgreement rows with the version, time, IP address, user agent, geolocation and a name snapshot; bounded retry, then the .dlt topic.",
      priority: "high",
      tags: ["backend", "kafka"],
      dependencies: [],
      relatedFiles: ["src/main/java/com/plexus/customer/terms/AgreementAcceptedConsumer.java"],
      acceptanceCriteria: [
        { id: "AC-1", text: "Each accepted agreement writes one CustomerAgreement row with customer, agreement type, version and time" },
        { id: "AC-2", text: "The row records the IP address, user agent, geolocation and a name snapshot" },
        { id: "AC-3", text: "A replayed event does not create a second row" },
        { id: "AC-4", text: "An event that still fails after 3 attempts goes to the .dlt topic" },
      ],
      epic: TG_CORE,
      type: "story",
      repo: "customer-service-v2",
      size: "M",
      wave: 1,
      traces: ["BR-4", "FR4"],
    },
    {
      id: "T-4",
      title: "[api-gateway] Agreement routes: post-login context, acceptance and Contentful webhook",
      description:
        "Routes for GET /v1/sso/post-login-context and POST /v1/agreements (basic auth; acceptances published to customerflow.auth0.agreement.accepted.v1) and POST /api/v1/webhooks/contentful (Contentful signature and IP allow-list).",
      priority: "medium",
      tags: ["gateway"],
      dependencies: ["T-1", "T-2", "T-3"],
      relatedFiles: ["routes/agreements.yaml"],
      acceptanceCriteria: [
        { id: "AC-1", text: "The terms gate reaches GET /v1/sso/post-login-context with basic auth; other callers get 401" },
        { id: "AC-2", text: "POST /v1/agreements publishes the acceptance to customerflow.auth0.agreement.accepted.v1 and returns 202" },
        { id: "AC-3", text: "Webhook calls without a valid Contentful signature or from outside the allow-list get 403" },
      ],
      epic: TG_CORE,
      type: "task",
      repo: "api-gateway",
      size: "S",
      wave: 2,
      traces: ["BR-1", "BR-4", "BR-6", "FR4", "FR6"],
    },
    {
      id: "T-5",
      title: "[terraform-auth0] Terms gate post-login action and acceptance form",
      description:
        "terms-gate.js post-login action: reads the post-login context, renders the Agreement acceptance form (English and Spanish) with the outstanding agreements, denies the session until all are accepted, posts the acceptance with its evidence, and skips ARC impersonation sessions.",
      priority: "critical",
      tags: ["auth0", "login"],
      dependencies: ["T-2", "T-3"],
      relatedFiles: ["actions/post-login/terms-gate.js", "actions.tf", "forms/agreement-acceptance.tf"],
      acceptanceCriteria: [
        { id: "AC-1", text: "An ambassador with outstanding agreements sees the acceptance form right after login" },
        { id: "AC-2", text: "Declining, or accepting only some agreements, denies the session" },
        { id: "AC-3", text: "The form is shown in Spanish when the browser language is Spanish" },
        { id: "AC-4", text: "ARC impersonation sessions skip the gate and never record an acceptance" },
      ],
      epic: TG_ACCESS,
      type: "story",
      repo: "terraform-auth0",
      size: "M",
      wave: 2,
      traces: ["BR-1", "BR-2", "BR-3", "BR-5", "FR1", "FR2", "FR3", "FR5"],
    },
    {
      id: "T-6",
      title: "[QA] E2E: agreement gate at login",
      description: "pww-automation scenarios through Universal Login: an outstanding test ambassador, a fully accepted one, a Spanish-language session and an ARC session.",
      priority: "medium",
      tags: ["qa", "e2e"],
      dependencies: ["T-4", "T-5"],
      relatedFiles: ["src/test/kotlin/com/plexus/pww/agreements/TermsGateTest.kt"],
      acceptanceCriteria: [
        { id: "AC-1", text: "An ambassador with outstanding agreements is gated until they accept" },
        { id: "AC-2", text: "After accepting, the ambassador reaches the back office and a CustomerAgreement row exists" },
        { id: "AC-3", text: "A Spanish-language session shows the form in Spanish" },
        { id: "AC-4", text: "An ARC session reaches the back office without the gate" },
      ],
      epic: TG_CORE,
      type: "task",
      repo: "pww-automation",
      size: "S",
      wave: 3,
      traces: ["BR-1", "BR-2", "BR-3", "BR-4", "BR-5"],
    },
  ],
  report: {
    assumptions: [
      "Acceptance records are immutable and append-only; the gate never edits them.",
      "Agreement text and its Spanish translation live in Contentful (Login Agreement Consent Form); the action only renders them.",
      "The gate fails open: if the post-login context is unavailable the login continues and the next login prompts again, since nothing on this path may block login.",
    ],
    openQuestions: [],
    uncovered: [],
    risks: [
      "The post-login context is on the authentication path; T-2 carries a 50 ms p95 budget.",
      "The new Kafka topic and its .dlt need least-privilege IAM per service before STAGE.",
    ],
  },
};
