import "server-only";
/**
 * qa-verify content: the test plan, the automated runs (unit / api / e2e), the manual browser
 * session and the evidence items, per task and attempt. LCE CP-52202 follows brief F.6 exactly;
 * LCE CP-52204 fails its large-export run on attempt 1 and passes after the loop-back; every
 * other task gets specific-looking evidence built from its acceptance criteria and repo.
 */
import type { EvidenceDraft } from "@/lib/weft/workflows";
import { clip, lowerFirst, mmss, shortSha, stripScope } from "@/server/mock/workflows/delivery-lib/util";
import { EVIDENCE_MEDIA, type EvidenceMediaName } from "./evidence-media";
import { DELIVERY_PACK_PROJECTS, taskImplFor } from "./index";
import { AGREEMENTS, projectDomain, type Domain } from "./templates/domain";
import { countTests, repoKind } from "./templates/repos";
import type { QaScenario, RunTask } from "./types";

export interface QaRun {
  command: string;
  exitCode: number;
  output: string;
  counts: { passed: number; failed: number; skipped: number };
  summary: string;
}

export interface QaPack {
  underTest: { host: string; build: string };
  baseline: { host: string; build: string };
  account: string;
  plan: QaScenario[];
  risks: string[];
  unit: QaRun;
  api: QaRun;
  e2e: QaRun;
  /** One sentence the report's "Claim + timeline" block opens with. */
  claim: string;
  /** "Backend: 200 GET … · 1.2 s" line under the timeline. */
  backend: string;
  evidence: EvidenceDraft[];
  /** Bug lines to suggest when criteria fail (the reviewer decides). */
  bugs: string[];
  regression: string[];
}

const BASELINE_BUILD = "2026.09.24-3f1a9c2";

function media(name: EvidenceMediaName): { url: string; sizeBytes: number; mediaType: string; durationSec?: number } {
  const m = EVIDENCE_MEDIA[name];
  return { url: m.url, sizeBytes: m.sizeBytes, mediaType: m.mediaType, ...("durationSec" in m ? { durationSec: m.durationSec } : {}) };
}

/** The branch head QA tests: a re-test after a loop-back runs on the new commit, not the first one. */
function buildOf(task: RunTask, attempt = 1): string {
  return `${task.branch}@${shortSha(attempt > 1 ? `${task.branch}#${attempt}` : task.branch)}`;
}

/** The vocabulary the task's code was written in (see taskImplFor). */
function domainOf(projectId: string): Domain {
  return (DELIVERY_PACK_PROJECTS as readonly string[]).includes(projectId) ? AGREEMENTS : projectDomain(projectId);
}

function all(task: RunTask, result: "pass" | "fail" | "inconclusive", detail?: string) {
  return task.acceptanceCriteria.map((ac) => ({ criterionId: ac.id, result, ...(detail ? { detail } : {}) }));
}

// ---------------------------------------------------------------------------------------------
// LCE CP-52202: "Export CSV" button (brief F.6)
// ---------------------------------------------------------------------------------------------

