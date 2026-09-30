import "server-only";
/**
 * Renders an AAD in the architect-aad SKILL.md template, in the section order of the real
 * po-workspace/aad/aad.md: revision and acceptance tables, Overview, existing functionality,
 * the Functional Requirements table traced "[B1 §Requirements n]", Design with a Mermaid
 * flowchart plus the system change table, sequence diagrams with failure branches, and the rest
 * of the template down to the Open Questions and Sources appendices. Parts a spec leaves out get
 * conservative defaults that say what no source states, and are reported as missing.
 */
import type { AadReport } from "@/lib/delivery/types";
import { cell, isoDate } from "@/server/mock/workflows/lib/text";
import type { DocResult } from "../types";
import type { QuestionSpec } from "./brd";
import { Cites } from "./cites";

export type SystemKind = "host" | "service" | "gateway" | "db" | "identity" | "flag" | "external" | "other";

export interface AadSystem {
  name: string;
  role: string;
  /** "Proposed", "No change", "Proposed, read-only", "Explicitly not used", "Option 2 only", … */
  status: string;
  change: string;
  kind?: SystemKind;
}

export interface AadFrSpec {
  /** BRD requirement number this FR traces to; null for a design-only FR. */
  br: number | null;
  text: string;
  design: string;
  candidate?: boolean;
}

export interface AadSpec {
  title: string;
  revisionPurpose: string;
  acceptanceNotes?: Record<string, string>;
  extraDepartments?: Array<{ name: string; note: string }>;
  scope: string[];
  successCriteria: string[];
  inScope: string[];
  audience?: string;
  problem: string[];
  systems: AadSystem[];
  existing: string[];
  frs: AadFrSpec[];
  failure: string[];
  nfrs: Array<{ name: string; text: string }>;
  assumptions: string[];
  prerequisites: string[];
  logical: string[];
  tradeoffs?: Array<{ title: string; body: string[] }>;
  process: Array<{ name: string; steps: string[] }>;
  flowchart?: string;
  dataFlow?: Array<{ from: string; to: string; data: string; direction: string }>;
  topology?: string[];
  sequences?: Array<{ title: string; mermaid: string }>;
  /** Who uses the host surface, for generated diagrams. */
  actor?: string;
  impact?: { known?: string; unknown?: string[]; performance?: string; revenue?: string };
  tests?: Partial<Record<"unit" | "integration" | "api" | "performance" | "functional" | "environments" | "tools", string>>;
  monitoring?: { logging?: string; monitoring?: string; traceability?: string; metrics?: string[]; alerting?: string[] };
  delivery: string[];
  security?: { model?: string; risks?: Array<{ risk: string; mitigation: string }>; pentest?: string; hardening?: string; sast?: string; dast?: string };
  compliance: string[];
  maintainers?: Array<{ part: string; team: string }>;
  data?: {
    items?: Array<{ data: string; change: string }>;
    classification?: Array<{ data: string; category: string; notes: string }>;
    models?: Array<{ name: string; columns: Array<[string, string, string]> }>;
  };
  outOfScope: string[];
  questions: QuestionSpec[];
}

export interface AadReportSpec {
  decisionsNeeded: string[];
  conflicts: string[];
  ignoredInstructions: string[];
  changes: string[];
  /** Overrides the untraced list derived from candidate FRs. */
  untraced?: string[];
}

const DEPARTMENTS = [
  "Enterprise Architecture",
  "Product Engineering",
  "Data Engineering",
  "DevOps",
  "Marketing",
  "Sales",
  "Product Management/Owner",
  "Quality Assurance",
  "Security Engineering/Compliance",
  "IT Operations",
  "Business Systems Analysis",
];

export function systemKind(s: AadSystem): SystemKind {
  if (s.kind) return s.kind;
  const n = s.name.toLowerCase();
  if (/portal|website|my ?account|monoreact|backoffice|app\b|page/.test(n)) return "host";
  if (/gateway/.test(n)) return "gateway";
  if (/database|thatotherguy|plexussync|\bdb\b|table/.test(n)) return "db";
  if (/okta|auth0/.test(n)) return "identity";
  if (/launchdarkly/.test(n)) return "flag";
  if (/contentful|bi platform|exigo|provider|dynatrace|kafka/.test(n)) return "external";
  if (/service|api/.test(n)) return "service";
  return "other";
}

