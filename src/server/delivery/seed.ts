import "server-only";
/**
 * The seven demo projects of SPEC 6, produced by DRIVING the mock workflows with scripted answers
 * inside engine.withVirtualClock (believable ledgers and timestamps spread over the last weeks),
 * through the same store methods and weft answers the API uses, so orchestration runs exactly as
 * it does live. Runs that should be moving when the app opens start after the virtual clock.
 * Each project is seeded in its own try/catch; a failure becomes an FYI notice.
 */
import { DEFAULT_AAD_OPTIONS, type CreateProjectBody, type RequirementSource, type StageId } from "@/lib/delivery/types";
import type { PendingRequest } from "@/lib/weft/types";
import { agrRequests } from "@/server/mock/content";
import type { MockEngine } from "@/server/mock/engine/api";
import type { CuratedEpic } from "./epics";
import type { Orchestrator } from "./orchestrator";
import { isTerminal } from "./rules";
import type { DeliveryStore } from "./store";
import { errorMessage, human } from "./util";

export interface SeedDeps {
  engine: MockEngine;
  store: DeliveryStore;
  orchestrator: Orchestrator;
}

const PO = "Maya Chen";
const ARCH = "Daniel Okafor";
const DEV = "Sam Rivera";
const QA = "Lena Novak";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

type Pending = { req: PendingRequest; key: string };
type Decide = (key: string, req: PendingRequest) => { answer: unknown; actor: string; think: number } | "stop";

/** Drives one project's timeline: a virtual-time cursor plus helpers to answer runs. */
class Driver {
  constructor(
    private readonly deps: SeedDeps,
    public at: number,
  ) {}

  get store() {
    return this.deps.store;
  }

  wait(ms: number): this {
    this.at += ms;
    return this;
  }

  /** Move the cursor to `t` unless it is already later. */
  until(t: number): this {
    this.at = Math.max(this.at, t);
    return this;
  }

  /** Run `fn` on the virtual clock starting at the cursor; the cursor moves past it. */
  async block<T>(fn: () => Promise<T> | T): Promise<T> {
    const { engine, orchestrator } = this.deps;
    // Seeded history must stay in the past, whatever the timeline arithmetic says.
    const latest = Date.now() - 2 * MIN;
    if (this.at > latest) {
      if (process.env.SEED_DEBUG) console.warn(`[seed] clamped a block from ${new Date(this.at).toISOString()} to now`);
      this.at = latest;
    }
    return engine.withVirtualClock(this.at, async () => {
      try {
        const out = await fn();
        await orchestrator.drain();
        return out;
      } finally {
        this.at = Math.max(this.at, engine.now()) + 30_000;
      }
    });
  }

  /** Wait (inside a block) until the run asks a person or ends; null when it ended. */
  async settle(runId: string): Promise<Pending | null> {
    const { engine, orchestrator } = this.deps;
    let req: PendingRequest | undefined;
    try {
      req = await withTimeout(engine.waitForHuman(runId), 20_000, `run ${runId} neither asked a person nor ended`);
    } catch (err) {
      const run = await engine.run(runId);
      if (!isTerminal(run.status)) throw err;
    }
    await orchestrator.drain();
    if (!req) {
      const run = await engine.run(runId);
      if (run.status !== "complete") throw new Error(`run ${runId} (${run.workflow}) ended ${run.status}${run.error ? `: ${run.error.message}` : ""}`);
      return null;
    }
    const run = await engine.run(runId);
    return { req, key: run.humans.find((h) => h.id === req!.id)?.key ?? "" };
  }

  /** Answer the run's requests one by one (with think time between) until it ends or `decide` stops. */
  async autopilot(runId: string, decide: Decide): Promise<Pending | null> {
    let cur = await this.block(() => this.settle(runId));
    for (let guard = 0; cur; guard++) {
      if (guard > 24) throw new Error(`run ${runId} kept asking (last ${cur.key})`);
      const d = decide(cur.key, cur.req);
      if (d === "stop") return cur;
      const pending: Pending = cur;
      this.wait(d.think);
      cur = await this.block(async () => {
        await this.deps.engine.answer(runId, { requestId: pending.req.id, answer: d.answer }, d.actor);
        return this.settle(runId);
      });
    }
    return null;
  }