function cp52202(task: RunTask, env: string): QaPack {
  const key = task.jiraKey ?? task.id;
  const after = { host: "preview/feature-CP-52202-export-csv", build: "feature-CP-52202-export-csv@8d41e07" };
  const base = { environment: env, build: after.build };
  const unitCmd = "pnpm nx test website-customer-portal --testFile=agreement-export.spec.ts";
  const unitOut = ` PASS  apps/website-customer-portal/src/app/agreements/agreement-progress/agreement-progress.export.spec.ts
  AgreementProgressComponent export (${key})
    ✓ AC-1: shows Export CSV to Legal users (41 ms)
    ✓ AC-2: downloads the current view with its filters (28 ms)
    ✓ AC-4: hides Export CSV from users outside Legal/Compliance (19 ms)
    ✓ AC-5: sends the user locale for localized headers (22 ms)
 PASS  apps/website-customer-portal/src/app/agreements/agreement-progress/agreement-progress.component.spec.ts
 PASS  apps/website-customer-portal/src/app/agreements/agreement-export.spec.ts

Test Suites: 3 passed, 3 total
Tests: 18 passed, 18 total
Time:        6.214 s`;
  const e2eCmd = "./gradlew test --tests 'com.plexus.pww.agreements.AgreementExportTest' -Denv=internal-apps-test";
  const e2eOut = `AgreementExportTest > legalUserSeesExportButton() PASSED (2.4s)
AgreementExportTest > exportDownloadsCsvWithFilters() PASSED (5.1s)
AgreementExportTest > csvColumnsMatchTable() PASSED (1.8s)
AgreementExportTest > nonLegalUserCannotSeeExport() PASSED (2.2s)
AgreementExportTest > exportsLocalizedHeaders_esUS() SKIPPED (es-US content not published on internal-apps-test)

4 tests completed, 0 failed, 1 skipped
BUILD SUCCESSFUL in 38s`;
  const netLog = `14:02:11.204  GET  /v1/agreements/coverage?agreementTypeId=101&version=2026.2   200  182 ms
14:02:19.883  GET  /v1/agreements/coverage/export?format=csv&agreementTypeId=101&version=2026.2&locale=en-US   200  1.2 s
              content-type: text/csv; charset=utf-8
              content-disposition: attachment; filename="agreement-coverage-2026-09-29.csv"
              x-export-rows: 1
14:02:20.019  POST /v1/audit/entries   201  38 ms`;
  const rows = [
    { agreementTypeId: 101, version: "2026.2", requiredCount: 48212, acceptedCount: 44903, coveragePercent: 93.1 },
    { agreementTypeId: 102, version: "2026.1", requiredCount: 48212, acceptedCount: 45870, coveragePercent: 95.1 },
    { agreementTypeId: 103, version: "2026.3", requiredCount: 48212, acceptedCount: 39118, coveragePercent: 81.1 },
  ];
  const video = media("CP-52202-before-after.mp4");
  const evidence: EvidenceDraft[] = [
    {
      kind: "video",
      title: "Before/after take: Export CSV on Agreement Progress",
      mediaType: "video/mp4",
      url: video.url,
      // The real take is 6.8 MB / 01:42 (brief F.6); the placeholder file is a low-bitrate stand-in.
      sizeBytes: 6_800_000,
      durationSec: 102,
      ...base,
      mode: "manual",
      testLevel: "manual",
      result: "pass",
      criterionResults: [
        { criterionId: "AC-1", result: "pass", detail: "Button visible at 00:19 on the branch preview only" },
        { criterionId: "AC-2", result: "pass", detail: "agreement-coverage-2026-09-29.csv downloaded at 00:41" },
        { criterionId: "AC-4", result: "pass", detail: "qa-support-01 sees no button at 01:10 (parity)" },
      ],
      segments: [
        { label: "BEFORE", host: env, build: BASELINE_BUILD },
        { label: "AFTER", host: after.host, build: after.build },
      ],
      timeline: [
        { t: "00:04", text: "Open Agreement Progress as a Legal user" },
        { t: "00:19", text: "Export CSV button visible (AFTER only)" },
        { t: "00:41", text: "agreement-coverage-2026-09-29.csv downloaded" },
        { t: "01:10", text: "Non-Legal user: button hidden (parity)" },
      ],
    },
    {
      kind: "contact-sheet",
      title: "Contact sheet: before/after take, 6 stills",
      ...media("CP-52202-contact-sheet.png"),
      ...base,
      mode: "manual",
      testLevel: "manual",
      result: "pass",
      criterionResults: [
        { criterionId: "AC-1", result: "pass" },
        { criterionId: "AC-2", result: "pass" },
        { criterionId: "AC-4", result: "pass" },
      ],
    },
    {
      kind: "screenshot",
      title: "Export CSV button visible to a Legal user",
      ...media("CP-52202-01-button.png"),
      ...base,
      mode: "manual",
      testLevel: "manual",
      result: "pass",
      criterionResults: [{ criterionId: "AC-1", result: "pass" }],
    },
    {
      kind: "screenshot",
      title: "agreement-coverage-2026-09-29.csv downloaded",
      ...media("CP-52202-02-download.png"),
      ...base,
      mode: "manual",
      testLevel: "manual",
      result: "pass",
      criterionResults: [{ criterionId: "AC-2", result: "pass" }],
    },
    {
      kind: "screenshot",
      title: "Non-Legal user: Export CSV hidden",
      ...media("CP-52202-03-nonlegal-hidden.png"),
      ...base,
      mode: "manual",
      testLevel: "manual",
      result: "pass",
      criterionResults: [{ criterionId: "AC-4", result: "pass" }],
    },
    {
      kind: "command-output",
      title: "Unit tests: agreement export",
      mediaType: "text/plain",
      ...base,
      mode: "automated",
      testLevel: "unit",
      result: "pass",
      command: unitCmd,
      exitCode: 0,
      excerpt: unitOut,
      counts: { passed: 18, failed: 0, skipped: 0 },
      criterionResults: [
        { criterionId: "AC-1", result: "pass" },
        { criterionId: "AC-2", result: "pass" },
        { criterionId: "AC-4", result: "pass" },
        { criterionId: "AC-5", result: "inconclusive", detail: "The request carries locale=es-US; header translation is not visible to unit tests" },
      ],
    },
    {
      kind: "test-report",
      title: "pww-automation AgreementExportTest (Playwright/Kotlin)",
      mediaType: "text/plain",
      ...base,
      mode: "automated",
      testLevel: "e2e",
      result: "pass",
      command: e2eCmd,
      exitCode: 0,
      excerpt: e2eOut,
      counts: { passed: 4, failed: 0, skipped: 1 },
      criterionResults: [
        { criterionId: "AC-1", result: "pass" },
        { criterionId: "AC-2", result: "pass" },
        { criterionId: "AC-3", result: "pass" },
        { criterionId: "AC-4", result: "pass" },
        { criterionId: "AC-5", result: "inconclusive", detail: "exportsLocalizedHeaders_esUS skipped: es-US content not published on internal-apps-test" },
      ],
    },
    {
      kind: "log",
      title: "Network: 200 GET /v1/agreements/coverage/export?format=csv · 1.2 s",
      mediaType: "text/plain",
      ...base,
      mode: "automated",
      testLevel: "api",
      result: "pass",
      command: "HAR capture from the manual session (network panel)",
      excerpt: netLog,
      criterionResults: [{ criterionId: "AC-2", result: "pass", detail: "text/csv attachment, filters forwarded" }],
    },
    {
      kind: "data",
      title: "First 3 CSV rows (agreement-coverage-2026-09-29.csv, unfiltered export)",
      mediaType: "application/json",
      ...base,
      mode: "manual",
      testLevel: "manual",
      result: "pass",
      data: rows,
      criterionResults: [{ criterionId: "AC-3", result: "pass", detail: "Columns and figures match the on-screen table" }],
    },
    {
      kind: "log",
      title: "Localization: CSV header in es-US",
      mediaType: "text/plain",
      ...base,
      mode: "manual",
      testLevel: "manual",
      result: "inconclusive",
      excerpt: `locale=es-US  GET /v1/agreements/coverage/export?format=csv&locale=es-US  200  1.1 s
header: agreementTypeId,description,version,countryCode,stateProvince,requiredCount,acceptedCount,notAcceptedCount,coveragePercent,asOf
Contentful (internal-apps-test): key reports.coverage.csv.headers has no es-US entry; the service fell back to en-US.
Cannot tell whether es-US headers are expected at launch (BRD Q5).`,
      criterionResults: [{ criterionId: "AC-5", result: "inconclusive", detail: "Headers came back in English; es-US translations are not published on internal-apps-test" }],
    },
  ];
  return {
    underTest: after,
    baseline: { host: env, build: BASELINE_BUILD },
    account: "qa-legal-01 (Legal-Compliance), qa-support-01 (Customer Support)",
    plan: [
      { scenario: "Legal user sees Export CSV", steps: ["Sign in to internal-apps-test as qa-legal-01 (Legal-Compliance)", "Open Agreement Progress on the branch preview"], expected: "An Export CSV button is shown next to the filters" },
      { scenario: "Export downloads the current view", steps: ["Filter by Brand Ambassador Agreement, version 2026.2", "Click Export CSV"], expected: "agreement-coverage-2026-09-29.csv downloads with only the filtered rows" },
      { scenario: "CSV columns match the table", steps: ["Export the unfiltered view", "Compare the header and first rows with the on-screen table"], expected: "Same columns in the same order, same figures" },
      { scenario: "Non-Legal user", steps: ["Sign in as qa-support-01 (Customer Support)", "Open Agreement Progress"], expected: "No Export CSV button; the rest of the page is unchanged" },
      { scenario: "es-US headers", steps: ["Switch the user locale to es-US", "Export the unfiltered view"], expected: "CSV headers are localized for es-US" },
      { scenario: "Baseline has no export (BEFORE)", steps: ["Open Agreement Progress on internal-apps-test build 2026.09.24-3f1a9c2 as qa-legal-01"], expected: "No Export CSV button, proving the change is the branch's" },
    ],
    risks: [
      "es-US translations for the CSV headers are not published on internal-apps-test; AC-5 may be untestable there.",
      "Large exports are covered by CP-52204, not by this task.",
    ],
    unit: { command: unitCmd, exitCode: 0, output: unitOut, counts: { passed: 18, failed: 0, skipped: 0 }, summary: "18 passed, 18 total" },
    api: {
      command: "curl -sS -o export.csv -w '%{http_code} %{time_total}s' \"$GATEWAY/v1/agreements/coverage/export?format=csv\" -H \"Authorization: Bearer $QA_LEGAL_TOKEN\"",
      exitCode: 0,
      output: "200 1.21s\nexport.csv: 5 lines (header + 4 rows), text/csv; charset=utf-8",
      counts: { passed: 1, failed: 0, skipped: 0 },
      summary: "200 in 1.2 s, text/csv attachment",
    },
    e2e: { command: e2eCmd, exitCode: 0, output: e2eOut, counts: { passed: 4, failed: 0, skipped: 1 }, summary: "4 passed, 0 failed, 1 skipped" },
    claim:
      "On the branch preview a Legal user sees Export CSV on Agreement Progress and downloads agreement-coverage-2026-09-29.csv with the current filters; a non-Legal user does not see the button; the baseline build has no button.",
    backend: "Backend: 200 GET /v1/agreements/coverage/export?format=csv · 1.2 s (customer-service-v2 via api-gateway)",
    evidence,
    bugs: [],
    regression: [
      "Covered: Agreement Progress table · Legal user · unchanged · CP-52202-before-after.mp4",
      "Covered: Agreement Progress · non-Legal user · unchanged apart from the hidden button · CP-52202-03-nonlegal-hidden.png",
      "Not covered: es-US CSV headers · translations not published on internal-apps-test -> QA",
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// LCE CP-52204: large exports (fails on attempt 1, passes after the loop-back)
// ---------------------------------------------------------------------------------------------

const CP52204_BUG = "Export of more than 50k rows times out at the 30 s gateway limit";

function cp52204(task: RunTask, attempt: number, env: string): QaPack {
  const failing = attempt <= 1;
  const build = buildOf(task, attempt);
  const base = { environment: env, build };
  const unitTotal = failing ? 49 : 50;
  const unitCmd = "./gradlew test --tests 'com.plexus.customer.agreements.coverage.*' --console=plain";
  const unitOut = `CoverageExportControllerTest > AC-3: more than 250,000 rows is rejected with 413 PASSED
CoverageExportControllerTest > AC-3: the cap itself is allowed PASSED${failing ? "" : "\nCoverageExportControllerTest > AC-1: rows are written from the cursor without loading the result PASSED"}
CoverageCsvWriterTest > AC-1: header lists the coverage columns PASSED

Tests: ${unitTotal} passed, ${unitTotal} total
BUILD SUCCESSFUL in 44s`;
  const apiCmd = "curl -sS -o export.csv -w '%{http_code} %{time_total}s' \"$GATEWAY/v1/agreements/coverage/export?format=csv&dataset=large-120k\" -H \"Authorization: Bearer $QA_LEGAL_TOKEN\"";
  const apiOut = failing
    ? "504 30.00s\napi-gateway: upstream customer-service-v2 did not send a first byte within 30s (route agreement-coverage-export)"
    : "200 18.42s\nexport.csv: 120,001 lines (header + 120,000 rows), transfer-encoding: chunked, first byte after 0.6 s";
  const e2eCmd = "./gradlew test --tests 'com.plexus.pww.agreements.AgreementExportLargeTest' -Denv=internal-apps-test";
  const e2eOut = failing
    ? `AgreementExportLargeTest > exportSmallSelection() PASSED (3.2s)
AgreementExportLargeTest > exportAppliesFilters() PASSED (4.0s)
AgreementExportLargeTest > exportWritesAuditEntry() PASSED (2.6s)
AgreementExportLargeTest > exportOver50kRowsCompletes() FAILED (30.0s)
    TimeoutError: waiting for download: exceeded 30000 ms
    api-gateway responded 504 Gateway Timeout after 30.0 s (rows requested: 120,000)

4 tests completed, 1 failed
BUILD FAILED in 1m 04s`
    : `AgreementExportLargeTest > exportSmallSelection() PASSED (3.1s)
AgreementExportLargeTest > exportAppliesFilters() PASSED (3.8s)
AgreementExportLargeTest > exportWritesAuditEntry() PASSED (2.5s)
AgreementExportLargeTest > exportOver50kRowsCompletes() PASSED (18.4s)

4 tests completed, 0 failed
BUILD SUCCESSFUL in 51s`;
  const gatewayLog = failing
    ? `14:21:03.117 INFO  route=agreement-coverage-export GET /v1/agreements/coverage/export rows=120000 client=portal-bff
14:21:33.118 WARN  route=agreement-coverage-export upstream timeout after 30000 ms (no response headers)
14:21:33.119 ERROR route=agreement-coverage-export 504 Gateway Timeout request-id=7f3c2a91
customer-service-v2 14:21:41.902 INFO agreements.coverage rows=120000 loaded in 38.7 s (client already gone)`
    : `14:48:10.402 INFO  route=agreement-coverage-export GET /v1/agreements/coverage/export rows=120000 client=portal-bff
14:48:11.006 INFO  route=agreement-coverage-export first byte after 604 ms (chunked)
14:48:28.824 INFO  route=agreement-coverage-export 200 OK 9.4 MB in 18.42 s request-id=2b81d0c4`;
  const video = media("generic-session.mp4");
  const evidence: EvidenceDraft[] = [
    {
      kind: "video",
      title: failing ? "Manual session: 120,000-row export stalls and fails with 504" : "Manual session: 120,000-row export completes in 18 s",
      ...video,
      ...base,
      mode: "manual",
      testLevel: "manual",
      result: failing ? "fail" : "pass",
      criterionResults: [{ criterionId: "AC-2", result: failing ? "fail" : "pass", detail: failing ? "504 after 30.0 s" : "Download complete after 18.4 s" }],
      segments: [{ label: "AFTER", host: `preview/${task.branch}`, build }],
      timeline: failing
        ? [
            { t: "00:02", text: "Open Agreement Progress as qa-legal-01 with the large-120k dataset" },
            { t: "00:06", text: "Click Export CSV (120,000 rows)" },
            { t: "00:10", text: "No response for 30 s (cut)" },
            { t: "00:14", text: "Export failed: 504 Gateway Timeout" },
          ]
        : [
            { t: "00:02", text: "Open Agreement Progress as qa-legal-01 with the large-120k dataset" },
            { t: "00:06", text: "Click Export CSV (120,000 rows)" },
            { t: "00:10", text: "Download starts after 0.6 s (streamed)" },
            { t: "00:14", text: "agreement-coverage-2026-09-29.csv complete, 9.4 MB" },
          ],
    },
    {
      kind: "screenshot",
      title: failing ? "Export failed: 504 Gateway Timeout after 30.0 s" : "Export complete: 120,000 rows streamed in 18.4 s",
      ...media(failing ? "export-timeout.png" : "export-streaming.png"),
      ...base,
      mode: "manual",
      testLevel: "manual",
      result: failing ? "fail" : "pass",
      criterionResults: [{ criterionId: "AC-2", result: failing ? "fail" : "pass" }],
    },
    {
      kind: "screenshot",
      title: failing ? "pww-automation report: exportOver50kRowsCompletes failed" : "pww-automation report: all export scenarios passed",
      ...media(failing ? "e2e-report-failed.png" : "e2e-report.png"),
      ...base,
      mode: "manual",
      testLevel: "manual",
      result: failing ? "fail" : "pass",
      criterionResults: [{ criterionId: "AC-2", result: failing ? "fail" : "pass" }],
    },
    {
      kind: "command-output",
      title: "Unit tests: coverage export",
      mediaType: "text/plain",
      ...base,
      mode: "automated",
      testLevel: "unit",
      result: "pass",
      command: unitCmd,
      exitCode: 0,
      excerpt: unitOut,
      counts: { passed: unitTotal, failed: 0, skipped: 0 },
      criterionResults: [
        { criterionId: "AC-3", result: "pass" },
        ...(failing ? [] : [{ criterionId: "AC-1", result: "pass" as const, detail: "streamsFromTheCursor" }]),
      ],
    },
    {
      kind: "test-report",
      title: "pww-automation AgreementExportLargeTest",
      mediaType: "text/plain",
      ...base,
      mode: "automated",
      testLevel: "e2e",
      result: failing ? "fail" : "pass",
      command: e2eCmd,
      exitCode: failing ? 1 : 0,
      excerpt: e2eOut,
      counts: failing ? { passed: 3, failed: 1, skipped: 0 } : { passed: 4, failed: 0, skipped: 0 },
      criterionResults: [
        { criterionId: "AC-2", result: failing ? "fail" : "pass", detail: failing ? CP52204_BUG : "120,000 rows in 18.4 s" },
      ],
    },
    {
      kind: "log",
      title: failing ? "api-gateway: 504 after 30 s on a 120,000-row export" : "api-gateway: 200 in 18.4 s, first byte after 0.6 s",
      mediaType: "text/plain",
      ...base,
      mode: "automated",
      testLevel: "api",
      result: failing ? "fail" : "pass",
      command: apiCmd,
      exitCode: failing ? 22 : 0,
      excerpt: gatewayLog,
      criterionResults: [{ criterionId: "AC-2", result: failing ? "fail" : "pass" }],
    },
    {
      kind: "metric",
      title: failing ? "Heap during a 120,000-row export: 912 MB (budget 256 MB)" : "Heap during a 120,000-row export: 184 MB (budget 256 MB)",
      mediaType: "application/json",
      ...base,
      mode: "automated",
      testLevel: "api",
      result: failing ? "fail" : "pass",
      data: { name: "heap used (max)", actual: failing ? 912 : 184, expected: 256, unit: "MB" },
      criterionResults: [
        { criterionId: "AC-4", result: failing ? "fail" : "pass" },
        { criterionId: "AC-1", result: failing ? "fail" : "pass", detail: failing ? "Heap grows with the row count: rows are buffered before writing" : "Flat heap: rows streamed" },
      ],
    },
  ];
  return {
    underTest: { host: `preview/${task.branch}`, build },
    baseline: { host: env, build: BASELINE_BUILD },
    account: "qa-legal-01 (Legal-Compliance)",
    plan: [
      { scenario: "Small export", steps: ["Export Brand Ambassador Agreement 2026.2 as qa-legal-01"], expected: "CSV downloads in under 2 s" },
      { scenario: "Large export streams", steps: ["Select the large-120k dataset", "Export all rows", "Watch time to first byte and total time"], expected: "Download starts within a second and completes inside 30 s" },
      { scenario: "Row cap", steps: ["Request an export of 250,001 rows through the API"], expected: "413 with X-Export-Rows and a message to narrow the filters" },
      { scenario: "Memory", steps: ["Export 120,000 rows while sampling heap on customer-service-v2"], expected: "Heap stays under 256 MB" },
    ],
    risks: ["The large-120k dataset exists only on internal-apps-test; STAGE timings may differ."],
    unit: { command: unitCmd, exitCode: 0, output: unitOut, counts: { passed: unitTotal, failed: 0, skipped: 0 }, summary: `${unitTotal} passed, ${unitTotal} total` },
    api: {
      command: apiCmd,
      exitCode: failing ? 22 : 0,
      output: apiOut,
      counts: failing ? { passed: 0, failed: 1, skipped: 0 } : { passed: 1, failed: 0, skipped: 0 },
      summary: failing ? "504 after 30.0 s" : "200 in 18.4 s, streamed",
    },
    e2e: {
      command: e2eCmd,
      exitCode: failing ? 1 : 0,
      output: e2eOut,
      counts: failing ? { passed: 3, failed: 1, skipped: 0 } : { passed: 4, failed: 0, skipped: 0 },
      summary: failing ? "3 passed, 1 failed" : "4 passed, 0 failed",
    },
    claim: failing
      ? "A 120,000-row export from the branch preview fails with 504 at the 30 s gateway limit; the service buffers every row before the first byte."
      : "A 120,000-row export from the branch preview streams its first byte in 0.6 s and completes in 18.4 s with heap under 256 MB.",
    backend: failing
      ? "Backend: 504 GET /v1/agreements/coverage/export?format=csv · 30.0 s (api-gateway upstream timeout)"
      : "Backend: 200 GET /v1/agreements/coverage/export?format=csv · 18.4 s · chunked",
    evidence,
    bugs: failing ? [CP52204_BUG] : [],
    regression: ["Covered: small exports · Legal user · unchanged · AgreementExportLargeTest.exportSmallSelection"],
  };
}

// ---------------------------------------------------------------------------------------------
// Generic evidence for every other task
// ---------------------------------------------------------------------------------------------

/** Who QA signs in as, and the stills a manual session produces, for the seeded login projects. */
interface QaProfile {
  account: string;
  token: string;
  /** Stills for login-flow tasks (action, E2E) first; service tasks lead with the API response. */
  screens: EvidenceMediaName[];
  risk: string;
}

const LOGIN_RISK = "Test customers on {env} must be reset to an outstanding state before each run (pww-automation agreements fixture).";

const PROFILES: Record<string, QaProfile> = {
  "terms-gate": {
    account: "qa-ambassador-03 (Brand Ambassador), arc-support-02 (ARC)",
    token: "$TERMS_GATE_BASIC_AUTH",
    screens: ["terms-gate-modal.png", "terms-gate-modal-es.png", "api-post-login-context.png"],
    risk: LOGIN_RISK,
  },
  "policy-reacceptance": {
    account: "qa-ambassador-07 (Brand Ambassador), qa-preferred-02 (Preferred), qa-retail-05 (Retail)",
    token: "$TERMS_GATE_BASIC_AUTH",
    screens: ["privacy-reacceptance-prompt.png", "privacy-reacceptance-prompt-es.png", "api-post-login-context.png"],
    risk: LOGIN_RISK,
  },
};

const DEFAULT_PROFILE: QaProfile = {
  account: "qa-legal-01 (Legal-Compliance)",
  token: "$QA_LEGAL_TOKEN",
  screens: [],
  risk: "Figures on {env} depend on its seeded acceptance data.",
};

function screensFor(projectId: string, repo: string): EvidenceMediaName[] {
  const profile = PROFILES[projectId];
  if (profile) {
    const kind = repoKind(repo);
    return kind === "auth0" || kind === "e2e" ? profile.screens : ["api-post-login-context.png", profile.screens[0]];
  }
  switch (repoKind(repo)) {
    case "angular":
      return ["agreement-progress-page.png", "agreement-progress-filters.png", "agreement-progress-flag-off.png"];
    case "e2e":
      return ["e2e-report.png", "agreement-progress-page.png"];
    case "contracts":
      return ["api-response.png", "e2e-report.png"];
    default:
      return ["api-response.png", "agreement-progress-page.png"];
  }
}

const SCREEN_TITLES: Partial<Record<EvidenceMediaName, string>> = {
  "agreement-progress-page.png": "Page on the branch preview with live figures",
  "agreement-progress-filters.png": "Filter applied: Brand Ambassador Agreement 2026.2",
  "agreement-progress-flag-off.png": "Flag off: page not available",
  "api-response.png": "API response on internal-apps-test",
  "api-post-login-context.png": "GET /v1/sso/post-login-context on internal-apps-test",
  "e2e-report.png": "pww-automation run report",
  "privacy-reacceptance-prompt.png": "Privacy Policy re-acceptance prompt at login",
  "terms-gate-modal.png": "Agreement acceptance form after login",
  "terms-gate-modal-es.png": "Agreement acceptance form in Spanish (es-US session)",
  "privacy-reacceptance-prompt-es.png": "Privacy Policy prompt in Spanish (es-US session)",
  "audit-log-entry.png": "Audit log: agreement.coverage.export entries",
};

function unitCommand(repo: string): string {
  switch (repoKind(repo)) {
    case "angular":
      return `pnpm nx test ${repo}`;
    case "gateway":
      return "pnpm test -- routes";
    case "contracts":
      return "pnpm test";
    case "auth0":
      return "pnpm test -- actions/post-login";
    default:
      return "./gradlew test --console=plain";
  }
}

/** A plausible response for the endpoint a task touches (the first rows of it). */
function apiData(route: string, d: Domain): Record<string, unknown> {
  if (route.includes("post-login-context")) {
    return { customerId: 2081544, customerTypeId: 1, gateEnabled: true, outstandingAgreements: [{ agreementTypeId: 103, key: "privacy-policy", version: "2026.3" }] };
  }
  if (route.includes("webhooks")) return { status: "provisioned", agreementKey: "privacy-policy", version: "2026.3" };
  return {
    asOf: "2026-09-29T13:58:04Z",
    items: [
      { [d.idParam]: 101, description: d.samples[0], version: "2026.2", [d.total]: 48212, [d.done]: 44903, [d.open]: 3309, [d.pct]: 93.1 },
      { [d.idParam]: 102, description: d.samples[1], version: "2026.1", [d.total]: 48212, [d.done]: 45870, [d.open]: 2342, [d.pct]: 95.1 },
    ],
  };
}

function apiBody(route: string, d: Domain): string {
  const data = apiData(route, d);
  if (!Array.isArray(data.items)) return JSON.stringify(data);
  return `${JSON.stringify({ ...data, items: data.items.slice(0, 1) }).replace(/\]\}$/, ", …]}")}`;
}

function genericQa(projectId: string, task: RunTask, env: string, attempt = 1): QaPack {
  const build = buildOf(task, attempt);
  const d = domainOf(projectId);
  const base = { environment: env, build };
  const kind = repoKind(task.repo);
  const profile = PROFILES[projectId] ?? DEFAULT_PROFILE;
  const firstAccount = profile.account.split(" ")[0];
  const impl = taskImplFor(projectId, task);
  const newTests = countTests(impl.files.map((f) => ({ path: f.path, content: f.after })));
  const total = impl.baseTests + newTests;
  const title = stripScope(task.title);
  const acs = task.acceptanceCriteria;
  const route = /\/v1\/[\w/-]+/.exec(impl.files.map((f) => f.after ?? "").join("\n"))?.[0] ?? "/v1/agreements/coverage";
  const unitCmd = unitCommand(task.repo);
  const unitOut =
    kind === "angular" || kind === "gateway" || kind === "contracts" || kind === "auth0"
      ? `${Object.entries(impl.acCoverage)
          .slice(0, 4)
          .map(([ac, t]) => `    ✓ ${ac}: ${clip(t.split(" › ").pop() ?? t, 70)}`)
          .join("\n")}

Test Suites: ${impl.suites ?? 12} passed, ${impl.suites ?? 12} total
Tests: ${total} passed, ${total} total`
      : `${Object.entries(impl.acCoverage)
          .slice(0, 4)
          .map(([ac, t]) => `${clip(t, 70)} (${ac}) PASSED`)
          .join("\n")}

Tests: ${total} passed, ${total} total
BUILD SUCCESSFUL in 39s`;
  const e2eName = kind === "e2e" ? (/(\w+Test)\.kt$/.exec(impl.primaryFile)?.[1] ?? "AgreementsSuiteTest") : "AgreementsSmokeTest";
  const e2eCmd = `./gradlew test --tests 'com.plexus.pww.agreements.${e2eName}' -Denv=${env}`;
  const e2eCases = acs.slice(0, 4).map((ac) => `${e2eName} > ${ac.id.toLowerCase().replace("-", "")}_${clip(ac.text, 40).replace(/[^A-Za-z0-9]+/g, "_")}() PASSED`);
  const e2eOut = `${e2eCases.join("\n")}\n\n${e2eCases.length} tests completed, 0 failed\nBUILD SUCCESSFUL in 44s`;
  const auth = profile.token.startsWith("$QA_") ? `Bearer ${profile.token}` : `Basic ${profile.token}`;
  const apiCmd = `curl -sS -w '%{http_code} %{time_total}s' "$GATEWAY${route}" -H "Authorization: ${auth}"`;
  const apiOut = `200 0.19s\ncontent-type: application/json\n${apiBody(route, d)}`;
  const service = kind === "java" ? task.repo : "customer-service-v2";
  // An API, service or contract task also records what the endpoint returned, as data.
  const dataItem: EvidenceDraft[] =
    kind === "java" || kind === "gateway" || kind === "contracts"
      ? [
          {
            kind: "data",
            title: `Response body: GET ${route} on ${env}`,
            mediaType: "application/json",
            ...base,
            mode: "automated",
            testLevel: "api",
            result: "pass",
            command: apiCmd,
            data: apiData(route, d),
            criterionResults: acs.length ? [{ criterionId: acs[0].id, result: "pass", detail: "Fields and figures as the contract describes" }] : [],
          },
        ]
      : [];
  const screens = screensFor(projectId, task.repo).slice(0, kind === "angular" || kind === "auth0" ? 3 : 2);
  const video = media("generic-session.mp4");
  const timeline = acs.slice(0, 4).map((ac, i) => ({ t: mmss(2 + i * 4), text: clip(ac.text, 70) }));
  const evidence: EvidenceDraft[] = [
    {
      kind: "video",
      title: `Manual session: ${clip(title, 70)}`,
      ...video,
      ...base,
      mode: "manual",
      testLevel: "manual",
      result: "pass",
      criterionResults: acs.slice(0, 3).map((ac) => ({ criterionId: ac.id, result: "pass" as const })),
      segments: [
        { label: "AFTER", host: `preview/${task.branch}`, build },
        { label: "PARITY", host: env, build: BASELINE_BUILD },
      ],
      timeline,
    },
    ...screens.map((s, i): EvidenceDraft => ({
      kind: "screenshot",
      title: SCREEN_TITLES[s] ?? s,
      ...media(s),
      ...base,
      mode: "manual",
      testLevel: "manual",
      result: "pass",
      criterionResults: acs.length ? [{ criterionId: acs[i % acs.length].id, result: "pass" }] : [],
    })),
    {
      kind: "command-output",
      title: `Unit tests: ${task.repo}`,
      mediaType: "text/plain",
      ...base,
      mode: "automated",
      testLevel: "unit",
      result: "pass",
      command: unitCmd,
      exitCode: 0,
      excerpt: unitOut,
      counts: { passed: total, failed: 0, skipped: 0 },
      criterionResults: all(task, "pass"),
    },
    {
      kind: "test-report",
      title: `pww-automation ${e2eName}`,
      mediaType: "text/plain",
      ...base,
      mode: "automated",
      testLevel: "e2e",
      result: "pass",
      command: e2eCmd,
      exitCode: 0,
      excerpt: e2eOut,
      counts: { passed: e2eCases.length, failed: 0, skipped: 0 },
      criterionResults: acs.slice(0, 4).map((ac) => ({ criterionId: ac.id, result: "pass" as const })),
    },
    {
      kind: "log",
      title: `Service log: GET ${route} · 190 ms`,
      mediaType: "text/plain",
      ...base,
      mode: "automated",
      testLevel: "api",
      result: "pass",
      command: apiCmd,
      exitCode: 0,
      // In time order: the service answers first, the gateway logs the response when it returns.
      excerpt: `14:10:02.109 INFO  ${service} ${route} rows=4 query=141 ms
14:10:02.110 DEBUG ${service} hikari pool active=2 idle=18
14:10:02.114 INFO  api-gateway route=${route} 200 190 ms request-id=5d1e9b20`,
      criterionResults: acs.length ? [{ criterionId: acs[0].id, result: "pass" }] : [],
    },
    ...dataItem,
  ];
  return {
    underTest: { host: `preview/${task.branch}`, build },
    baseline: { host: env, build: BASELINE_BUILD },
    account: profile.account,
    plan: [
      ...acs.map((ac) => ({
        scenario: clip(ac.text, 60),
        steps:
          kind === "angular"
            ? [`Sign in to ${env} as ${firstAccount}`, "Open the page on the branch preview", `Check: ${clip(ac.text, 80)}`]
            : kind === "auth0"
              ? [`Sign in through Universal Login on the ${env} tenant as ${firstAccount}`, `Check: ${clip(ac.text, 80)}`]
              : kind === "e2e"
                ? [`Run ${e2eName} against ${env}`, `Inspect the scenario for ${ac.id}`]
                : [`Call ${route} on ${env} as ${firstAccount}`, `Check: ${clip(ac.text, 80)}`],
        expected: ac.text,
      })),
      { scenario: "Parity: untouched surfaces", steps: [`Open the same surface on ${env} build ${BASELINE_BUILD}`], expected: "Behaves as before apart from this change" },
    ],
    risks: [projectId === "agreement-reporting" ? `Figures on ${env} depend on its seeded acceptance data (AAD Q10).` : profile.risk.replace("{env}", env)],
    unit: { command: unitCmd, exitCode: 0, output: unitOut, counts: { passed: total, failed: 0, skipped: 0 }, summary: `${total} passed, ${total} total` },
    api: { command: apiCmd, exitCode: 0, output: apiOut, counts: { passed: 1, failed: 0, skipped: 0 }, summary: `200 in 0.19 s` },
    e2e: { command: e2eCmd, exitCode: 0, output: e2eOut, counts: { passed: e2eCases.length, failed: 0, skipped: 0 }, summary: `${e2eCases.length} passed, 0 failed` },
    claim: `On the branch preview, ${clip(lowerFirst(acs[0]?.text ?? title), 140)}; untouched surfaces behave as on ${env}.`,
    backend: `Backend: 200 GET ${route} · 190 ms`,
    evidence,
    bugs: [],
    regression: [`Covered: ${title} · ${firstAccount} · unchanged elsewhere · generic-session.mp4`],
  };
}


export function qaPackFor(projectId: string, task: RunTask, attempt: number, environment: string): QaPack {
  const title = stripScope(task.title).toLowerCase();
  if (projectId === "compliance-export" && task.id === "T-2" && title.includes("export csv")) return cp52202(task, environment);
  if (projectId === "compliance-export" && task.id === "T-4" && title.includes("streaming")) return cp52204(task, attempt, environment);
  return genericQa(projectId, task, environment, attempt);
}