function nodeId(name: string, i: number): string {
  const base = name.replace(/[^A-Za-z0-9]/g, "").slice(0, 10) || "N";
  return `${base}${i}`;
}

function inactive(status: string): boolean {
  return /not used|option 2 only/i.test(status);
}

/** A Mermaid flowchart from the system list: actor → identity → host → gateway → services → data. */
export function defaultFlowchart(spec: AadSpec): string {
  const systems = spec.systems.filter((s) => systemKind(s) !== "flag" && !/not used/i.test(s.status));
  const ids = new Map(systems.map((s, i) => [s.name, nodeId(s.name, i)]));
  const label = (s: AadSystem) => `${s.name}<br/>(${/no change/i.test(s.status) ? "existing, unchanged" : s.status.toLowerCase()})`;
  const lines = ["flowchart TB", `    User["${spec.actor ?? "Internal user"}"]`];
  for (const s of systems) {
    const id = ids.get(s.name)!;
    lines.push(systemKind(s) === "db" ? `    ${id}[("${label(s)}")]` : `    ${id}["${label(s)}"]`);
  }
  const of = (k: SystemKind) => systems.filter((s) => systemKind(s) === k);
  const hosts = of("host");
  const identity = of("identity");
  const gateways = of("gateway");
  const services = of("service");
  const dbs = of("db");
  const host = hosts[0];
  lines.push("");
  if (identity[0] && host) lines.push(`    User --> ${ids.get(identity[0].name)} --> ${ids.get(host.name)}`);
  else if (host) lines.push(`    User --> ${ids.get(host.name)}`);
  for (const h of hosts.slice(1)) lines.push(`    User --> ${ids.get(h.name)}`);
  const front = gateways[0] ?? undefined;
  for (const h of hosts) {
    if (front) lines.push(`    ${ids.get(h.name)} --> ${ids.get(front.name)}`);
    else for (const s of services) lines.push(`    ${ids.get(h.name)} ${inactive(s.status) ? "-.->" : "-->"} ${ids.get(s.name)}`);
  }
  if (front) for (const s of services) lines.push(`    ${ids.get(front.name)} ${inactive(s.status) ? "-.->" : "-->"} ${ids.get(s.name)}`);
  const owners = services.length > 0 ? services : hosts;
  for (const d of dbs) for (const s of owners.slice(0, 2)) lines.push(`    ${ids.get(s.name)} ${/read-only|no change/i.test(d.status) ? "-->" : "-->"} ${ids.get(d.name)}`);
  for (const e of of("external").concat(of("other"))) {
    const from = owners[0] ?? host;
    if (from) lines.push(`    ${ids.get(from.name)} -.-> ${ids.get(e.name)}`);
  }
  return lines.join("\n");
}

function participants(spec: AadSpec) {
  const pick = (k: SystemKind) => spec.systems.find((s) => systemKind(s) === k && !inactive(s.status));
  return { host: pick("host"), gateway: pick("gateway"), service: pick("service"), db: pick("db") };
}

/** One sequence diagram per process flow, each with a failure branch. */
export function defaultSequences(spec: AadSpec): Array<{ title: string; mermaid: string }> {
  const p = participants(spec);
  const host = p.host?.name ?? "Client";
  const service = p.service?.name ?? p.host?.name ?? "Service";
  return spec.process.slice(0, 2).map((flow) => {
    const lines = ["sequenceDiagram", `    actor U as ${spec.actor ?? "User"}`, `    participant H as ${host}`];
    if (p.gateway) lines.push(`    participant G as ${p.gateway.name}`);
    lines.push(`    participant S as ${service}`);
    if (p.db) lines.push(`    participant D as ${p.db.name}`);
    lines.push(`    U->>H: ${flow.name}`);
    if (p.gateway) {
      lines.push("    H->>G: authenticated request", "    G->>S: forward");
    } else {
      lines.push("    H->>S: authenticated request");
    }
    if (p.db) lines.push("    S->>D: bounded, indexed query", "    D-->>S: rows");
    lines.push(`    S-->>${p.gateway ? "G" : "H"}: result`);
    if (p.gateway) lines.push("    G-->>H: result");
    lines.push("    H-->>U: render with as-of time");
    lines.push(`    alt ${service} fails or times out`);
    lines.push(`        S-->>${p.gateway ? "G" : "H"}: error`);
    lines.push("        H-->>U: explicit error state, no partial data");
    lines.push("    end");
    return { title: flow.name, mermaid: lines.join("\n") };
  });
}