  /** po-brd / architect-aad: continue discovery, accept round 1, apply memory. */
  docRun(runId: string, actor: string, stopAt?: string): Promise<Pending | null> {
    return this.autopilot(runId, (key) => {
      if (stopAt && key.startsWith(stopAt)) return "stop";
      if (key.startsWith("deps:review")) return { answer: { decision: "continue" }, actor, think: 25 * MIN };
      if (key.startsWith("review:")) return { answer: { decision: "accept" }, actor, think: 2 * HOUR + 10 * MIN };
      if (key.startsWith("memory:review")) return { answer: { decision: "apply" }, actor, think: 12 * MIN };
      throw new Error(`unexpected request ${key} on ${runId}`);
    });
  }

  planRun(runId: string, start: "all-waves" | "first-wave" | "manual"): Promise<Pending | null> {
    return this.autopilot(runId, (key) => {
      if (key.startsWith("plan:review")) return { answer: { decision: "approve", start }, actor: DEV, think: 50 * MIN };
      throw new Error(`unexpected request ${key} on ${runId}`);
    });
  }

  /** Start a dev-task run now and approve every review, or stop at the first one. */
  async taskRun(projectId: string, taskId: string, opts: { stopAtReview?: boolean; think?: number } = {}): Promise<{ runId: string; pending: Pending | null }> {
    const runId = await this.block(() => this.store.startTaskNow(projectId, taskId, human(DEV)));
    const pending = await this.autopilot(runId, (key) => {
      if (key.startsWith("task:review")) return opts.stopAtReview ? "stop" : { answer: { decision: "approve" }, actor: DEV, think: opts.think ?? 35 * MIN };
      throw new Error(`unexpected request ${key} on ${runId}`);
    });
    return { runId, pending };
  }

  /** Start qa-verify for one task, then give `verdict` (or stop at the review). */
  async qaRun(projectId: string, taskId: string, verdict: "ready-for-po-review" | "stop"): Promise<{ runId: string; pending: Pending | null }> {
    const [runId] = await this.block(async () => (await this.store.startQa(projectId, { taskIds: [taskId] }, human(QA))).runIds);
    const pending = await this.autopilot(runId, (key) => {
      if (key.startsWith("qa:review")) return verdict === "stop" ? "stop" : { answer: { verdict, comment: "All acceptance criteria met with evidence." }, actor: QA, think: 40 * MIN };
      throw new Error(`unexpected request ${key} on ${runId}`);
    });
    return { runId, pending };
  }

