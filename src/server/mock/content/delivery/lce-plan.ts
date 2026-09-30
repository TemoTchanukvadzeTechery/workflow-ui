import "server-only";
/**
 * LCE (Legal & Compliance Reporting Export): the five tasks of brief F.6. Jira keys are assigned by
 * the store when the epics are synced (CP-52201..CP-52205 in the seed). Traces follow the seeded
 * LCE BRD/AAD: BR-1 export the figures, BR-2 the ambassador list, BR-3 50,000+ rows, BR-4 audit,
 * BR-5 as-of date and filters in the file, BR-6 Legal only, BR-7 (candidate) es-US headers.
 */
import type { PlanPack } from "./types";

const EXPORT_EPIC = { title: "CSV export of agreement coverage", refs: ["BR-1", "BR-2", "BR-3", "BR-5", "BR-6", "BR-7"] };
const AUDIT_EPIC = { title: "Export audit trail", refs: ["BR-4"] };

export const LCE_PLAN: PlanPack = {
  summary:
    "Add a CSV export to the Agreement Progress report for Legal/Compliance: a streaming export endpoint in customer-service-v2, an \"Export CSV\" button on the portal page visible to Legal users only, an audit entry for every export, and an E2E suite. Wave 1 builds the endpoint; wave 2 adds the button, the audit entry and the row limit with streaming for large exports; wave 3 runs the E2E suite across all of it.",
  tasks: [
    {
      id: "T-1",
      title: "[customer-service-v2] CSV export endpoint",
      description: "GET /v1/agreements/coverage/export?format=csv returning the coverage table as text/csv, using the same query and filters as the JSON endpoint; the file is named agreement-coverage-<as-of>.csv and every row carries the as-of time.",
      priority: "high",
      tags: ["backend", "export"],
      dependencies: [],
      relatedFiles: ["src/main/java/com/plexus/customer/agreements/coverage/CoverageExportController.java"],
      acceptanceCriteria: [
        { id: "AC-1", text: "GET /v1/agreements/coverage/export?format=csv returns text/csv with the coverage columns" },
        { id: "AC-2", text: "The export applies the same agreement and version filters as the JSON endpoint" },
        { id: "AC-3", text: "Figures in the CSV match GET /v1/agreements/coverage for the same filters" },
      ],
      epic: EXPORT_EPIC,
      type: "story",
      repo: "customer-service-v2",
      size: "M",
      wave: 1,
      traces: ["BR-1", "BR-5", "FR1", "FR5"],
    },
    {
      id: "T-2",
      title: '[website-customer-portal] "Export CSV" button on Agreement Progress',
      description: "An Export CSV button on Agreement Progress for Legal/Compliance users that downloads the current view, filters included, as agreement-coverage-<date>.csv.",
      priority: "high",
      tags: ["frontend", "export"],
      dependencies: ["T-1"],
      relatedFiles: ["src/app/agreements/agreement-progress/agreement-progress.component.ts"],
      acceptanceCriteria: [
        { id: "AC-1", text: 'Legal users see an "Export CSV" button on Agreement Progress' },
        { id: "AC-2", text: "Clicking it downloads agreement-coverage-<date>.csv with the current filters applied" },
        { id: "AC-3", text: "The CSV columns match the on-screen table" },
        { id: "AC-4", text: "Users outside Legal/Compliance do not see the button" },
        { id: "AC-5", text: "CSV headers follow the user's locale (en-US, es-US)" },
      ],
      epic: EXPORT_EPIC,
      type: "story",
      repo: "website-customer-portal",
      size: "S",
      wave: 2,
      traces: ["BR-1", "BR-5", "BR-6", "BR-7", "FR1", "FR5", "FR6", "FR7"],
    },
    {
      id: "T-3",
      title: "[website-customer-portal] Export audit log entry",
      description: "Record an audit entry (actor, filters, row count, outcome) for every export so Legal can show who pulled which figures.",
      priority: "medium",
      tags: ["frontend", "audit"],
      dependencies: ["T-1"],
      relatedFiles: ["src/app/core/audit/audit-log.service.ts"],
      acceptanceCriteria: [
        { id: "AC-1", text: "Each export writes an audit entry with actor, filters, row count and time" },
        { id: "AC-2", text: "Entries are listed in Settings > Audit log under action agreement.coverage.export" },
        { id: "AC-3", text: "A failed export writes an entry with the failure reason" },
      ],
      epic: AUDIT_EPIC,
      type: "story",
      repo: "website-customer-portal",
      size: "S",
      wave: 2,
      traces: ["BR-4", "FR4"],
    },
    {
      id: "T-4",
      title: "[customer-service-v2] Row limit and streaming for large exports",
      description: "Stream export rows from the database cursor as they are read and cap an export at 250,000 rows, so exports of the full ambassador base (the list behind the figures, 50,000 rows or more) finish inside the 30 s gateway limit without buffering the result in memory.",
      priority: "high",
      tags: ["backend", "performance"],
      dependencies: ["T-1"],
      relatedFiles: ["src/main/java/com/plexus/customer/agreements/coverage/CoverageExportController.java"],
      acceptanceCriteria: [
        { id: "AC-1", text: "Export rows are streamed to the client as they are read, not buffered" },
        { id: "AC-2", text: "An export of up to 250,000 rows completes within the 30 s gateway limit" },
        { id: "AC-3", text: "Exports over 250,000 rows are rejected with 413 and a message to narrow the filters" },
        { id: "AC-4", text: "Service memory stays under 256 MB during an export" },
      ],
      epic: EXPORT_EPIC,
      type: "story",
      repo: "customer-service-v2",
      size: "M",
      wave: 2,
      traces: ["BR-2", "BR-3", "FR2", "FR3"],
    },
    {
      id: "T-5",
      title: "[QA] E2E export",
      description: "pww-automation suite for the export: default and filtered exports, the audit entry, and a large export on internal-apps-test.",
      priority: "medium",
      tags: ["qa", "e2e"],
      dependencies: ["T-2", "T-3", "T-4"],
      relatedFiles: ["src/test/kotlin/com/plexus/pww/agreements/AgreementExportTest.kt"],
      acceptanceCriteria: [
        { id: "AC-1", text: "A Legal user exports the default view with one row per agreement version" },
        { id: "AC-2", text: "A filtered export contains only the filtered rows" },
        { id: "AC-3", text: "Each export writes an audit entry" },
        { id: "AC-4", text: "An export of 120,000 rows completes" },
      ],
      epic: EXPORT_EPIC,
      type: "task",
      repo: "pww-automation",
      size: "S",
      wave: 3,
      traces: ["BR-1", "BR-3", "BR-4", "FR1", "FR3", "FR4"],
    },
  ],
  report: {
    assumptions: [
      "The figures export reuses the AGR coverage query; the ambassador list behind them (BR-2) streams from read-only, keyset-paginated reads over CustomerAgreement (AAD FR2), with no schema change.",
      "api-gateway keeps its 30 s timeout (BRD Q3, DV-6120); large exports stream so the first byte leaves well inside it rather than becoming an asynchronous job.",
      "Legal/Compliance membership is the Okta group Legal-Compliance, as decided for AGR T-7.",
    ],
    openQuestions: ["BRD Q5: are Spanish CSV headers (BR-7, candidate) needed at launch for es-US? T-2 AC-5 depends on it."],
    uncovered: [],
    risks: [
      "Exports near the row cap may still approach the gateway timeout on a cold database; T-4 measures a 120,000-row export.",
      "Audit entries are written by the portal; an export triggered by calling the API directly is not audited.",
    ],
  },
};