function bullets(items: readonly string[]): string {
  return items.map((i) => `- ${i}`).join("\n");
}

function numbered(items: readonly string[]): string {
  return items.map((s, i) => `${i + 1}. ${s}`).join("\n");
}

const DEFAULT_TESTS = {
  unit: "Service logic, query builders and view components, with the standing JUnit 5 / Mockito stack on the Java side and the app's own unit test runner on the web side [M Integration conventions].",
  integration: "The owning service against a real database schema with Testcontainers; contract tests against the api-contracts OpenAPI spec [M Integration conventions].",
  api: "API automation in the pww-automation repository covering the new endpoints, authorization failures and empty results [M Integration conventions].",
  performance: "A load test of the new read path at the expected peak, checking p95 latency and database load before the flag is widened.",
  functional: "End-to-end checks of each BRD requirement on the internal-apps-test environment behind the feature flag, including the failure states.",
  environments: "DEV → TEST → STAGE → PROD, with database changes promoted ahead of the consuming service [M Integration conventions]. Which environment holds representative data is an open question.",
  tools: "JUnit 5, Mockito, Testcontainers, JaCoCo, SonarCloud, Snyk, Cucumber, Swagger; pww-automation for API and E2E [M Integration conventions].",
};

export function renderAad(spec: AadSpec, cites: Cites): { content: string; defaults: Set<string> } {
  const defaults = new Set<string>();
  const now = isoDate(cites.ctx.now);
  const def = <T>(value: T | undefined, fallback: T, name: string): T => {
    if (value === undefined || (Array.isArray(value) && value.length === 0)) {
      defaults.add(name);
      return fallback;
    }
    return value;
  };

  const notes = spec.acceptanceNotes ?? {};
  const acceptance = [
    "| Department | Representative | Approval Status (NOT APPROVED / CONDITIONAL / APPROVED) | Notes |",
    "| --- | --- | --- | --- |",
    ...DEPARTMENTS.map((d) => `| ${d} | | | ${cell(notes[d] ?? "")} |`),
    ...(spec.extraDepartments ?? []).map((d) => `| ${d.name} | | | ${cell(d.note)} |`),
  ];

  const frRows = spec.frs.map((fr, i) => {
    const trace = fr.br === null ? "—" : `[B1 §Requirements ${fr.br}${fr.candidate ? " (candidate)" : ""}]`;
    const text = fr.candidate ? `*(Candidate, BRD ${fr.br})* ${fr.text}` : fr.text;
    return `| FR${i + 1} | ${cell(text)} | ${trace} | ${cell(fr.design)} |`;
  });

  const tradeoffs = (spec.tradeoffs ?? []).flatMap((t) => ["", `#### Tradeoff: ${t.title}`, "", t.body.join("\n\n")]);
  const process = spec.process.flatMap((f, i) => ["", `**Flow ${i + 1}: ${f.name}**`, "", numbered(f.steps)]);
  const flowchart = spec.flowchart ?? defaultFlowchart(spec);
  const changeTable = [
    "| System | Change type | Change |",
    "| --- | --- | --- |",
    ...spec.systems.map((s) => `| ${cell(s.name)} | **${cell(s.status)}** | ${cell(s.change)} |`),
  ];

  const p = participants(spec);
  const dataFlow = def(
    spec.dataFlow,
    [
      ...(p.db && p.service ? [{ from: p.db.name, to: p.service.name, data: "Rows the new read path aggregates or returns", direction: "read" }] : []),
      ...(p.service && p.host ? [{ from: p.service.name, to: p.host.name, data: "Response DTOs over the authenticated API", direction: "read" }] : []),
      ...(p.host ? [{ from: p.host.name, to: spec.actor ?? "User", data: "Rendered view with an as-of timestamp", direction: "display" }] : []),
    ],
    "dataFlow",
  );
  const sequences = def(spec.sequences, defaultSequences(spec), "sequences");
  const proposed = spec.systems.filter((s) => /^proposed/i.test(s.status)).map((s) => s.name);
  const topology = def(
    spec.topology,
    [
      `No new infrastructure is proposed. ${proposed.length > 0 ? `${proposed.join(", ")} change inside their existing deployments` : "Existing systems are reused as they are"}; the environment ladder is DEV → TEST → STAGE → PROD [M Integration conventions].`,
      "New: one LaunchDarkly flag, defaulted off, and any new endpoints registered in api-contracts.",
    ],
    "topology",
  );

  const impact = spec.impact ?? {};
  const known = impact.known ?? (defaults.add("known"), "Not yet provided. No source states any cost or estimate.");
  const tests = { ...DEFAULT_TESTS, ...(spec.tests ?? {}) };
  const mon = spec.monitoring ?? {};
  const sec = spec.security ?? {};
  const risks = def(
    sec.risks,
    [
      { risk: "Unauthorized access to the new surface", mitigation: "Route-level authorization for the intended role on top of the existing SSO; deny by default." },
      { risk: "Expensive queries degrade a shared production database", mitigation: "Bounded, indexed, set-based queries; no per-customer fan-out; a query-cost budget agreed with Data Engineering." },
      { risk: "Misleading figures or records relied on in a dispute", mitigation: "Explicit error states instead of partial data; every figure carries its as-of time." },
    ],
    "risks",
  );
  const pentest = sec.pentest ?? (defaults.add("pentest"), "Proposed scope, to be defined with Security Engineering: the new routes and endpoints, role enforcement, and export or download paths if any. No source defines it.");
  const dast = sec.dast ?? (defaults.add("dast"), "Not yet provided. No source names a DAST tool or its coverage for the systems this design changes.");
  const maintainers = spec.maintainers ?? (defaults.add("maintainers"), undefined);
  const data = spec.data ?? {};

  const md = [
    `# Architecture Approach - ${spec.title}`,
    "",
    // Acceptance is recorded by the workflow, not in the file, so the line must stay true once accepted.
    "Status: written by the architect-aad agent for architect review; acceptance is recorded outside this file. It is not ARB approval, a department sign-off, or evidence that the design was validated in a proof of concept beyond what the sources state.",
    "",
    "## Document Revision",
    "",
    "| Changes By | Change Date | Purpose |",
    "| --- | --- | --- |",
    `| *(architect to complete)* | ${now} | ${cell(spec.revisionPurpose)} |`,
    "",
    "## Document Acceptance",
    "",
    ...acceptance,
    "",
    "## Overview",
    "",
    "### Scope of the Document",
    "",
    spec.scope.join("\n\n"),
    "",
    "Success criteria carried from the BRD [B1 §Success Metrics], all candidates pending validation:",
    "",
    bullets(spec.successCriteria),
    "",
    "In scope:",
    "",
    bullets(spec.inScope),
    "",
    "Out of scope: see [Out-of-scope](#out-of-scope).",
    "",
    "### Intended Audience",
    "",
    spec.audience ?? "Enterprise Architecture, Product Engineering, Data Engineering, DevOps, Quality Assurance, Security Engineering/Compliance, Product Management/Owner, IT Operations.",
    "",
    "### Problem statement",
    "",
    spec.problem.join("\n\n"),
    "",
    "### System Overview",
    "",
    "| System | Role in this design |",
    "| --- | --- |",
    ...spec.systems.map((s) => `| ${cell(s.name)} | ${cell(s.role)} |`),
    "",
    "## Summary of Existing Functionality",
    "",
    "### Logical view of existing functionality",
    "",
    bullets(spec.existing),
    "",
    "## Requirement Details",
    "",
    "### Functional Requirements",
    "",
    "| # | Requirement | BRD trace | Design element |",
    "| --- | --- | --- | --- |",
    ...frRows,
    "",
    "Failure behavior:",
    "",
    bullets(spec.failure),
    "",
    "### Non-Functional Requirements",
    "",
    spec.nfrs.map((n) => `- **${n.name}.** ${n.text}`).join("\n"),
    "",
    "## Assumptions and Prerequisites",
    "",
    "### Assumptions",
    "",
    bullets(spec.assumptions),
    "",
    "### Prerequisites",
    "",
    bullets(spec.prerequisites),
    "",
    "## Design",
    "",
    "### Logical view",
    "",
    spec.logical.join("\n\n"),
    ...tradeoffs,
    "",
    "### Process View",
    ...process,
    "",
    "### High-Level Architecture",
    "",
    "```mermaid",
    flowchart,
    "```",
    "",
    ...changeTable,
    "",
    "### Data flow",
    "",
    "One-way movements only.",
    "",
    "| # | From | To | Data | Direction |",
    "| --- | --- | --- | --- | --- |",
    ...dataFlow.map((d, i) => `| D${i + 1} | ${cell(d.from)} | ${cell(d.to)} | ${cell(d.data)} | ${cell(d.direction)} |`),
    "",
    "### Topology",
    "",
    topology.join("\n\n"),
    "",
    "### Sequence diagrams",
    ...sequences.flatMap((s) => ["", `#### ${s.title}`, "", "```mermaid", s.mermaid, "```"]),
    "",
    "## Impact Analysis",
    "",
    "### Known Cost",
    "",
    known,
    "",
    "### Unknown Cost",
    "",
    bullets(impact.unknown ?? ["Engineering effort for each proposed change; no estimate is stated in any source.", "Ongoing database and support load of the new read path."]),
    "",
    "### Performance",
    "",
    impact.performance ?? "The new path is read-only and off the login path; its cost is bounded by the query design above. No measured baseline exists.",
    "",
    "### Revenue",
    "",
    impact.revenue ?? "No direct revenue effect is stated in any source. The value is reduced operational and compliance risk.",
    "",
    "## Test Strategy",
    "",
    "### Test Approach",
    "",
    "#### Unit testing",
    "",
    tests.unit,
    "",
    "#### Integration Testing",
    "",
    tests.integration,
    "",
    "#### API testing",
    "",
    tests.api,
    "",
    "#### Performance testing",
    "",
    tests.performance,
    "",
    "#### Functional testing",
    "",
    tests.functional,
    "",
    "### Test Environments",
    "",
    tests.environments,
    "",
    "### Testing tools",
    "",
    tests.tools,
    "",
    "## Monitoring and Observability",
    "",
    "### Logging",
    "",
    mon.logging ?? "Structured JSON logs for every request on the new path: caller role, filters, result size and duration. No personal data or record-level values in access logs.",
    "",
    "### Monitoring",
    "",
    mon.monitoring ?? "A Dynatrace dashboard for the new endpoints and pages: request rate, error rate, p95 latency, and database time per query [M Integration conventions].",
    "",
    "### Traceability",
    "",
    mon.traceability ?? "An end-to-end request identifier propagated from the browser through every hop, as the platform standard requires [M Integration conventions].",
    "",
    "### Important Metrics",
    "",
    bullets(mon.metrics ?? ["Usage of the new surface by the intended audience, tied to the BRD success metrics [B1 §Success Metrics].", "Error rate and p95 latency of the new endpoints.", "Database time of the new queries."]),
    "",
    "### Alerting",
    "",
    bullets(mon.alerting ?? ["Error rate above the agreed threshold for 5 minutes.", "p95 latency above the agreed budget.", "Any authorization failure spike on the new routes."]),
    "",
    "## Delivery/Deployment Strategy",
    "",
    numbered(spec.delivery),
    "",
    "## Security",
    "",
    "### Threat Model",
    "",
    "#### Model",
    "",
    sec.model ?? "The new attack surface is the added routes and endpoints, reachable only by authenticated internal users. Assets are the figures and records they expose; the main threats are over-broad access and data leaving the system through the new path.",
    "",
    "#### Identified risks",
    "",
    "| Risk | Mitigation |",
    "| --- | --- |",
    ...risks.map((r) => `| ${cell(r.risk)} | ${cell(r.mitigation)} |`),
    "",
    "### Penetration Testing Plan",
    "",
    pentest,
    "",
    "### Product Hardening Requirements",
    "",
    "#### Risk mitigation approach",
    "",
    sec.hardening ?? "Least-privilege read-only database credentials, Istio mTLS with deny-by-default authorization between services, secrets in AWS Secrets Manager, and dependency scanning before release [M Integration conventions].",
    "",
    "### Static Application Security Testing (SAST - Build Time)",
    "",
    sec.sast ?? "SonarCloud and Snyk on every pull request for the changed repositories [M Integration conventions].",
    "",
    "### Dynamic Application Security Testing (DAST - Run Time)",
    "",
    dast,
    "",
    "## Compliance Considerations",
    "",
    bullets(spec.compliance),
    "",
    "## Maintainers",
    "",
    maintainers
      ? ["| Part | Team |", "| --- | --- |", ...maintainers.map((m) => `| ${cell(m.part)} | ${cell(m.team)} |`)].join("\n")
      : "Not yet provided. No source names the team that owns each changed part in production.",
    "",
    "## Data Identification",
    "",
    "### Data",
    "",
    data.items
      ? ["| Data | Created / changed / moved |", "| --- | --- |", ...data.items.map((d) => `| ${cell(d.data)} | ${cell(d.change)} |`)].join("\n")
      : "No new data is created; the design reads existing records and presents them. Any new field is labelled proposed below.",
    "",
    "### Data Category and Classification",
    "",
    data.classification
      ? ["| Data | Category | Notes |", "| --- | --- | --- |", ...data.classification.map((d) => `| ${cell(d.data)} | ${cell(d.category)} | ${cell(d.notes)} |`)].join("\n")
      : "Aggregate figures are Internal. Anything that identifies a customer is Confidential and follows the personal-data rules for storage, logging and export.",
    "",
    "### Data models",
    "",
    data.models && data.models.length > 0
      ? data.models
          .flatMap((m) => [`**${m.name}** *(proposed)*`, "", "| Column | Type | Notes |", "| --- | --- | --- |", ...m.columns.map((c) => `| ${cell(c[0])} | ${cell(c[1])} | ${cell(c[2])} |`), ""])
          .join("\n")
          .trim()
      : "No schema change is identified. Response shapes are defined in api-contracts and labelled proposed until agreed.",
    "",
    "## Out-of-scope",
    "",
    bullets(spec.outOfScope),
    "",
    "## References",
    "",
    bullets(referenceLines(cites)),
    "",
    "## Appendix: Open Questions",
    "",
    "| # | Question | Who can answer |",
    "| --- | --- | --- |",
    ...spec.questions.map((q, i) => `| Q${i + 1} | ${cell(q.text)} | ${cell(q.who)} |`),
    "",
    "## Appendix: Sources",
    "",
    cites.aadSources(),
    "",
    "Both appendices exist for review and can be removed or moved into Confluence comments before ARB.",
    "",
  ].join("\n");

  return { content: cites.resolve(md), defaults };
}