  /** Approve a stage gate, acknowledging whatever warnings it shows. */
  approve(projectId: string, stage: StageId, actor: string, comment?: string): Promise<void> {
    return this.block(async () => {
      const { view } = await this.store.view(projectId);
      await this.store.decideStage(projectId, stage, { decision: "approved", acknowledgedWarnings: view.stages[stage].warnings, ...(comment ? { comment } : {}) }, human(actor));
    });
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    (timer as { unref?: () => void }).unref?.();
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

// ---------------------------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------------------------

let srcSeq = 0;
function src(kind: RequirementSource["kind"], value: string, label?: string, actor = PO): RequirementSource {
  return {
    id: `seed-src-${++srcSeq}`,
    kind,
    value,
    label: label ?? value,
    mapsTo: kind === "jira" || kind === "confluence" ? "seeds" : "notes",
    addedBy: human(actor),
    addedAt: 0,
  };
}

/** A create body; `id` is an optional extra the store accepts so seeds keep their SPEC ids. */
function project(id: string, name: string, key: string, summary: string, request: string, sources: RequirementSource[]): CreateProjectBody & { id: string } {
  return { id, name, key, summary, jiraProject: "CP", intake: { request, sources, options: { maxRounds: 3, discover: true, discoveryRounds: 2, maxQueries: 6, budget: "$8" } } };
}

/** Brief F.4, before architecture (systems and FR refs arrive with the AAD). */
const AGR_EPICS: CuratedEpic[] = [
  {
    title: "Agreement Progress page: aggregate coverage",
    objective: "Give Legal/Compliance an on-demand view of acceptance coverage per agreement and version, without a data pull request.",
    context: "Proposed from the BRD requirements BR-1, BR-2, BR-3, BR-5 and BR-6.",
    inScope: ["Latest agreements and their current versions", "Accepted vs not accepted counts per agreement and version", "Coverage toward the 100% acceptance goal", "Available on demand, not on a fixed schedule"],
    brdRequirementRefs: ["BR-1", "BR-2", "BR-3", "BR-5", "BR-6"],
    architecture: { systems: ["website-customer-portal", "customer-service-v2", "api-contracts"] },
  },
  {
    title: "Access control & rollout for agreement reporting",
    objective: "Restrict the reporting view to the Legal/Compliance audience and roll it out behind a feature flag.",
    context: "Proposed from the BRD requirement BR-7; the access mechanism is an open question.",
    inScope: ["Role-restricted access for Legal/Compliance", "Feature-flag gated rollout"],
    brdRequirementRefs: ["BR-7"],
    architecture: { systems: ["website-customer-portal", "LaunchDarkly"], blockedBy: ["Q4"] },
  },
  {
    title: "Filters and segmentation by agreement and version",
    objective: "Let Legal narrow the coverage figures to one agreement and version.",
    context: "Proposed from the BRD requirement BR-4.",
    inScope: ["Filter by agreement", "Filter by version"],
    brdRequirementRefs: ["BR-4"],
    architecture: { systems: ["website-customer-portal", "customer-service-v2"] },
  },
  {
    title: "Record-level acceptance list (candidate)",
    objective: "Retrieve the list underlying the counts: ambassador ID, name, acceptance status and version accepted.",
    context: "Candidate requirement BR-8; record-level data conflicts with the PO's aggregate-only scope until Q3 is answered.",
    inScope: ["Ambassador ID, name, acceptance status and version accepted"],
    brdRequirementRefs: ["BR-8"],
    blockedBy: ["Q3"],
    architecture: { systems: ["customer-service-v2"] },
  },
  {
    title: "Launch readiness (non-dev)",
    objective: "Prepare communications, help content and training so the release lands.",
    context: "From the BRD Implementation Plan checklist.",
    inScope: ["Comms Plan", "Help Center Articles", "Internal Training", "Pre Implementation Kick off Meeting", "Launch readiness meeting"],
    brdRequirementRefs: [],
  },
];

/** LCE epics named like its plan pack so tasks resolve to them. */
const LCE_EPICS: CuratedEpic[] = [
  {
    title: "CSV export of agreement coverage",
    objective: "Let Legal/Compliance export the Agreement Progress figures to CSV for compliance filings.",
    context: "Proposed from the BRD requirements BR-1, BR-2, BR-3 and BR-5.",
    inScope: ["CSV export endpoint", "Export CSV button for Legal users", "Row limit and streaming for large exports", "Export restricted to Legal/Compliance"],
    brdRequirementRefs: ["BR-1", "BR-2", "BR-3", "BR-5", "BR-6"],
  },
  {
    title: "Export audit trail",
    objective: "Record who exported which figures and when, so Legal can show it in an audit.",
    context: "Proposed from the BRD requirement BR-4.",
    inScope: ["Audit entry per export: actor, filters, row count, outcome"],
    brdRequirementRefs: ["BR-4"],
  },
  {
    title: "Spanish column headers (candidate)",
    objective: "Offer the export with Spanish column headers for the es-US market.",
    context: "Candidate requirement BR-7; Q5 asks whether Spanish headers are needed at launch.",
    inScope: ["Spanish column headers for es-US"],
    brdRequirementRefs: ["BR-7"],
    blockedBy: ["Q5"],
  },
];

function signoffDate(now: number): number {
  const fixed = new Date(2026, 8, 2, 15, 20).getTime();
  return fixed < now - 3 * DAY ? fixed : now - 27 * DAY;
}

// ---------------------------------------------------------------------------------------------
// Flows shared by the later-stage projects
// ---------------------------------------------------------------------------------------------

interface FlowOpts {
  aadRequest: string;
  planNotes: string;
  jira: { epics: number; tasks: number };
  /** Gap between stages. */
  gap: number;
  /** Gap between two dev-task runs, so the build spreads over days like real work. */
  taskGap?: number;
}

async function requirementsStage(d: Driver, pid: string, jiraEpics: number): Promise<void> {
  const run = await d.block(async () => (await d.store.startRequirements(pid, human(PO))).runId);
  await d.docRun(run, PO);
  d.wait(50 * MIN);
  await d.block(() => {
    d.store.acceptEpics(pid, "requirements", human(PO));
    d.store.setJiraCursor(d.store.get(pid).project.jiraProject, jiraEpics);
    d.store.syncEpics(pid, human(PO));
  });
  d.wait(3 * HOUR);
  await d.approve(pid, "requirements", PO);
}

async function architectureStage(d: Driver, pid: string, request: string, stopAtReview = false): Promise<boolean> {
  const run = await d.block(async () => (await d.store.startArchitecture(pid, { request, sources: [], options: { ...DEFAULT_AAD_OPTIONS } }, human(ARCH))).runId);
  const stopped = await d.docRun(run, ARCH, stopAtReview ? "review:" : undefined);
  if (stopAtReview) return !!stopped;
  d.wait(90 * MIN);
  await d.block(() => d.store.acceptEpics(pid, "architecture", human(ARCH)));
  d.wait(2 * HOUR);
  await d.approve(pid, "architecture", ARCH);
  return true;
}

async function planStage(d: Driver, pid: string, notes: string, jiraTasks: number): Promise<void> {
  const run = await d.block(async () => {
    d.store.setJiraCursor(d.store.get(pid).project.jiraProject, jiraTasks);
    return (await d.store.startPlan(pid, { notes }, human(DEV))).runId;
  });
  await d.planRun(run, "manual");
}

/** Tasks in dependency order (waves first), so each one's dependencies are done before it runs. */
function orderedTasks(d: Driver, pid: string): string[] {
  const tasks = [...d.store.get(pid).tasks].filter((t) => t.status !== "cancelled");
  const done = new Set<string>();
  const out: string[] = [];
  const pending = tasks.sort((a, b) => a.wave - b.wave || Number(a.id.replace(/\D/g, "")) - Number(b.id.replace(/\D/g, "")));
  while (out.length < pending.length) {
    const next = pending.find((t) => !done.has(t.id) && t.dependencies.every((dep) => done.has(dep) || !tasks.some((x) => x.id === dep)));
    const pick = next ?? pending.find((t) => !done.has(t.id))!;
    done.add(pick.id);
    out.push(pick.id);
  }
  return out;
}

async function buildAll(d: Driver, pid: string, taskIds: string[], gap = 40 * MIN): Promise<void> {
  for (const id of taskIds) {
    const task = d.store.get(pid).tasks.find((t) => t.id === id);
    if (task?.status === "blocked") await d.block(() => d.store.patchTask(pid, id, { status: "ready" }, human(DEV)));
    await d.taskRun(pid, id);
    d.wait(gap);
  }
}

/** QA for every task, then waive the rows no task covers, review the changes, approve Stage 4. */
async function certifyAll(d: Driver, pid: string, gap = 25 * MIN): Promise<void> {
  for (const id of orderedTasks(d, pid)) {
    await d.qaRun(pid, id, "ready-for-po-review");
    d.wait(gap);
  }
  await d.block(async () => {
    const { view } = await d.store.view(pid);
    for (const row of view.trace) {
      if (row.verdict === "met" || row.verdict === "waived") continue;
      const comment = row.brText.startsWith("(Candidate)")
        ? "Candidate requirement not confirmed for this release; tracked as a follow-up."
        : "No dedicated task: verified by hand during the release walkthrough.";
      await d.store.waiveTrace(pid, row.brRef, { comment }, human(QA));
    }
  });
  d.wait(45 * MIN);
  await d.block(() => {
    for (const cr of d.store.get(pid).changeReviews) if (cr.consistent === undefined) d.store.reviewChange(pid, cr.id, { consistent: true }, human(QA));
  });
  d.wait(HOUR);
  await d.approve(pid, "qa", QA, "Certified: every task has evidence; waivers recorded for uncovered requirements.");
}

async function throughImplementation(d: Driver, pid: string, o: FlowOpts): Promise<void> {
  await requirementsStage(d, pid, o.jira.epics);
  d.wait(o.gap);
  await architectureStage(d, pid, o.aadRequest);
  d.wait(o.gap);
  await planStage(d, pid, o.planNotes, o.jira.tasks);
  d.wait(3 * HOUR);
  await buildAll(d, pid, orderedTasks(d, pid), o.taskGap);
  d.wait(2 * HOUR);
  await d.approve(pid, "implementation", DEV, "All tasks approved; handing off to QA.");
}

async function create(d: Driver, body: CreateProjectBody, curated?: CuratedEpic[]): Promise<string> {
  return d.block(async () => {
    const pd = await d.store.createProject(body, human(PO));
    if (curated) d.store.setCuration(pd.project.id, curated);
    return pd.project.id;
  });
}

// ---------------------------------------------------------------------------------------------
// The seven projects
// ---------------------------------------------------------------------------------------------

interface ProjectSeed {
  id: string;
  name: string;
  /** Everything that happens on the virtual clock. */
  seed(d: Driver, now: number): Promise<void>;
  /** Kicks after the virtual clock, so the run is moving when the app opens. */
  live?(deps: SeedDeps): Promise<void>;
}

const agrState: { t5?: { runId: string; requestId: string } } = {};
const lceState: { bugs?: { runId: string; requestId: string } } = {};

const SEEDS: ProjectSeed[] = [
  {
    id: "terms-gate",
    name: "Agreement Acceptance at Login",
    async seed(d, now) {
      const signoff = signoffDate(now);
      d.until(signoff - 22 * DAY);
      const pid = await create(
        d,
        project(
          "terms-gate",
          "Agreement Acceptance at Login",
          "TG",
          "Gate back-office login until the ambassador accepts the current agreements, and record the acceptance.",
          "Brand Ambassadors must accept the current Brand Ambassador Agreement, Policies & Procedures and Privacy Policy at login before they can use the back office. Block access until they accept, store evidence of each acceptance, and re-prompt when Legal publishes a new version.",
          [src("jira", "CP-50889", "Mandatory Agreement Acceptance Experience"), src("jira", "CP-50891", "Acceptance Evidence & Audit Logging")],
        ),
      );
      await throughImplementation(d, pid, {
        aadRequest: "Design the post-login agreement gate: reuse the Auth0 post-login action, keep agreement definitions in Contentful, and publish acceptances on the existing Kafka topic.",
        planNotes: "Keep the gate behind ambassador-upgrade-agreements-enabled until Legal signs off the copy.",
        jira: { epics: 51960, tasks: 51970 },
        gap: 2 * DAY,
      });
      d.wait(DAY);
      await certifyAll(d, pid);
      d.until(signoff);
      await d.approve(pid, "signoff", PO, "Signed off: the gate is live for all Brand Ambassadors.");
    },
  },
  {
    id: "policy-reacceptance",
    name: "Privacy Policy Re-acceptance Prompt",
    async seed(d, now) {
      d.until(now - 14 * DAY);
      const pid = await create(
        d,
        project(
          "policy-reacceptance",
          "Privacy Policy Re-acceptance Prompt",
          "PPR",
          "Prompt every customer type to re-accept the updated Privacy Policy at login.",
          "When Legal publishes a new Privacy Policy version, every customer type, not only Brand Ambassadors, has to re-accept it at login. Reuse the post-login agreement gate. The 2026 update takes effect on 2026-11-01 and ships with a Spanish translation.",
          [src("jira", "CP-52300", "Privacy Policy re-acceptance prompt"), src("confluence", "5518822401", "Privacy Policy 2026 update: change summary")],
        ),
      );
      await throughImplementation(d, pid, {
        aadRequest: "Extend the existing post-login terms gate to Retail and Preferred customers for the Privacy Policy only; no new service.",
        planNotes: "Reuse the terms-gate components; the Spanish copy comes from Contentful.",
        jira: { epics: 52302, tasks: 52310 },
        gap: 2 * DAY,
        taskGap: 9 * HOUR,
      });
      // QA over the last few days; the PO has had the sign-off waiting since yesterday.
      d.until(now - 5 * DAY);
      await certifyAll(d, pid, 18 * HOUR);
    },
  },
  {
    id: "compliance-export",
    name: "Legal & Compliance Reporting Export",
    async seed(d, now) {
      d.until(now - 16 * DAY);
      const pid = await create(
        d,
        project(
          "compliance-export",
          "Legal & Compliance Reporting Export",
          "LCE",
          "Export the agreement acceptance figures to CSV for compliance filings.",
          "Legal wants to export the agreement acceptance figures from the Agreement Progress page to CSV so they can attach them to compliance filings. Keep it to what the page shows, log every export, and make it work for large exports.",
          [src("jira", "CP-52190", "Legal & Compliance reporting export"), src("confluence", "5501234567", "Data classification standard: personal data in exports")],
        ),
        LCE_EPICS,
      );
      await throughImplementation(d, pid, {
        aadRequest: "Add a CSV export next to the existing coverage endpoint in customer-service-v2 and an Export button on the Agreement Progress page. Mind the 30 s gateway timeout.",
        planNotes: "Stream the CSV; the gateway cuts requests at 30 s (DV-6120).",
        jira: { epics: 52194, tasks: 52201 },
        gap: 2 * DAY,
        taskGap: 8 * HOUR,
      });
      const order = orderedTasks(d, pid);
      // Brief F.6: three certified, the second task waiting on QA review, the fourth bugs_found.
      const pendingId = order[1];
      const bugsId = order[3] ?? order.at(-1)!;
      const certified = order.filter((id) => id !== pendingId && id !== bugsId);
      d.until(now - 4 * DAY);
      for (const id of certified) {
        await d.qaRun(pid, id, "ready-for-po-review");
        d.wait(22 * HOUR);
      }
      d.until(now - 3 * HOUR);
      await d.qaRun(pid, pendingId, "stop");
      d.wait(40 * MIN);
      const bugs = await d.qaRun(pid, bugsId, "stop");
      if (bugs.pending) lceState.bugs = { runId: bugs.runId, requestId: bugs.pending.req.id };
    },
    async live({ engine }) {
      if (!lceState.bugs) return;
      await engine.answer(
        lceState.bugs.runId,
        {
          requestId: lceState.bugs.requestId,
          answer: { verdict: "bugs-found", comment: "Large exports fail at the gateway.", bugs: ["Export of more than 50k rows times out at the 30 s gateway limit"] },
        },
        QA,
      );
    },
  },
  {
    id: "agreement-reporting",
    name: "Ambassador Agreement Acceptance Reporting",
    async seed(d, now) {
      d.until(now - 13 * DAY);
      const requests = safeAgrRequests();
      const pid = await create(
        d,
        project(
          "agreement-reporting",
          "Ambassador Agreement Acceptance Reporting",
          "AGR",
          "On-demand aggregate reporting of agreement acceptance for Legal/Compliance.",
          requests.brd,
          [src("jira", "CP-50894", "Phase 2 Fast Follow: Legal & Compliance Reporting"), src("jira", "CP-50908", "Look Up an Individual Ambassador's Acceptance Status")],
        ),
        AGR_EPICS,
      );
      await requirementsStage(d, pid, 52140);
      d.wait(2 * DAY);
      await architectureStage(d, pid, requests.aad);
      d.wait(2 * DAY);
      await planStage(d, pid, "Start with the aggregate query and the contract; the gateway route only if the portal cannot reach customer-service-v2 directly (Q8).", 52150);
      d.wait(4 * HOUR);
      const byId = (id: string) => d.store.get(pid).tasks.find((t) => t.id === id);
      for (const id of ["T-1", "T-2", "T-3"]) {
        if (!byId(id)) continue;
        await d.taskRun(pid, id);
        d.wait(36 * HOUR);
      }
      const t7 = byId("T-7");
      if (t7 && t7.status !== "blocked") await d.block(() => d.store.patchTask(pid, "T-7", { status: "blocked", blockedBy: "Q4: which Okta group" }, human(DEV)));
      d.until(now - 5 * HOUR);
      if (byId("T-4")) await d.taskRun(pid, "T-4", { stopAtReview: true });
      d.until(now - 3 * HOUR);
      if (byId("T-5")) {
        const t5 = await d.taskRun(pid, "T-5", { stopAtReview: true });
        if (t5.pending) agrState.t5 = { runId: t5.runId, requestId: t5.pending.req.id };
      }
    },
    async live({ engine, store }) {
      if (agrState.t5) {
        await engine.answer(
          agrState.t5.runId,
          { requestId: agrState.t5.requestId, answer: { decision: "request-changes", feedback: "Forward the Okta bearer token unchanged; don't re-sign it at the gateway." } },
          DEV,
        );
      }
      const pd = store.find("agreement-reporting");
      if (pd?.tasks.some((t) => t.id === "T-6" && t.status === "ready")) await store.startTaskNow("agreement-reporting", "T-6", human(DEV));
    },
  },
  {
    id: "agreement-status-lookup",
    name: "Agreement Acceptance Status Lookup",
    async seed(d, now) {
      d.until(now - 6 * DAY);
      const pid = await create(
        d,
        project(
          "agreement-status-lookup",
          "Agreement Acceptance Status Lookup",
          "ASL",
          "Look up one ambassador's agreement acceptance status by Customer ID during a dispute.",
          "Support and Legal need to look up one ambassador's agreement acceptance status by Customer ID during a dispute or escalation: which agreements and versions they accepted, and when. Review CP-50908 and the spike CP-51264.",
          [src("jira", "CP-50908", "Look Up an Individual Ambassador's Acceptance Status"), src("jira", "CP-51709", "Agreement Acceptance Status Lookup")],
        ),
      );
      await requirementsStage(d, pid, 52220);
      d.until(now - 5 * HOUR);
      await architectureStage(d, pid, "Put the per-customer agreement lookup on the customer record in customer-portal, reusing the existing customer-service agreements call.", true);
    },
  },
  {
    id: "reorder-reminders",
    name: "Reorder Reminders",
    async seed(d, now) {
      d.until(now - 2 * HOUR - 10 * MIN);
      const pid = await create(
        d,
        project(
          "reorder-reminders",
          "Reorder Reminders",
          "RR",
          "Remind customers to reorder consumables before they run out.",
          "Customers forget to reorder consumables and run out; send reminders before they run out based on their usual interval. Launch before holiday season.",
          [src("note-file", "notes/examples/reorder-reminders.md", "reorder-reminders.md"), src("jira", "ECOM-2210", "Subscription & reorder improvements 2026 Q4")],
        ),
      );
      const run = await d.block(async () => (await d.store.startRequirements(pid, human(PO))).runId);
      await d.docRun(run, PO, "deps:review");
    },
  },
  {
    id: "sms-consent",
    name: "SMS Consent Capture",
    async seed(d, now) {
      d.until(now - 26 * HOUR);
      await create(
        d,
        project(
          "sms-consent",
          "SMS Consent Capture",
          "SMS",
          "Capture and prove SMS marketing consent at enrollment, checkout and in My Account.",
          "Capture SMS marketing consent at enrollment and checkout with an unchecked checkbox, let customers change it in My Account, and handle STOP and HELP replies. Legal must be able to prove when and where consent was given.",
          [src("jira", "CP-52010", "SMS marketing consent capture"), src("note-text", "Legal (LEGAL-77) wants the consent wording versioned like the agreements, so we can show which text a customer saw.", "Legal: version the consent wording")],
        ),
      );
    },
  },
];

function safeAgrRequests(): { brd: string; aad: string } {
  const fallback = {
    brd: "We need a place for seeing reports for what customers have accepted. Review this ticket CP-50908 and all relevant tickets in the parent epic.\nThere are already existing web services that could host it and you can check implementation in other parent epic, but the scope of this one is purely seeing the numbers like list of latest agreements, how many have accepted, how many have not accepted and etc. Just overall analytics",
    aad: "Create a AAD for agreements report. I expect that solution includes utilizing existing website that is appropriate, maybe customer portal? There should be customer specific agreeemtns so reports should be near it ",
  };
  try {
    const r = agrRequests();
    return { brd: r.brd || fallback.brd, aad: r.aad || fallback.aad };
  } catch {
    return fallback;
  }
}

/** Seed every demo project; failures are logged and surfaced as FYI notices, never thrown. */
export async function seedDemo(deps: SeedDeps): Promise<void> {
  const { store } = deps;
  const now = Date.now();
  srcSeq = 0;
  agrState.t5 = undefined;
  lceState.bugs = undefined;
  const seeded: ProjectSeed[] = [];
  for (const s of SEEDS) {
    const d = new Driver(deps, 0);
    const started = Date.now();
    try {
      await s.seed(d, now);
      seeded.push(s);
    } catch (err) {
      console.error(`[seed] ${s.id} failed:`, err);
      const stage: StageId = store.find(s.id)?.project.currentStage ?? "requirements";
      store.addNotice(s.id, stage, `Seeding ${s.name} stopped early: ${errorMessage(err)}`);
    } finally {
      if (process.env.SEED_DEBUG) console.log(`[seed] ${s.id} in ${Date.now() - started} ms`);
    }
  }
  store.normalizeJiraCursors();
  for (const s of seeded) {
    if (!s.live) continue;
    try {
      await s.live(deps);
    } catch (err) {
      console.error(`[seed] ${s.id} live step failed:`, err);
      store.addNotice(s.id, store.find(s.id)?.project.currentStage ?? "requirements", `Could not start the live runs for ${s.name}: ${errorMessage(err)}`, "warning");
    }
  }
  await deps.orchestrator.drain();
}