function referenceLines(cites: Cites): string[] {
  const refs = cites.ctx.evidence.map((e) => `${e.kind === "jira" ? "Jira" : "Confluence page"} ${e.ref} — ${e.title} [${e.id}]`);
  const brd = cites.ctx.brd ? [`BRD: ${brdTitle(cites.ctx.brd.content)}, \`${cites.ctx.brd.path}\` [B1]`] : [];
  return [...refs, ...brd, `Shared memory, \`${cites.ctx.memory.path}\` [M]`];
}

function brdTitle(md: string): string {
  return (/^#\s+BRD:\s*(.*)$/m.exec(md)?.[1] ?? /^#\s+(.*)$/m.exec(md)?.[1] ?? "accepted BRD").trim();
}

export function draftAad(spec: AadSpec, report: AadReportSpec, cites: Cites, out: string): DocResult<AadReport> {
  const { content, defaults } = renderAad(spec, cites);
  const missing = [
    ...(defaults.has("pentest") ? ["Penetration Testing Plan — scope proposed but marked for definition with Security Engineering; no source defines it"] : []),
    ...(defaults.has("dast") ? ["Dynamic Application Security Testing (DAST) — no source names a tool or coverage"] : []),
    ...(defaults.has("known") ? ["Impact Analysis / Known Cost — no source states any cost or estimate"] : []),
    ...(defaults.has("maintainers") ? ["Maintainers — owning teams not stated in any source"] : []),
    "Document Revision / Document Acceptance — author and representatives left for the architect; no approval marked",
  ];
  const untraced =
    report.untraced ??
    spec.frs.flatMap((fr, i) =>
      fr.candidate || /^not designed/i.test(fr.design) ? [`BRD requirement ${fr.br ?? "?"}${fr.candidate ? " (candidate)" : ""} — carried as FR${i + 1} but not designed; ${fr.design.replace(/^not designed[^.;]*[.;]?\s*/i, "") || "pending the scope decision"}`] : [],
    );
  return {
    content,
    report: {
      path: out,
      missingSections: missing,
      untracedRequirements: untraced.map((u) => cites.resolve(u)),
      blockingQuestions: spec.questions.flatMap((q, i) => (q.blocking ? [cites.resolve(`Q${i + 1} — ${q.report ?? q.text}`)] : [])),
      decisionsNeeded: report.decisionsNeeded.map((d) => cites.resolve(d)),
      conflicts: report.conflicts.map((c) => cites.resolve(c)),
      ignoredInstructions: report.ignoredInstructions.map((c) => cites.resolve(c)),
      changes: report.changes.map((c) => cites.resolve(c)),
    },
  };
}
