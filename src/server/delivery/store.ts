import "server-only";
/**
 * The delivery store: in-memory projects, documents, epics, tasks, evidence, activity, change
 * reviews and waivers. It talks to weft only through WeftBackend (start/answer/read runs), plus
 * the workspace fs and blob store for imports. Every mutation touches updatedAt, appends an
 * Activity with the acting person and emits a `project` LiveEvent.
 */
import {
  DEFAULT_AAD_OPTIONS,
  DEFAULT_BRD_OPTIONS,
  STAGES,
  isStageId,
  type Activity,
  type ActivityType,
  type Actor,
  type ChangeReview,
  type ChangeReviewBody,
  type CreateProjectBody,
  type DashboardData,
  type Decision,
  type DecisionBody,
  type DeliveryTask,
  type DocumentKind,
  type DocVersion,
  type Epic,
  type EpicUpsertBody,
  type ImportBody,
  type InboxItem,
  type Intake,
  type NoteBody,
  type Project,
  type ProjectBundle,
  type ProjectSummary,
  type QaStartBody,
  type ReopenBody,
  type RequirementSource,
  type RunOptions,
  type StageId,
  type StageNote,
  type StartArchitectureBody,
  type StartPlanBody,
  type TaskPatchBody,
  type TaskStartBody,
  type TraceRow,
  type WaiveBody,
  type LiveEvent,
} from "@/lib/delivery/types";
import { readyForTestDraft } from "@/lib/delivery/ready-for-test";
import type { BlobRef, StartRunBody } from "@/lib/weft/types";
import type { DevPlanInput, DevTaskInput, PlannedTask, QaReportStepOutput, QaVerifyInput } from "@/lib/weft/workflows";
import type { WeftBackend, WorkspaceFs } from "@/server/mock/engine/api";
import { catalogItem, mockConfluenceDoc } from "@/server/mock/content";
import type { Bus } from "../bus";
import { buildDashboard } from "./dashboard";
import { deriveProject, summaryOf, type ProjectView } from "./derive";
import { aadEpicUpdates, proposeEpicsFromBrd, type CuratedEpic, type EpicProposal } from "./epics";
import { buildInbox } from "./inbox";
import { parseAad, parseBrd } from "./parse";
import { depsSatisfied, isInFlight, isOpenRun, isParked, isStartable, taskLabel, unmetDeps, usesAgent } from "./rules";
import { reqKey, type ProjectData, type RequestInfo, type RunOwner, type Snapshot, type StoredDoc, type SystemNotice } from "./state";
import { buildTrace } from "./trace";
import {
  SYSTEM,
  actorName,
  agent,
  asStringArray,
  bad,
  conflict,
  errorMessage,
  isRecord,
  nextStageOf,
  notFound,
  plural,
  prevStageOf,
  shorten,
  slugify,
  stageIndex,
  stageTitle,
  uniq,
  weftErrorStatus,
} from "./util";

/** What the store needs from its environment. The mock runtime passes the engine for all of it. */
export interface DeliveryHost {
  weft: WeftBackend;
  /** The workspace repo (brd/, aad/, plan/, memory/, notes/). */
  fs: WorkspaceFs;
  putBlob(text: string): BlobRef;
  /** Engine clock, so seeded (virtual-time) mutations get believable timestamps. */
  now(): number;
}

export const MAX_AGENTS = 3;
const DOC_BUDGET = { brd: "$8", aad: "$10" };
const SPEC_BUDGET = "$10";
const QA_ENVIRONMENT = "internal-apps-test";
const FIRST_JIRA_NUMBER = 52140;

const KIND_LABEL: Record<DocumentKind, string> = { brd: "BRD", aad: "AAD", memory: "Memory", plan: "Plan", "ready-for-test": "Ready for test" };

export class DeliveryStore {
  private projects = new Map<string, ProjectData>();
  private activityLog: Activity[] = [];
  private activitySeq = 0;
  private noticeSeq = 0;
  private notices: SystemNotice[] = [];
  private curation = new Map<string, CuratedEpic[]>();
  private jiraCursor = new Map<string, number>();
  private jiraMax = new Map<string, number>();
  private pumping = new Set<string>();
  private repump = new Set<string>();

  /** Caches filled by the orchestrator from engine events (weft has no project concept). */
  readonly owners = new Map<string, RunOwner>();
  readonly requests = new Map<string, RequestInfo>();
  readonly failures = new Map<string, string>();
  readonly phases = new Map<string, string>();
  readonly inputs = new Map<string, unknown>();

  /** True while seeding: toasts (notify events) are suppressed. */
  seeding = false;

  constructor(
    readonly host: DeliveryHost,
    readonly bus: Bus,
  ) {}

  // -------------------------------------------------------------------------------------------
  // Infrastructure
  // -------------------------------------------------------------------------------------------

  get weft(): WeftBackend {
    return this.host.weft;
  }

  now(): number {
    return this.host.now();
  }

  reset(): void {
    this.projects.clear();
    this.activityLog = [];
    this.activitySeq = 0;
    this.noticeSeq = 0;
    this.notices = [];
    this.curation.clear();
    this.jiraCursor.clear();
    this.jiraMax.clear();
    this.owners.clear();
    this.requests.clear();
    this.failures.clear();
    this.phases.clear();
    this.inputs.clear();
  }

  find(id: string): ProjectData | undefined {
    return this.projects.get(id);
  }

  get(id: string): ProjectData {
    const pd = this.projects.get(id);
    if (!pd) throw notFound(`Project ${id} not found`);
    return pd;
  }

  list(): ProjectData[] {
    return [...this.projects.values()];
  }

  touch(pd: ProjectData, at = this.now()): void {
    if (at > pd.project.updatedAt) pd.project.updatedAt = at;
    this.bus.publish({ type: "project", projectId: pd.project.id });
  }

  log(pd: ProjectData, stage: StageId, type: ActivityType, actor: Actor, text: string, extra: Partial<Activity> = {}, at = this.now()): Activity {
    const a: Activity = { id: `A-${++this.activitySeq}`, projectId: pd.project.id, stage, at, actor, type, text, ...extra };
    this.activityLog.push(a);
    this.touch(pd, at);
    return a;
  }

  notify(ev: Omit<Extract<LiveEvent, { type: "notify" }>, "type">): void {
    if (!this.seeding) this.bus.publish({ type: "notify", ...ev });
  }

  addNotice(projectId: string, stage: StageId, text: string, level: SystemNotice["level"] = "error"): void {
    this.notices.push({ id: `notice:system:${++this.noticeSeq}`, projectId, stage, text, level, at: this.now() });
    this.bus.publish({ type: "inbox" });
  }

  nextId(pd: ProjectData, kind: string, prefix: string): string {
    pd.counters[kind] = (pd.counters[kind] ?? 0) + 1;
    return `${prefix}-${pd.counters[kind]}`;
  }

  decision(pd: ProjectData, decision: Decision["decision"], by: Actor, at: number, comment?: string, acknowledgedWarnings?: string[]): Decision {
    const d: Decision = { id: this.nextId(pd, "decision", "D"), decision, by, at };
    if (comment) d.comment = comment;
    if (acknowledgedWarnings?.length) d.acknowledgedWarnings = acknowledgedWarnings;
    return d;
  }

  /** Seed hook: use this curated epic list instead of the heuristic grouping for a project. */
  setCuration(projectId: string, epics: CuratedEpic[]): void {
    this.curation.set(projectId, epics);
  }

  curated(projectId: string): CuratedEpic[] | undefined {
    return this.curation.get(projectId);
  }

  /** Seed hook: the next mock Jira number for a Jira project. */
  setJiraCursor(jiraProject: string, next: number): void {
    this.jiraCursor.set(jiraProject, next);
  }

  /** After seeding: continue numbering after the highest key handed out. */
  normalizeJiraCursors(): void {
    for (const [jp, max] of this.jiraMax) this.jiraCursor.set(jp, Math.max(this.jiraCursor.get(jp) ?? 0, max + 1));
  }

  allocJira(jiraProject: string, count: number): string[] {
    let next = this.jiraCursor.get(jiraProject) ?? Math.max(FIRST_JIRA_NUMBER, (this.jiraMax.get(jiraProject) ?? 0) + 1);
    const keys: string[] = [];
    for (let i = 0; i < count; i++) {
      keys.push(`${jiraProject}-${next}`);
      this.jiraMax.set(jiraProject, Math.max(this.jiraMax.get(jiraProject) ?? 0, next));
      next++;
    }
    this.jiraCursor.set(jiraProject, next);
    return keys;
  }

  // -------------------------------------------------------------------------------------------
  // Read models
  // -------------------------------------------------------------------------------------------

  async snapshot(): Promise<Snapshot> {
    const [runs, pending] = await Promise.all([this.weft.runs({ spend: true, limit: 100_000 }), this.weft.pending()]);
    // Pending entries carry no key/phase; join the ones the event cache has not seen (e.g. runs
    // started outside this process when a real daemon sits behind WeftBackend).
    const missing = uniq(pending.pending.filter((p) => !this.requests.has(reqKey(p.runId, p.id))).map((p) => p.runId));
    for (const runId of missing) {
      try {
        const run = await this.weft.run(runId);
        for (const h of run.humans) this.requests.set(reqKey(runId, h.id), { key: h.key, phase: h.phase, kind: h.kind, question: h.question, detail: h.detail });
      } catch {
        // unreadable run: its entry renders without a key
      }
    }
    return {
      now: this.now(),
      runs: new Map(runs.map((r) => [r.runId, r])),
      pending: pending.pending,
      requests: this.requests,
      owners: this.owners,
      failures: this.failures,
      phases: this.phases,
      inputs: this.inputs,
      notices: this.notices,
    };
  }

  private views(snap: Snapshot): Array<{ pd: ProjectData; view: ProjectView }> {
    return this.list().map((pd) => ({ pd, view: deriveProject(pd, snap) }));
  }

  async view(id: string): Promise<{ pd: ProjectData; view: ProjectView; snap: Snapshot }> {
    const pd = this.get(id);
    const snap = await this.snapshot();
    return { pd, view: deriveProject(pd, snap), snap };
  }

  async bundle(id: string): Promise<ProjectBundle> {
    const { pd, view, snap } = await this.view(id);
    const bundle: ProjectBundle = {
      project: pd.project,
      stages: view.stages,
      health: view.health,
      ...(view.healthReason ? { healthReason: view.healthReason } : {}),
      spendUsd: view.spendUsd,
      documents: pd.documents,
      epics: pd.epics,
      tasks: pd.tasks,
      evidence: pd.evidence,
      trace: view.trace,
      changeReviews: pd.changeReviews,
      inbox: buildInbox([{ pd, view }], snap, this.activityLog, false),
      activity: this.activity({ projectId: id, limit: 100 }),
    };
    if (view.nextStep) bundle.nextStep = view.nextStep;
    return bundle;
  }

  private summariesFrom(entries: Array<{ pd: ProjectData; view: ProjectView }>, inbox: InboxItem[]): ProjectSummary[] {
    return entries
      .map(({ pd, view }) => summaryOf(pd, view, inbox.filter((i) => i.projectId === pd.project.id && i.tier !== "fyi").length))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async summaries(): Promise<ProjectSummary[]> {
    const snap = await this.snapshot();
    const entries = this.views(snap);
    return this.summariesFrom(entries, buildInbox(entries, snap, this.activityLog));
  }

  async inbox(): Promise<InboxItem[]> {
    const snap = await this.snapshot();
    return buildInbox(this.views(snap), snap, this.activityLog);
  }

  async dashboard(): Promise<DashboardData> {
    const snap = await this.snapshot();
    const entries = this.views(snap);
    const inbox = buildInbox(entries, snap, this.activityLog);
    return buildDashboard(entries, this.summariesFrom(entries, inbox), inbox, this.activity({ limit: 20 }), snap);
  }

  activity(f: { projectId?: string; limit?: number } = {}): Activity[] {
    const list = f.projectId ? this.activityLog.filter((a) => a.projectId === f.projectId) : this.activityLog;
    return [...list].sort((a, b) => b.at - a.at || Number(b.id.slice(2)) - Number(a.id.slice(2))).slice(0, f.limit ?? 50);
  }

  async doc(projectId: string, docId: string, v?: number): Promise<{ doc: StoredDoc; text: string; version: DocVersion }> {
    const pd = this.get(projectId);
    const doc = pd.documents.find((d) => d.id === docId);
    if (!doc) throw notFound(`Document ${docId} not found in project ${projectId}`);
    const version = v === undefined ? doc.versions.at(-1) : doc.versions.find((x) => x.n === v);
    if (!version) throw notFound(v === undefined ? `Document ${docId} has no versions yet` : `Version ${v} of ${docId} not found`);
    let text: string;
    try {
      text = await this.weft.blobText(version.blob);
    } catch (err) {
      throw notFound(`Blob ${version.blob} not found: ${errorMessage(err)}`);
    }
    return { doc, text, version };
  }

  workspaceFiles(prefix = ""): Array<{ path: string; size: number; updatedAt: number }> {
    return this.host.fs
      .list(prefix)
      .map((f) => ({ path: f.path, size: Buffer.byteLength(f.content, "utf8"), updatedAt: f.updatedAt }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  // -------------------------------------------------------------------------------------------
  // Projects and intake
  // -------------------------------------------------------------------------------------------

  private normalizeSources(raw: unknown, actor: Actor, pd?: ProjectData, existing: RequirementSource[] = []): RequirementSource[] {
    if (raw === undefined) return existing;
    if (!Array.isArray(raw)) throw bad("sources must be a list.");
    const now = this.now();
    return raw.map((item, i): RequirementSource => {
      if (!isRecord(item)) throw bad(`sources[${i}] must be an object.`);
      const kind = item.kind;
      let value = typeof item.value === "string" ? item.value.trim() : "";
      if (kind !== "jira" && kind !== "confluence" && kind !== "note-file" && kind !== "note-text")
        throw bad(`Unknown source kind "${String(kind)}". Use jira, confluence, note-file or note-text.`);
      if (!value) throw bad(`sources[${i}] needs a value.`);
      if (kind === "jira") {
        value = value.toUpperCase();
        if (!/^[A-Z][A-Z0-9]+-\d+$/.test(value)) throw bad(`"${value}" is not a Jira key (e.g. CP-50908).`);
      }
      if (kind === "confluence") {
        const id = value.match(/^\d+$/)?.[0] ?? value.match(/\/pages\/(\d+)/)?.[1] ?? value.match(/[?&]pageId=(\d+)/)?.[1];
        if (!id) throw bad(`"${value}" is not a Confluence page id or URL.`);
        value = id;
      }
      const prior = existing.find((s) => s.id === item.id);
      const label = typeof item.label === "string" && item.label.trim() ? item.label.trim() : kind === "note-text" ? shorten(value, 48) : value;
      return {
        id: prior?.id ?? (typeof item.id === "string" && item.id ? item.id : pd ? this.nextId(pd, "source", "src") : `src-${i + 1}`),
        kind,
        label,
        value,
        mapsTo: kind === "jira" || kind === "confluence" ? "seeds" : "notes",
        addedBy: prior?.addedBy ?? actor,
        addedAt: prior?.addedAt ?? now,
      };
    });
  }

  private normalizeOptions(raw: unknown, defaults: RunOptions, base?: RunOptions): RunOptions {
    const out: RunOptions = { ...defaults, ...base };
    if (raw === undefined) return out;
    if (!isRecord(raw)) throw bad("options must be an object.");
    const int = (key: "maxRounds" | "discoveryRounds" | "maxQueries", min: number, max: number) => {
      const v = raw[key];
      if (v === undefined) return;
      if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw bad(`${key} must be an integer from ${min} to ${max}.`);
      out[key] = v;
    };
    int("maxRounds", 1, 5);
    int("discoveryRounds", 1, 5);
    int("maxQueries", 1, 10);
    if (raw.discover !== undefined) {
      if (typeof raw.discover !== "boolean") throw bad("discover must be true or false.");
      out.discover = raw.discover;
    }
    if (raw.budget !== undefined) {
      if (typeof raw.budget !== "string" || !/^(\$\d+(\.\d+)?|\d+k?)(,\s*(\$\d+(\.\d+)?|\d+k?))?$/.test(raw.budget.trim())) throw bad('budget must look like "$8", "500k" or "500k,$8".');
      out.budget = raw.budget.trim();
    }
    return out;
  }

  private uniqueId(base: string): string {
    let id = base;
    for (let n = 2; this.projects.has(id); n++) id = `${base}-${n}`;
    return id;
  }

  private uniqueKey(name: string, wanted?: string): string {
    const taken = new Set(this.list().map((p) => p.project.key));
    let key = wanted?.trim().toUpperCase();
    if (key) {
      if (!/^[A-Z][A-Z0-9]{1,9}$/.test(key)) throw bad("key must be 2–10 letters or digits, starting with a letter.");
      if (taken.has(key)) throw conflict(`Project key ${key} is already used.`);
      return key;
    }
    const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
    key = (words.length > 1 ? words.map((w) => w[0]).join("") : (words[0] ?? "PRJ").slice(0, 3)).toUpperCase().slice(0, 4);
    if (!/^[A-Z]/.test(key)) key = `P${key}`;
    if (key.length < 2) key = `${key}X`;
    let candidate = key;
    for (let n = 2; taken.has(candidate); n++) candidate = `${key}${n}`;
    return candidate;
  }

  private poBrdBody(pd: ProjectData): StartRunBody {
    const { intake, docPaths } = pd.project;
    const notes = intake.sources.filter((s) => s.mapsTo === "notes").map((s) => s.value);
    const seeds = intake.sources.filter((s) => s.mapsTo === "seeds").map((s) => s.value);
    if (!intake.request.trim() && !notes.length) throw bad("Provide the PO's request text in request, or at least one note in notes.");
    const o = intake.options;
    return {
      workflow: "po-brd",
      budget: o.budget ?? DOC_BUDGET.brd,
      input: { request: intake.request, notes, seeds, out: docPaths.brd, maxRounds: o.maxRounds, discover: o.discover, discoveryRounds: o.discoveryRounds, maxQueries: o.maxQueries },
    };
  }

  async createProject(body: CreateProjectBody, actor: Actor): Promise<ProjectData> {
    if (!isRecord(body)) throw bad("Request body must be a JSON object.");
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) throw bad("Provide a project name in name.");
    const now = this.now();
    const rawIntake: Record<string, unknown> = isRecord(body.intake) ? body.intake : {};
    const request = typeof rawIntake.request === "string" ? rawIntake.request : "";
    const imports = Array.isArray(body.imports) ? body.imports : [];
    for (const imp of imports) {
      if (!isRecord(imp) || (imp.stage !== "requirements" && imp.stage !== "architecture")) throw bad('Each import needs stage "requirements" or "architecture".');
      checkImport(imp);
    }
    const importsBrd = imports.some((i) => i.stage === "requirements");
    const jiraProject = typeof body.jiraProject === "string" && body.jiraProject.trim() ? body.jiraProject.trim().toUpperCase() : "CP";
    if (!/^[A-Z][A-Z0-9]+$/.test(jiraProject)) throw bad("jiraProject must be a Jira project key such as CP.");
    // An explicit id (a slug) is accepted so seeded projects keep their SPEC ids.
    const wanted = (body as { id?: unknown }).id;
    const id = this.uniqueId(slugify(typeof wanted === "string" && wanted.trim() ? wanted : name));
    const project: Project = {
      id,
      key: this.uniqueKey(name, typeof body.key === "string" ? body.key : undefined),
      name,
      summary: typeof body.summary === "string" ? body.summary.trim() : "",
      jiraProject,
      createdAt: now,
      updatedAt: now,
      createdBy: actor,
      currentStage: "requirements",
      done: false,
      docPaths: { brd: `brd/${id}.md`, aad: `aad/${id}.md`, plan: `plan/${id}.md` },
      intake: { request, sources: [], options: { ...DEFAULT_BRD_OPTIONS } },
      stages: {
        requirements: { decisions: [], notes: [], runIds: [] },
        architecture: { decisions: [], notes: [], runIds: [], request: "", sources: [], options: { ...DEFAULT_AAD_OPTIONS } },
        implementation: { decisions: [], notes: [], runIds: [], step: "notes", planRunIds: [] },
        qa: { decisions: [], notes: [], runIds: [], step: "tasks" },
        signoff: { decisions: [], notes: [], runIds: [] },
      },
    };
    const pd: ProjectData = { project, documents: [], epics: [], tasks: [], evidence: [], changeReviews: [], waivers: {}, counters: {}, queue: [] };
    project.intake.sources = this.normalizeSources(rawIntake.sources ?? [], actor, pd);
    project.intake.options = this.normalizeOptions(rawIntake.options, DEFAULT_BRD_OPTIONS);
    if (body.start && !importsBrd) this.poBrdBody(pd); // validate before the project exists
    this.projects.set(id, pd);
    this.log(pd, "requirements", "project.created", actor, `${actorName(actor)} created project ${name}`, { href: `/projects/${id}` }, now);
    for (const stage of ["requirements", "architecture"] as const) {
      for (const imp of imports.filter((i) => i.stage === stage)) await this.importDoc(id, stage, imp, actor);
    }
    if (body.start && !importsBrd) await this.startRequirements(id, actor);
    return pd;
  }

  async deleteProject(id: string, actor: Actor): Promise<void> {
    const pd = this.get(id);
    for (const runId of STAGES.flatMap((s) => pd.project.stages[s.id].runIds)) {
      try {
        const run = await this.weft.run(runId);
        if (isOpenRun(run.status)) await this.weft.cancel(runId);
      } catch {
        // already gone
      }
      this.owners.delete(runId);
    }
    this.projects.delete(id);
    this.activityLog = this.activityLog.filter((a) => a.projectId !== id);
    this.notices = this.notices.filter((n) => n.projectId !== id);
    this.bus.publish({ type: "project", projectId: id });
    this.bus.publish({ type: "inbox" });
    void actor;
  }

  updateIntake(id: string, patch: Partial<Intake> & { name?: string; summary?: string }, actor: Actor): void {
    const pd = this.get(id);
    if (!isRecord(patch)) throw bad("Request body must be a JSON object.");
    const p = pd.project;
    const changed: string[] = [];
    if (patch.name !== undefined) {
      if (typeof patch.name !== "string" || !patch.name.trim()) throw bad("Provide a project name in name.");
      p.name = patch.name.trim();
      changed.push("name");
    }
    if (patch.summary !== undefined) {
      if (typeof patch.summary !== "string") throw bad("summary must be text.");
      p.summary = patch.summary.trim();
      changed.push("summary");
    }
    if (patch.request !== undefined) {
      if (typeof patch.request !== "string") throw bad("request must be text.");
      p.intake.request = patch.request;
      changed.push("request");
    }
    if (patch.sources !== undefined) {
      p.intake.sources = this.normalizeSources(patch.sources, actor, pd, p.intake.sources);
      changed.push("sources");
    }
    if (patch.options !== undefined) {
      p.intake.options = this.normalizeOptions(patch.options, DEFAULT_BRD_OPTIONS, p.intake.options);
      changed.push("options");
    }
    this.log(pd, "requirements", "note.added", actor, `${actorName(actor)} updated the intake${changed.length ? ` (${changed.join(", ")})` : ""}`);
  }

  addNote(id: string, body: NoteBody, actor: Actor): StageNote {
    const pd = this.get(id);
    if (!isRecord(body) || typeof body.stage !== "string" || !isStageId(body.stage)) throw bad("stage must be one of requirements, architecture, implementation, qa, signoff.");
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) throw bad("Provide the note text in text.");
    const note: StageNote = { id: this.nextId(pd, "note", "note"), text, by: actor, at: this.now() };
    if (body.anchor !== undefined) {
      if (!isRecord(body.anchor) || typeof body.anchor.docId !== "string") throw bad("anchor needs a docId.");
      note.anchor = { docId: body.anchor.docId };
      if (typeof body.anchor.section === "string") note.anchor.section = body.anchor.section;
      if (typeof body.anchor.quote === "string") note.anchor.quote = body.anchor.quote;
    }
    pd.project.stages[body.stage].notes.push(note);
    this.log(pd, body.stage, "note.added", actor, `${actorName(actor)} added a note to ${stageTitle(body.stage)}: ${shorten(text, 80)}`);
    return note;
  }

  deleteNote(id: string, noteId: string, actor: Actor): void {
    const pd = this.get(id);
    for (const def of STAGES) {
      const st = pd.project.stages[def.id];
      const i = st.notes.findIndex((n) => n.id === noteId);
      if (i < 0) continue;
      st.notes.splice(i, 1);
      this.log(pd, def.id, "note.added", actor, `${actorName(actor)} removed a note from ${def.title}`);
      return;
    }
    throw notFound(`Note ${noteId} not found`);
  }

  /**
   * `[BRD §Requirements "find an individual…"] text`, the inline-note form the workflows receive:
   * the anchor's document, section and (clipped) selected text, so the agent sees what it is about.
   */
  private noteText(pd: ProjectData, note: StageNote): string {
    if (!note.anchor) return note.text;
    const doc = pd.documents.find((d) => d.id === note.anchor?.docId);
    const label = doc ? KIND_LABEL[doc.kind] : note.anchor.docId.toUpperCase();
    const quote = note.anchor.quote?.replace(/\s+/g, " ").trim();
    return `[${label}${note.anchor.section ? ` §${note.anchor.section}` : ""}${quote ? ` "${clipQuote(quote)}"` : ""}] ${note.text}`;
  }

  /** Records that a run received these notes ("sent to <run>"). */
  private markSent(notes: StageNote[], runId: string): void {
    for (const n of notes) {
      n.sentToRunId ??= runId;
      n.sentToRunIds = uniq([...(n.sentToRunIds ?? (n.sentToRunId !== runId ? [n.sentToRunId] : [])), runId]);
    }
  }

  /**
   * The notes a dev-task run receives: Implementation notes that name no task (general ones) or
   * name this one, plus, for a QA loop-back, QA notes that name this task.
   */
  private taskNotes(pd: ProjectData, task: DeliveryTask, origin: "plan" | "qa"): StageNote[] {
    const refs = (t: DeliveryTask) => [t.id, ...(t.jiraKey ? [t.jiraKey] : [])];
    // Task refs are letters, digits and hyphens ("T-5", "CP-52155"); "T-5" must not match "T-50".
    const names = (text: string, ref: string) => new RegExp(`(^|[^A-Za-z0-9-])${ref}(?![0-9])`).test(text);
    const named = (n: StageNote) => pd.tasks.filter((t) => refs(t).some((r) => names(n.text, r)));
    const mine = (n: StageNote) => named(n).some((t) => t.id === task.id);
    const st = pd.project.stages;
    return [
      ...st.implementation.notes.filter((n) => mine(n) || !named(n).length),
      ...(origin === "qa" ? st.qa.notes.filter(mine) : []),
    ];
  }

  // -------------------------------------------------------------------------------------------
  // Runs
  // -------------------------------------------------------------------------------------------

  /** Record which project/stage/task a run belongs to. Idempotent (the orchestrator calls it too). */
  registerRun(projectId: string, stage: StageId, runId: string, workflow: string, taskId?: string): void {
    const pd = this.find(projectId);
    if (!pd) return;
    if (!this.owners.has(runId)) this.owners.set(runId, taskId ? { projectId, stage, workflow, taskId } : { projectId, stage, workflow });
    const st = pd.project.stages[stage];
    if (!st.runIds.includes(runId)) st.runIds.push(runId);
    const impl = pd.project.stages.implementation;
    if (workflow === "dev-plan" && !impl.planRunIds.includes(runId)) impl.planRunIds.push(runId);
    const task = taskId ? pd.tasks.find((t) => t.id === taskId) : undefined;
    if (task && workflow === "dev-task" && !task.runIds.includes(runId)) task.runIds.push(runId);
    if (task && workflow === "qa-verify" && !task.qa.runIds.includes(runId)) task.qa.runIds.push(runId);
  }

  private async startRun(pd: ProjectData, stage: StageId, body: StartRunBody, actor: Actor, taskId?: string): Promise<string> {
    let res: { runId: string };
    try {
      const meta = { projectId: pd.project.id, projectName: pd.project.name, actor: actorName(actor) };
      res = await this.weft.start(body, taskId ? { ...meta, taskId } : meta);
    } catch (err) {
      const status = weftErrorStatus(err);
      if (status !== undefined) throw status === 404 ? notFound(errorMessage(err)) : status === 409 ? conflict(errorMessage(err)) : bad(errorMessage(err));
      throw err;
    }
    const { runId } = res;
    this.registerRun(pd.project.id, stage, runId, body.workflow, taskId);
    const st = pd.project.stages[stage];
    st.startedAt ??= this.now();
    const task = taskId ? pd.tasks.find((t) => t.id === taskId) : undefined;
    this.log(pd, stage, "run.started", actor, `${actorName(actor)} started ${body.workflow} run ${runId}${task ? ` for ${taskLabel(task)}` : ""}`, {
      runId,
      href: `/runs/${runId}`,
      ...(taskId ? { taskId } : {}),
    });
    return runId;
  }

  private async openRunOf(runIds: string[]): Promise<string | undefined> {
    const last = runIds.at(-1);
    if (!last) return undefined;
    try {
      const run = await this.weft.run(last);
      return isOpenRun(run.status) ? last : undefined;
    } catch {
      return undefined;
    }
  }

  async startRequirements(id: string, actor: Actor): Promise<{ runId: string }> {
    const pd = this.get(id);
    const st = pd.project.stages.requirements;
    if (st.approvedAt) throw conflict("Requirements is approved; reopen it before running po-brd again.");
    const open = await this.openRunOf(st.runIds);
    if (open) throw conflict(`po-brd run ${open} is still open; answer or cancel it first.`);
    const body = this.poBrdBody(pd);
    return { runId: await this.startRun(pd, "requirements", body, actor) };
  }

  async startArchitecture(id: string, body: StartArchitectureBody, actor: Actor): Promise<{ runId: string }> {
    const pd = this.get(id);
    const p = pd.project;
    const st = p.stages.architecture;
    if (!p.stages.requirements.approvedAt) throw conflict("Architecture is locked until Requirements is approved.");
    if (st.approvedAt) throw conflict("Architecture is approved; reopen it before running architect-aad again.");
    const open = await this.openRunOf(st.runIds);
    if (open) throw conflict(`architect-aad run ${open} is still open; answer or cancel it first.`);
    const raw: Record<string, unknown> = isRecord(body) ? body : {};
    if (raw.request !== undefined && typeof raw.request !== "string") throw bad("request must be text.");
    const request = typeof raw.request === "string" ? raw.request : st.request;
    const sources = this.normalizeSources(raw.sources, actor, pd, st.sources);
    const options = this.normalizeOptions(raw.options, DEFAULT_AAD_OPTIONS, st.options);
    const brdDoc = pd.documents.find((d) => d.id === p.stages.requirements.brdDocId && d.status === "accepted");
    const brd = brdDoc?.path ?? "";
    const unsent = st.notes.filter((n) => !n.sentToRunId);
    const notes = [...sources.filter((s) => s.mapsTo === "notes").map((s) => s.value), ...unsent.map((n) => this.noteText(pd, n))];
    const seeds = sources.filter((s) => s.mapsTo === "seeds").map((s) => s.value);
    if (!brd && !request.trim() && !notes.length) throw bad("Provide a BRD path in brd, the architect's request in request, or at least one note.");
    st.request = request;
    st.sources = sources;
    st.options = options;
    const runId = await this.startRun(
      pd,
      "architecture",
      {
        workflow: "architect-aad",
        budget: options.budget ?? DOC_BUDGET.aad,
        input: { request, notes, seeds, out: p.docPaths.aad, brd, maxRounds: options.maxRounds, discover: options.discover, discoveryRounds: options.discoveryRounds, maxQueries: options.maxQueries },
      },
      actor,
    );
    this.markSent(unsent, runId);
    return { runId };
  }

  async startPlan(id: string, body: StartPlanBody, actor: Actor): Promise<{ runId: string }> {
    const pd = this.get(id);
    const p = pd.project;
    const st = p.stages.implementation;
    if (!p.stages.architecture.approvedAt) throw conflict("Implementation is locked until Architecture is approved.");
    if (st.approvedAt) throw conflict("Implementation is approved; reopen it before planning again.");
    if (st.planApprovedAt) throw conflict("The implementation plan is already approved.");
    const open = await this.openRunOf(st.planRunIds);
    if (open) throw conflict(`dev-plan run ${open} is still open; answer or cancel it first.`);
    const extra = isRecord(body) && typeof body.notes === "string" ? body.notes.trim() : "";
    if (extra) st.notes.push({ id: this.nextId(pd, "note", "note"), text: extra, by: actor, at: this.now() });
    const unsent = st.notes.filter((n) => !n.sentToRunId);
    const brd = pd.documents.find((d) => d.id === p.stages.requirements.brdDocId)?.path ?? p.docPaths.brd;
    const aad = pd.documents.find((d) => d.id === p.stages.architecture.aadDocId)?.path ?? p.docPaths.aad;
    const input: DevPlanInput = {
      projectId: p.id,
      brd,
      aad,
      out: p.docPaths.plan,
      notes: st.notes.map((n) => this.noteText(pd, n)),
      epics: pd.epics
        .filter((e) => !isParked(e))
        .map((e) => ({ id: e.id, key: e.key, title: e.title, brdRequirementRefs: e.brdRequirementRefs, aadRefs: e.aadRefs, systems: e.systems })),
      maxRounds: 3,
    };
    const runId = await this.startRun(pd, "implementation", { workflow: "dev-plan", budget: SPEC_BUDGET, input: input as unknown as Record<string, unknown> }, actor);
    this.markSent(unsent, runId);
    return { runId };
  }

  // -------------------------------------------------------------------------------------------
  // Documents
  // -------------------------------------------------------------------------------------------

  docOf(pd: ProjectData, kind: DocumentKind): StoredDoc | undefined {
    const s = pd.project.stages;
    const id = kind === "brd" ? s.requirements.brdDocId : kind === "aad" ? s.architecture.aadDocId : kind === "plan" ? s.implementation.planDocId : undefined;
    return id ? pd.documents.find((d) => d.id === id) : pd.documents.find((d) => d.kind === kind && d.status !== "superseded");
  }

  ensureDoc(pd: ProjectData, kind: DocumentKind, path: string, title?: string): StoredDoc {
    const existing = this.docOf(pd, kind);
    if (existing) return existing;
    const doc: StoredDoc = {
      id: this.nextId(pd, `doc:${kind}`, kind),
      projectId: pd.project.id,
      kind,
      title: title ?? (kind === "plan" ? "Implementation plan" : kind === "memory" ? "Shared memory" : kind === "ready-for-test" ? "Ready for test" : pd.project.name),
      path,
      status: "draft",
      versions: [],
      dependencies: [],
    };
    pd.documents.push(doc);
    const s = pd.project.stages;
    if (kind === "brd") s.requirements.brdDocId = doc.id;
    if (kind === "aad") s.architecture.aadDocId = doc.id;
    if (kind === "plan") s.implementation.planDocId = doc.id;
    return doc;
  }

  /** Append a version unless it repeats the latest one. */
  addVersion(doc: StoredDoc, v: Omit<DocVersion, "n">): DocVersion | undefined {
    const last = doc.versions.at(-1);
    if (last && last.sha256 === v.sha256) return undefined;
    const version: DocVersion = { n: doc.versions.length + 1, ...v };
    doc.versions.push(version);
    return version;
  }

  /** Refresh the parsed fields (title, BR/FR lists, questions, systems) from the document text. */
  applyParse(doc: StoredDoc, text: string): void {
    if (doc.kind === "brd") {
      const parsed = parseBrd(text);
      if (parsed.title) doc.title = parsed.title;
      doc.requirements = parsed.requirements;
      doc.openQuestions = parsed.openQuestions;
      doc.implementationPlan = parsed.implementationPlan;
    } else if (doc.kind === "aad") {
      const parsed = parseAad(text);
      if (parsed.title) doc.title = parsed.title;
      doc.frs = parsed.frs;
      doc.systems = parsed.systems;
      doc.openQuestions = parsed.openQuestions;
    }
  }

  async importDoc(id: string, stage: "requirements" | "architecture", body: ImportBody, actor: Actor): Promise<void> {
    const pd = this.get(id);
    const p = pd.project;
    if (stage !== "requirements" && stage !== "architecture") throw bad("Import is only available for requirements and architecture.");
    const st = p.stages[stage];
    if (st.approvedAt) throw conflict(`${stageTitle(stage)} is approved; reopen it before importing.`);
    const open = await this.openRunOf(st.runIds);
    if (open) throw conflict(`Run ${open} is still open on ${stageTitle(stage)}; answer or cancel it before importing.`);
    const { pageId } = checkImport(body);
    const kind = stage === "requirements" ? "brd" : "aad";
    let content = typeof body.content === "string" ? body.content.trim() : "";
    let title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : undefined;
    const ref = typeof body.ref === "string" ? body.ref.trim() : "";
    if (body.source === "confluence" && pageId) {
      if (!content) {
        // A page the mock catalog does not know takes its title from the URL slug, else the project name,
        // so the "fetched" document is about this project rather than an unrelated stand-in page.
        const fallbackTitle = title ?? (catalogItem(pageId) ? undefined : (confluenceUrlTitle(ref) ?? p.name));
        const fetched = mockConfluenceDoc(kind, pageId, fallbackTitle);
        content = fetched.content;
        title ??= fetched.title;
      }
    }
    if (!content) throw bad("Paste the document markdown in content.");
    const now = this.now();
    const path = p.docPaths[kind];
    this.host.fs.write(path, content);
    const blob = this.host.putBlob(content);
    const doc = this.ensureDoc(pd, kind, path, title);
    doc.path = path;
    this.addVersion(doc, {
      sha256: blob.$blob,
      blob: blob.$blob,
      at: now,
      source: "import",
      reason: body.source === "confluence" ? `Imported from Confluence page ${ref}` : "Pasted by hand",
    });
    doc.status = "accepted";
    doc.acceptedBy = actor;
    doc.acceptedAt = now;
    delete doc.lastReport;
    this.applyParse(doc, content);
    if (title && !doc.title) doc.title = title;
    st.imported = { docId: doc.id, source: body.source, by: actor, at: now, ...(ref ? { ref } : {}) };
    st.startedAt ??= now;
    this.log(
      pd,
      stage,
      "artifact.imported",
      actor,
      `${actorName(actor)} imported the ${KIND_LABEL[kind]}${body.source === "confluence" ? ` from Confluence page ${ref}` : " (pasted)"}`,
      { href: `/projects/${p.id}/docs/${doc.id}` },
      now,
    );
    if (kind === "brd") this.proposeEpics(pd, doc, now, actor);
    else {
      this.applyAadToEpics(pd, doc, now, actor);
      p.stages.architecture.epicUpdatesAcceptedAt = undefined;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Epics
  // -------------------------------------------------------------------------------------------

  /** BRD accepted → propose epics for requirements no epic covers yet. */
  proposeEpics(pd: ProjectData, doc: StoredDoc, at: number, by: Actor = agent("po-brd")): Epic[] {
    const covered = new Set(pd.epics.flatMap((e) => e.brdRequirementRefs));
    const curated = pd.epics.length ? undefined : this.curation.get(pd.project.id);
    let proposals: EpicProposal[];
    if (curated) {
      // Requirements the curated list misses (the content drifted) still get heuristic epics.
      const curatedRefs = new Set(curated.flatMap((c) => c.brdRequirementRefs));
      const rest = (doc.requirements ?? []).filter((r) => !curatedRefs.has(r.id));
      proposals = [...curated, ...(rest.length ? proposeEpicsFromBrd(doc.title, rest, [], pd.project.name) : [])];
    } else proposals = proposeEpicsFromBrd(doc.title, doc.requirements ?? [], doc.implementationPlan ?? [], pd.project.name);
    const created: Epic[] = [];
    for (const prop of proposals) {
      const refs = prop.brdRequirementRefs.filter((r) => !covered.has(r));
      if (prop.brdRequirementRefs.length && !refs.length) continue;
      if (!prop.brdRequirementRefs.length && pd.epics.some((e) => e.title === prop.title)) continue;
      const epic: Epic = {
        id: this.nextId(pd, "epic", "EP"),
        projectId: pd.project.id,
        key: null,
        title: prop.title,
        objective: prop.objective,
        context: prop.context,
        inScope: prop.inScope,
        brdRequirementRefs: refs,
        aadRefs: [],
        systems: [],
        designElements: [],
        status: "draft",
        origin: "requirements",
        history: [{ at, by, stage: "requirements", change: "Proposed from the BRD" }],
      };
      if (prop.blockedBy?.length) epic.blockedBy = prop.blockedBy;
      pd.epics.push(epic);
      created.push(epic);
    }
    if (created.length)
      this.log(pd, "requirements", "epic.proposed", by, `${plural(created.length, "epic")} proposed from the BRD`, { href: `/projects/${pd.project.id}/requirements?step=epics` }, at);
    return created;
  }

  /** AAD accepted → fill FR refs, design elements and systems on the epics, with history. */
  applyAadToEpics(pd: ProjectData, doc: StoredDoc, at: number, by: Actor = agent("architect-aad")): number {
    const updates = aadEpicUpdates(pd.epics, doc.frs ?? [], doc.systems ?? [], this.curation.get(pd.project.id));
    for (const u of updates) {
      Object.assign(u.epic, u.patch);
      u.epic.changedIn = "architecture";
      u.epic.history.push({ at, by, stage: "architecture", change: u.change, before: u.before });
      this.log(pd, "architecture", "epic.changed", by, `Epic ${u.epic.key ?? u.epic.title} changed in Architecture: ${u.change}`, { href: `/projects/${pd.project.id}/architecture?step=epics` }, at);
    }
    if (!updates.length) this.touch(pd, at);
    return updates.length;
  }

  private stringList(body: Record<string, unknown>, key: string): string[] | undefined {
    const v = body[key];
    if (v === undefined) return undefined;
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw bad(`${key} must be a list of strings.`);
    return (v as string[]).map((s) => s.trim()).filter(Boolean);
  }

  upsertEpic(id: string, body: EpicUpsertBody, actor: Actor): Epic {
    const pd = this.get(id);
    if (!isRecord(body)) throw bad("Request body must be a JSON object.");
    const now = this.now();
    const stage: StageId = pd.project.currentStage === "requirements" ? "requirements" : "architecture";
    const fields: Partial<Epic> = {};
    for (const key of ["title", "objective", "context", "parentRef"] as const) {
      const v = body[key];
      if (v === undefined) continue;
      if (typeof v !== "string") throw bad(`${key} must be text.`);
      fields[key] = v.trim();
    }
    for (const key of ["inScope", "brdRequirementRefs", "aadRefs", "systems", "designElements", "blockedBy"] as const) {
      const list = this.stringList(body, key);
      if (list) fields[key] = list;
    }
    if (body.id) {
      const epic = pd.epics.find((e) => e.id === body.id);
      if (!epic) throw notFound(`Epic ${body.id} not found`);
      if (fields.title === "") throw bad("Provide an epic title in title.");
      const before: Record<string, unknown> = {};
      const changed: string[] = [];
      for (const [k, v] of Object.entries(fields)) {
        const cur = (epic as unknown as Record<string, unknown>)[k];
        if (JSON.stringify(cur) === JSON.stringify(v)) continue;
        before[k] = cur;
        changed.push(k);
      }
      if (!changed.length) return epic;
      Object.assign(epic, fields);
      if (epic.blockedBy && !epic.blockedBy.length) delete epic.blockedBy;
      if (!epic.parentRef) delete epic.parentRef;
      epic.history.push({ at: now, by: actor, stage, change: `Edited ${changed.join(", ")}`, before: before as Epic["history"][number]["before"] });
      this.log(pd, stage, "epic.changed", actor, `${actorName(actor)} edited epic ${epic.key ?? epic.title} (${changed.join(", ")})`, { href: `/projects/${id}/${stage}?step=epics` });
      return epic;
    }
    if (!fields.title) throw bad("Provide an epic title in title.");
    const epic: Epic = {
      id: this.nextId(pd, "epic", "EP"),
      projectId: id,
      key: null,
      title: fields.title,
      objective: fields.objective ?? "",
      context: fields.context ?? "",
      inScope: fields.inScope ?? [],
      brdRequirementRefs: fields.brdRequirementRefs ?? [],
      aadRefs: fields.aadRefs ?? [],
      systems: fields.systems ?? [],
      designElements: fields.designElements ?? [],
      status: "draft",
      origin: stage,
      history: [{ at: now, by: actor, stage, change: "Added by hand" }],
    };
    if (fields.blockedBy?.length) epic.blockedBy = fields.blockedBy;
    if (fields.parentRef) epic.parentRef = fields.parentRef;
    pd.epics.push(epic);
    this.log(pd, stage, "epic.proposed", actor, `${actorName(actor)} added epic ${epic.title}`, { href: `/projects/${id}/${stage}?step=epics` });
    return epic;
  }

  deleteEpic(id: string, epicId: string, actor: Actor): void {
    const pd = this.get(id);
    const i = pd.epics.findIndex((e) => e.id === epicId);
    if (i < 0) throw notFound(`Epic ${epicId} not found`);
    const [epic] = pd.epics.splice(i, 1);
    const stage: StageId = pd.project.currentStage === "requirements" ? "requirements" : "architecture";
    this.log(pd, stage, "epic.changed", actor, `${actorName(actor)} deleted epic ${epic.key ?? epic.title}`);
  }

  acceptEpics(id: string, stage: "requirements" | "architecture", actor: Actor): void {
    const pd = this.get(id);
    const p = pd.project;
    if (stage !== "requirements" && stage !== "architecture") throw bad('stage must be "requirements" or "architecture".');
    if (stage === "architecture" && !p.stages.requirements.approvedAt) throw conflict("Architecture is locked until Requirements is approved.");
    if (p.stages[stage].approvedAt) throw conflict(`${stageTitle(stage)} is already approved.`);
    const doc = this.docOf(pd, stage === "requirements" ? "brd" : "aad");
    if (doc?.status !== "accepted") throw conflict(stage === "requirements" ? "Accept the BRD before accepting epics." : "Accept the AAD before accepting the epic updates.");
    const drafts = pd.epics.filter((e) => e.status === "draft" && !isParked(e));
    if (stage === "requirements" && !pd.epics.some((e) => !isParked(e))) throw conflict("There are no epics to accept yet; add at least one.");
    const now = this.now();
    for (const e of drafts) {
      e.status = "accepted";
      e.history.push({ at: now, by: actor, stage, change: "Accepted" });
    }
    if (stage === "requirements") {
      p.stages.requirements.epicsAcceptedAt = now;
      this.log(pd, stage, "epic.accepted", actor, `${actorName(actor)} accepted ${plural(drafts.length, "epic")}`, { href: `/projects/${id}/requirements?step=epics` });
    } else {
      p.stages.architecture.epicUpdatesAcceptedAt = now;
      const changed = pd.epics.filter((e) => e.changedIn === "architecture").length;
      this.log(pd, stage, "epic.accepted", actor, `${actorName(actor)} accepted the epic updates from the AAD (${plural(changed, "epic")} changed${drafts.length ? `, ${drafts.length} new` : ""})`, {
        href: `/projects/${id}/architecture?step=epics`,
      });
    }
  }

  syncEpics(id: string, actor: Actor): void {
    const pd = this.get(id);
    const todo = pd.epics.filter((e) => e.status === "accepted" && !e.key);
    if (!todo.length) throw conflict(pd.epics.some((e) => e.status === "synced") ? "All accepted epics are already in Jira." : "Accept the epics before creating them in Jira.");
    const now = this.now();
    const keys = this.allocJira(pd.project.jiraProject, todo.length);
    todo.forEach((e, i) => {
      e.key = keys[i];
      e.status = "synced";
      e.history.push({ at: now, by: actor, stage: pd.project.currentStage, change: `Created in Jira (mock) as ${keys[i]}` });
    });
    // Tasks planned before the sync get keys (and key-based branch names) now.
    const unkeyed = pd.tasks.filter((t) => !t.jiraKey);
    const taskKeys = this.allocJira(pd.project.jiraProject, unkeyed.length);
    unkeyed.forEach((t, i) => {
      t.jiraKey = taskKeys[i];
      if (!t.runIds.length) t.branch = branchFor(pd, t, t.jiraKey);
    });
    this.log(pd, pd.project.currentStage, "epic.synced", actor, `${actorName(actor)} created ${plural(todo.length, "epic")} in Jira (mock): ${keys.join(", ")}`, {
      href: `/projects/${id}/requirements?step=epics`,
    });
  }

  // -------------------------------------------------------------------------------------------
  // Tasks
  // -------------------------------------------------------------------------------------------

  /** dev-plan approved → DeliveryTask[] (existing unstarted tasks are updated in place). */
  createTasks(pd: ProjectData, planned: PlannedTask[], at: number): DeliveryTask[] {
    const synced = pd.epics.some((e) => e.status === "synced");
    const fresh = planned.filter((pt) => !pd.tasks.some((t) => t.id === pt.id));
    const keys = synced ? this.allocJira(pd.project.jiraProject, fresh.length) : [];
    let k = 0;
    for (const pt of planned) {
      const existing = pd.tasks.find((t) => t.id === pt.id);
      const acs = (pt.acceptanceCriteria ?? []).map((ac) => ({ id: ac.id, text: ac.text, met: false }));
      if (existing) {
        if (existing.status === "ready" || existing.status === "proposed" || existing.status === "blocked") {
          Object.assign(existing, plannedFields(pt), { acceptanceCriteria: acs });
          existing.status = pt.blockedBy ? "blocked" : "ready";
          if (pt.blockedBy) existing.blockedBy = pt.blockedBy;
        }
        continue;
      }
      const jiraKey = keys[k++] ?? null;
      const task: DeliveryTask = {
        ...plannedFields(pt),
        projectId: pd.project.id,
        acceptanceCriteria: acs,
        jiraKey,
        branch: "",
        status: pt.blockedBy ? "blocked" : "ready",
        runIds: [],
        reworkCount: 0,
        escalated: false,
        checks: [],
        qa: { status: "pending", runIds: [], evidenceIds: [], bugs: [] },
      };
      if (pt.blockedBy) task.blockedBy = pt.blockedBy;
      task.branch = branchFor(pd, task, jiraKey);
      pd.tasks.push(task);
    }
    for (const t of pd.tasks) {
      if (!planned.some((pt) => pt.id === t.id) && (t.status === "ready" || t.status === "proposed" || t.status === "blocked")) t.status = "cancelled";
    }
    this.touch(pd, at);
    return pd.tasks;
  }

  task(pd: ProjectData, taskId: string): DeliveryTask {
    const t = pd.tasks.find((x) => x.id === taskId);
    if (!t) throw notFound(`Task ${taskId} not found`);
    return t;
  }

  async startDevTask(pd: ProjectData, task: DeliveryTask, opts: { origin: "plan" | "qa"; feedback?: string; actor: Actor }): Promise<string> {
    const prev = { status: task.status, latestStep: task.latestStep, reworkCount: task.reworkCount, escalated: task.escalated, blockedBy: task.blockedBy };
    // Set the status before starting: in instant mode the run's first events can arrive first.
    task.status = "in_progress";
    task.latestStep = "Starting agent";
    task.reworkCount = 0;
    task.escalated = false;
    delete task.blockedBy;
    task.startedAt ??= this.now();
    delete task.finishedAt;
    if (opts.origin === "qa") {
      task.reworkFrom = "qa";
      if (opts.feedback) task.lastFeedback = opts.feedback;
    }
    pd.queue = pd.queue.filter((id) => id !== task.id);
    const input: DevTaskInput = {
      projectId: pd.project.id,
      task: { ...plannedOf(task), jiraKey: task.jiraKey, branch: task.branch },
      attempt: task.runIds.length + 1,
      origin: opts.origin,
      maxReworkCycles: 2,
    };
    if (opts.feedback) input.feedback = opts.feedback;
    const notes = this.taskNotes(pd, task, opts.origin);
    if (notes.length) input.notes = notes.map((n) => this.noteText(pd, n));
    try {
      const runId = await this.startRun(pd, opts.origin === "qa" ? "qa" : "implementation", { workflow: "dev-task", budget: SPEC_BUDGET, input: input as unknown as Record<string, unknown> }, opts.actor, task.id);
      this.markSent(notes, runId);
      return runId;
    } catch (err) {
      Object.assign(task, prev);
      if (!prev.blockedBy) delete task.blockedBy;
      throw err;
    }
  }

  async startQaRun(pd: ProjectData, task: DeliveryTask, actor: Actor): Promise<string> {
    const prev = task.qa.status;
    task.qa.status = "testing";
    const input: QaVerifyInput = {
      projectId: pd.project.id,
      task: { ...plannedOf(task), jiraKey: task.jiraKey, branch: task.branch },
      attempt: task.qa.runIds.length + 1,
      environment: QA_ENVIRONMENT,
    };
    const handoff = pd.project.stages.implementation.readyForTestNote;
    if (handoff?.trim()) input.readyForTest = handoff;
    try {
      return await this.startRun(pd, "qa", { workflow: "qa-verify", budget: SPEC_BUDGET, input: input as unknown as Record<string, unknown> }, actor, task.id);
    } catch (err) {
      task.qa.status = prev;
      throw err;
    }
  }

  /**
   * Start queued and auto-eligible tasks while agent slots are free (max 3), respecting
   * dependencies and, in all-waves mode, waves. Re-entrant calls coalesce into one extra pass.
   */
  async pump(pd: ProjectData, actor: Actor = SYSTEM): Promise<string[]> {
    const pid = pd.project.id;
    if (this.pumping.has(pid)) {
      this.repump.add(pid);
      return [];
    }
    this.pumping.add(pid);
    const started: string[] = [];
    try {
      do {
        this.repump.delete(pid);
        const impl = pd.project.stages.implementation;
        if (!impl.planApprovedAt || impl.approvedAt || !this.projects.has(pid)) break;
        const free = MAX_AGENTS - pd.tasks.filter(usesAgent).length;
        for (const t of this.candidates(pd).slice(0, Math.max(0, free))) {
          try {
            started.push(await this.startDevTask(pd, t, { origin: "plan", actor }));
          } catch (err) {
            pd.queue = pd.queue.filter((id) => id !== t.id);
            t.latestStep = `Could not start: ${errorMessage(err)}`;
          }
        }
        for (const id of pd.queue) {
          const t = pd.tasks.find((x) => x.id === id);
          if (!t || t.status !== "ready") continue;
          const waiting = unmetDeps(t, pd.tasks);
          t.latestStep = waiting.length ? `Queued: waiting for ${waiting.join(", ")}` : "Queued: waiting for a free agent";
        }
      } while (this.repump.has(pid));
    } finally {
      this.pumping.delete(pid);
    }
    pd.queue = pd.queue.filter((id) => pd.tasks.find((t) => t.id === id)?.status === "ready");
    this.touch(pd);
    return started;
  }

  private candidates(pd: ProjectData): DeliveryTask[] {
    const tasks = pd.tasks;
    const mode = pd.project.stages.implementation.startMode ?? "manual";
    const queued = pd.queue.map((id) => tasks.find((t) => t.id === id)).filter((t): t is DeliveryTask => !!t && isStartable(t, tasks));
    let auto: DeliveryTask[] = [];
    const ready = tasks.filter((t) => isStartable(t, tasks));
    if (mode === "all-waves") {
      const open = tasks.filter((t) => t.status !== "done" && t.status !== "cancelled" && t.status !== "blocked");
      const wave = open.length ? Math.min(...open.map((t) => t.wave)) : Infinity;
      auto = ready.filter((t) => t.wave <= wave);
      // A task can wait on a later wave (e.g. after a wave edit); when nothing in flight would
      // unblock the current wave, release the earliest wave that has startable work.
      if (!auto.length && ready.length && !tasks.some(isInFlight)) {
        const next = Math.min(...ready.map((t) => t.wave));
        auto = ready.filter((t) => t.wave <= next);
      }
    } else if (mode === "first-wave" && tasks.length) {
      const first = Math.min(...tasks.map((t) => t.wave));
      auto = ready.filter((t) => t.wave === first && !t.runIds.length);
    }
    auto.sort((a, b) => a.wave - b.wave || taskOrder(a) - taskOrder(b));
    return uniqBy([...queued, ...auto], (t) => t.id);
  }

  async startTasks(id: string, body: TaskStartBody, actor: Actor): Promise<{ runIds: string[] }> {
    const pd = this.get(id);
    const impl = pd.project.stages.implementation;
    if (!impl.planApprovedAt) throw conflict("Approve the implementation plan before starting tasks.");
    if (impl.approvedAt) throw conflict("Implementation is approved; reopen it to run more tasks.");
    const raw: Record<string, unknown> = isRecord(body) ? body : {};
    let targets: DeliveryTask[];
    if (Array.isArray(raw.taskIds) && raw.taskIds.length) {
      const ids = asStringArray(raw.taskIds);
      const tasks = ids.map((tid) => this.task(pd, tid));
      targets = tasks.filter((t) => t.status === "ready");
      if (!targets.length) throw conflict(`${tasks.map(taskLabel).join(", ")} ${tasks.length === 1 ? "is" : "are"} not ready (${tasks.map((t) => t.status).join(", ")}).`);
    } else if (raw.wave !== undefined) {
      if (typeof raw.wave !== "number") throw bad("wave must be a number.");
      targets = pd.tasks.filter((t) => t.wave === raw.wave && t.status === "ready");
    } else targets = pd.tasks.filter((t) => t.status === "ready");
    if (!targets.length) throw conflict("No ready tasks to start.");
    for (const t of targets) if (!pd.queue.includes(t.id)) pd.queue.push(t.id);
    this.log(pd, "implementation", "task.status", actor, `${actorName(actor)} started ${plural(targets.length, "task")}: ${targets.map(taskLabel).join(", ")}`, {
      href: `/projects/${id}/implementation?step=execution`,
    });
    return { runIds: await this.pump(pd, actor) };
  }

  /** Seeding and retries: start one task now, ignoring dependencies and agent slots. */
  async startTaskNow(id: string, taskId: string, actor: Actor): Promise<string> {
    const pd = this.get(id);
    const task = this.task(pd, taskId);
    return this.startDevTask(pd, task, { origin: "plan", actor });
  }

  async patchTask(id: string, taskId: string, body: TaskPatchBody & { blockedBy?: string | null }, actor: Actor): Promise<DeliveryTask> {
    const pd = this.get(id);
    const task = this.task(pd, taskId);
    if (!isRecord(body)) throw bad("Request body must be a JSON object.");
    const label = taskLabel(task);
    const planned = Object.keys(body).filter((k) => k !== "status" && k !== "blockedBy");
    // The open dev-task run holds the task as it was started, so planned fields stay fixed until it ends.
    if (planned.length && isInFlight(task)) throw conflict(`${label} has an open dev-task run; finish its review or cancel it before editing the task.`);
    const before: Record<string, unknown> = {};
    const set = <K extends keyof DeliveryTask>(k: K, v: DeliveryTask[K]) => {
      before[k] = task[k];
      task[k] = v;
    };
    for (const k of ["title", "description", "repo"] as const) {
      if (body[k] === undefined) continue;
      if (typeof body[k] !== "string" || (k === "title" && !body[k]!.trim())) throw bad(`${k} must be ${k === "title" ? "non-empty " : ""}text.`);
      set(k, body[k]!.trim());
    }
    if (body.priority !== undefined) {
      if (!["low", "medium", "high", "critical"].includes(body.priority)) throw bad("priority must be low, medium, high or critical.");
      set("priority", body.priority);
    }
    if (body.size !== undefined) {
      if (!["XS", "S", "M", "L"].includes(body.size)) throw bad("size must be XS, S, M or L.");
      set("size", body.size);
    }
    if (body.wave !== undefined) {
      if (typeof body.wave !== "number" || !Number.isInteger(body.wave) || body.wave < 1) throw bad("wave must be a positive integer.");
      set("wave", body.wave);
    }
    if (body.dependencies !== undefined) {
      const deps = asStringArray(body.dependencies);
      if (deps.length !== (body.dependencies as unknown[]).length) throw bad("dependencies must be a list of task ids.");
      for (const d of deps) {
        if (d === task.id) throw bad(`${task.id} cannot depend on itself.`);
        if (!pd.tasks.some((t) => t.id === d)) throw bad(`Unknown dependency ${d}.`);
      }
      set("dependencies", uniq(deps));
    }
    if (body.traces !== undefined) {
      const traces = asStringArray(body.traces);
      if (traces.length !== (body.traces as unknown[]).length) throw bad("traces must be a list of strings.");
      set("traces", uniq(traces));
    }
    if (body.acceptanceCriteria !== undefined) {
      if (!Array.isArray(body.acceptanceCriteria)) throw bad("acceptanceCriteria must be a list.");
      const acs = body.acceptanceCriteria.map((ac, i) => {
        if (!isRecord(ac) || typeof ac.text !== "string" || !ac.text.trim()) throw bad(`acceptanceCriteria[${i}] needs text.`);
        const acId = typeof ac.id === "string" && /^AC-[1-9][0-9]*$/.test(ac.id) ? ac.id : `AC-${i + 1}`;
        const prior = task.acceptanceCriteria.find((x) => x.id === acId);
        return { id: acId, text: ac.text.trim(), met: typeof ac.met === "boolean" ? ac.met : (prior?.met ?? false), ...(prior?.evidenceIds ? { evidenceIds: prior.evidenceIds } : {}) };
      });
      set("acceptanceCriteria", acs);
    }
    let cancelRun: string | undefined;
    if (body.status !== undefined && body.status !== task.status) {
      const from = task.status;
      const to = body.status;
      const allowed: Partial<Record<DeliveryTask["status"], DeliveryTask["status"][]>> = {
        proposed: ["ready", "blocked", "cancelled"],
        ready: ["blocked", "cancelled"],
        blocked: ["ready", "cancelled"],
        cancelled: ["ready"],
        in_progress: ["cancelled"],
        verifying: ["cancelled"],
        in_review: ["cancelled"],
        changes_requested: ["cancelled"],
      };
      if (!allowed[from]?.includes(to)) throw conflict(`Cannot change ${label} from ${from} to ${to}.`);
      set("status", to);
      if (to === "cancelled") {
        cancelRun = task.runIds.at(-1);
        pd.queue = pd.queue.filter((q) => q !== task.id);
        delete task.latestStep;
      }
      if (to !== "blocked") delete task.blockedBy;
    }
    if (body.blockedBy !== undefined) {
      if (body.blockedBy === null || body.blockedBy === "") delete task.blockedBy;
      else if (typeof body.blockedBy !== "string") throw bad("blockedBy must be text.");
      else task.blockedBy = body.blockedBy.trim();
    }
    if (planned.some((k) => k === "title" || k === "repo") && !task.runIds.length) task.branch = branchFor(pd, task, task.jiraKey);
    const changed = Object.keys(before);
    const text =
      body.status !== undefined && before.status !== undefined
        ? `${actorName(actor)} set ${label} to ${task.status}${task.blockedBy ? ` (${task.blockedBy})` : ""}`
        : `${actorName(actor)} edited ${label}${changed.length ? ` (${changed.join(", ")})` : ""}`;
    this.log(pd, "implementation", "task.status", actor, text, { taskId: task.id, href: `/projects/${id}/tasks/${task.id}` });
    if (cancelRun) {
      try {
        const run = await this.weft.run(cancelRun);
        if (isOpenRun(run.status)) await this.weft.cancel(cancelRun);
      } catch {
        // the run is gone or already finished
      }
    }
    if (task.status === "ready") await this.pump(pd, actor);
    return task;
  }

  async retryTask(id: string, taskId: string, actor: Actor): Promise<{ runId: string }> {
    const pd = this.get(id);
    const task = this.task(pd, taskId);
    const label = taskLabel(task);
    if (!pd.project.stages.implementation.planApprovedAt) throw conflict("Approve the implementation plan before running tasks.");
    if (task.status === "done") throw conflict(`${label} is done; there is nothing to retry.`);
    const open = await this.openRunOf(task.runIds);
    if (open) throw conflict(`${label} already has an open run (${open}).`);
    const origin = task.reworkFrom === "qa" && task.qa.status === "bugs_found" ? "qa" : "plan";
    const runId = await this.startDevTask(pd, task, { origin, feedback: task.lastFeedback, actor });
    return { runId };
  }

  // -------------------------------------------------------------------------------------------
  // QA
  // -------------------------------------------------------------------------------------------

  attachEvidence(pd: ProjectData, task: DeliveryTask, runId: string, out: QaReportStepOutput, at: number): void {
    const drafts = Array.isArray(out?.evidence) ? out.evidence : [];
    const created = drafts.map((d) => ({ ...d, id: this.nextId(pd, "evidence", "EV"), projectId: pd.project.id, taskId: task.id, runId, observedAt: at, producedBy: agent("qa-verify") }));
    for (const old of pd.evidence) {
      if (old.taskId !== task.id || old.supersededBy) continue;
      const newer = created.find((c) => c.kind === old.kind && c.title === old.title);
      if (newer) old.supersededBy = newer.id;
    }
    pd.evidence.push(...created);
    task.qa.evidenceIds = pd.evidence.filter((e) => e.taskId === task.id && !e.supersededBy).map((e) => e.id);
    for (const ac of task.acceptanceCriteria) {
      const hits = created.flatMap((e) => e.criterionResults.filter((c) => c.criterionId === ac.id).map((c) => ({ e, c })));
      if (hits.length) ac.evidenceIds = hits.map((h) => h.e.id);
      const crit = Array.isArray(out?.criteria) ? out.criteria.find((c) => c.id === ac.id) : undefined;
      if (crit) ac.met = crit.result === "pass";
      else if (hits.length) ac.met = hits.every((h) => h.c.result === "pass");
    }
    this.log(pd, "qa", "evidence.attached", agent("qa-verify"), `qa-verify attached ${plural(created.length, "evidence item")} to ${taskLabel(task)}`, {
      runId,
      taskId: task.id,
      href: `/projects/${pd.project.id}/tasks/${task.id}`,
    }, at);
  }

  async startQa(id: string, body: QaStartBody, actor: Actor): Promise<{ runIds: string[] }> {
    const pd = this.get(id);
    const p = pd.project;
    if (!p.stages.implementation.approvedAt) throw conflict("QA starts once Implementation is approved.");
    if (p.stages.qa.approvedAt) throw conflict("QA Certification is already approved.");
    const raw: Record<string, unknown> = isRecord(body) ? body : {};
    let targets: DeliveryTask[];
    if (Array.isArray(raw.taskIds) && raw.taskIds.length) {
      targets = asStringArray(raw.taskIds).map((tid) => this.task(pd, tid));
      for (const t of targets) {
        if (t.status !== "done") throw conflict(`${taskLabel(t)} is not done yet (${t.status}).`);
        if (t.qa.status === "testing" || t.qa.status === "in_review") throw conflict(`${taskLabel(t)} is already being tested.`);
      }
    } else targets = pd.tasks.filter((t) => t.status === "done" && (t.qa.status === "pending" || t.qa.status === "blocked"));
    if (!targets.length) throw conflict("No tasks are waiting for QA.");
    const runIds: string[] = [];
    for (const t of targets) runIds.push(await this.startQaRun(pd, t, actor));
    return { runIds };
  }

  async waiveTrace(id: string, brRef: string, body: WaiveBody, actor: Actor): Promise<TraceRow> {
    const pd = this.get(id);
    const comment = isRecord(body) && typeof body.comment === "string" ? body.comment.trim() : "";
    if (!comment) throw bad("Add a comment explaining the waiver.");
    if (pd.project.stages.qa.approvedAt) throw conflict("QA Certification is already approved.");
    if (!buildTrace(pd).some((r) => r.brRef === brRef)) throw notFound(`Requirement ${brRef} not found in the accepted BRD.`);
    const now = this.now();
    pd.waivers[brRef] = this.decision(pd, "approved", actor, now, comment);
    this.log(pd, "qa", "qa.verdict", actor, `${actorName(actor)} waived ${brRef}: ${shorten(comment, 80)}`, { href: `/projects/${id}/qa?step=traceability` });
    return buildTrace(pd).find((r) => r.brRef === brRef)!;
  }

  /** Code (per repo), memory and doc changes QA must confirm against the requirements. */
  refreshChangeReviews(pd: ProjectData, at = this.now()): void {
    const want: Array<Omit<ChangeReview, "id" | "projectId">> = [];
    const done = pd.tasks.filter((t) => t.status === "done");
    for (const repo of uniq(done.map((t) => t.repo))) {
      const ts = done.filter((t) => t.repo === repo);
      want.push({
        kind: "code",
        label: repo,
        summary: `${plural(ts.length, "task")}: ${ts.map(taskLabel).join(", ")}`,
        files: ts.reduce((n, t) => n + (t.diffStats?.files ?? 0), 0),
        adds: ts.reduce((n, t) => n + (t.diffStats?.adds ?? 0), 0),
        dels: ts.reduce((n, t) => n + (t.diffStats?.dels ?? 0), 0),
        sourceRunIds: ts.flatMap((t) => t.runIds),
      });
    }
    const docs = (["brd", "aad"] as const).map((k) => this.docOf(pd, k)).filter((d): d is StoredDoc => !!d && d.status === "accepted");
    const memoryDocs = docs.filter((d) => d.memory && d.memory.changes.length);
    if (memoryDocs.length) {
      want.push({
        kind: "memory",
        label: "memory/memory.md",
        summary: memoryDocs.map((d) => `${KIND_LABEL[d.kind]}: ${d.memory!.status}, ${plural(d.memory!.changes.length, "change")}`).join(" · "),
        sourceRunIds: memoryDocs.flatMap((d) => d.versions.map((v) => v.runId).filter((r): r is string => !!r)).filter((r, i, a) => a.indexOf(r) === i),
      });
    }
    for (const d of docs) {
      want.push({
        kind: "docs",
        label: d.path,
        summary: `${KIND_LABEL[d.kind]} v${d.versions.length} accepted${d.acceptedBy ? ` by ${actorName(d.acceptedBy)}` : ""}`,
        sourceRunIds: uniq(d.versions.map((v) => v.runId).filter((r): r is string => !!r)),
      });
    }
    for (const w of want) {
      const existing = pd.changeReviews.find((c) => c.kind === w.kind && c.label === w.label);
      if (!existing) {
        pd.changeReviews.push({ id: this.nextId(pd, "change", "CR"), projectId: pd.project.id, ...w });
        continue;
      }
      const changed = JSON.stringify(existing.sourceRunIds) !== JSON.stringify(w.sourceRunIds);
      Object.assign(existing, w);
      if (changed) {
        delete existing.consistent;
        delete existing.by;
        delete existing.at;
        delete existing.comment;
      }
    }
    this.touch(pd, at);
  }

  reviewChange(id: string, changeId: string, body: ChangeReviewBody, actor: Actor): ChangeReview {
    const pd = this.get(id);
    if (!isRecord(body) || typeof body.consistent !== "boolean") throw bad("consistent must be true or false.");
    const review = pd.changeReviews.find((c) => c.id === changeId);
    if (!review) throw notFound(`Change ${changeId} not found`);
    const comment = typeof body.comment === "string" ? body.comment.trim() : "";
    if (!body.consistent && !comment) throw bad("Add a comment describing what does not match the requirements.");
    review.consistent = body.consistent;
    review.by = actor;
    review.at = this.now();
    if (comment) review.comment = comment;
    else delete review.comment;
    this.log(pd, "qa", "qa.verdict", actor, `${actorName(actor)} marked ${review.label} ${body.consistent ? "consistent" : "inconsistent"} with the requirements`, {
      href: `/projects/${id}/qa?step=changes`,
    });
    return review;
  }

  // -------------------------------------------------------------------------------------------
  // Gates
  // -------------------------------------------------------------------------------------------

  async decideStage(id: string, stage: StageId, body: DecisionBody & { readyForTestNote?: string }, actor: Actor): Promise<void> {
    const pd = this.get(id);
    const p = pd.project;
    if (!isRecord(body) || (body.decision !== "approved" && body.decision !== "changes_requested")) throw bad("decision must be approved or changes_requested.");
    const { view } = await this.view(id);
    const sv = view.stages[stage];
    const st = p.stages[stage];
    const title = stageTitle(stage);
    if (sv.status === "locked") throw conflict(`${title} is locked until ${stageTitle(prevStageOf(stage)!)} is approved.`);
    if (st.approvedAt) throw conflict(`${title} is already approved.`);
    const comment = typeof body.comment === "string" ? body.comment.trim() : "";
    const now = this.now();
    if (body.decision === "changes_requested") {
      if (!comment) throw bad("Add a comment saying what needs to change.");
      st.decisions.push(this.decision(pd, "changes_requested", actor, now, comment));
      this.log(pd, stage, "stage.changes_requested", actor, `${actorName(actor)} requested changes on ${title}: ${shorten(comment, 80)}`, { href: `/projects/${id}/${stage}` });
      return;
    }
    if (sv.blockers.length) throw conflict(`Cannot approve ${title} yet: ${sv.blockers.join("; ")}.`);
    const acked = asStringArray(body.acknowledgedWarnings);
    const missing = sv.warnings.filter((w) => !acked.includes(w));
    if (missing.length) throw conflict(`Acknowledge the warnings first: ${missing.join("; ")}.`);
    st.decisions.push(this.decision(pd, "approved", actor, now, comment || undefined, sv.warnings));
    st.approvedAt = now;
    delete st.stale;
    const next = nextStageOf(stage);
    if (stage === "implementation") {
      const impl = p.stages.implementation;
      // The gate dialog prefills the same shared draft and sends the note only when edited.
      const draft = readyForTestDraft(pd);
      const sent = typeof body.readyForTestNote === "string" && body.readyForTestNote.trim() ? body.readyForTestNote : undefined;
      impl.readyForTestNote = sent ?? draft;
      const path = `.deliver/ready-for-test/${p.id}.md`;
      this.host.fs.write(path, impl.readyForTestNote);
      const blob = this.host.putBlob(impl.readyForTestNote);
      const doc = this.ensureDoc(pd, "ready-for-test", path, "Ready for test");
      this.addVersion(doc, { sha256: blob.$blob, blob: blob.$blob, at: now, source: sent !== undefined && sent !== draft ? "human-edit" : "agent", reason: "Written at the Implementation gate" });
      doc.status = "accepted";
      doc.acceptedBy = actor;
      doc.acceptedAt = now;
      this.refreshChangeReviews(pd, now);
    }
    if (next) {
      if (stageIndex(p.currentStage) <= stageIndex(stage)) p.currentStage = next;
    } else {
      p.done = true;
      p.doneAt = now;
    }
    const ack = sv.warnings.length ? ` · ${plural(sv.warnings.length, "warning")} acknowledged` : "";
    this.log(pd, stage, "stage.approved", actor, `${actorName(actor)} approved ${title}${next ? ` → ${stageTitle(next)}` : ""}${ack}`, { href: `/projects/${id}/${stage}` }, now);
    if (!next) this.log(pd, stage, "project.done", actor, `${actorName(actor)} signed off ${p.name}; the project is done`, { href: `/projects/${id}` }, now);
  }

  reopenStage(id: string, stage: StageId, body: ReopenBody, actor: Actor): void {
    const pd = this.get(id);
    const p = pd.project;
    const comment = isRecord(body) && typeof body.comment === "string" ? body.comment.trim() : "";
    if (!comment) throw bad("Add a comment explaining why the stage is reopened.");
    const st = p.stages[stage];
    const title = stageTitle(stage);
    if (!st.approvedAt) throw conflict(`${title} is not approved; there is nothing to reopen.`);
    const now = this.now();
    const from: StageId = p.done ? "signoff" : p.currentStage;
    st.decisions.push(this.decision(pd, "changes_requested", actor, now, comment));
    delete st.approvedAt;
    st.reopened = [...(st.reopened ?? []), { at: now, by: actor, comment, fromStage: from }];
    const i = stageIndex(stage);
    for (const def of STAGES.slice(i + 1)) {
      const later = p.stages[def.id];
      // Only a stage with something in it goes stale; one nobody started just locks again.
      if (!hasStageWork(pd, def.id)) continue;
      later.stale = { since: now, reason: `${title} was reopened: ${comment}` };
      delete later.approvedAt;
    }
    p.currentStage = stage;
    p.done = false;
    delete p.doneAt;
    if (stage === "implementation") delete p.stages.implementation.readyForTestNote;
    this.log(pd, stage, "stage.reopened", actor, `${actorName(actor)} reopened ${title}: ${shorten(comment, 80)}`, { href: `/projects/${id}/${stage}` }, now);
  }
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/** Selected text for an anchored note, clipped at a word: "find an individual ambassador by…". */
function clipQuote(text: string, max = 60): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, "")}…`;
}

/** A stage that was approved or holds runs, documents, epic or task work, reviews or decisions. */
function hasStageWork(pd: ProjectData, stage: StageId): boolean {
  const s = pd.project.stages;
  const st = s[stage];
  if (st.approvedAt || st.runIds.length || st.decisions.length || st.startedAt) return true;
  switch (stage) {
    case "requirements":
      return !!s.requirements.imported || !!s.requirements.brdDocId;
    case "architecture":
      return !!s.architecture.imported || !!s.architecture.aadDocId || !!s.architecture.epicUpdatesAcceptedAt;
    case "implementation":
      return s.implementation.planRunIds.length > 0 || !!s.implementation.planApprovedAt || pd.tasks.some((t) => t.runIds.length > 0);
    case "qa":
      return pd.tasks.some((t) => t.qa.runIds.length > 0 || t.qa.review !== undefined) || pd.evidence.length > 0 || pd.changeReviews.some((c) => c.consistent !== undefined);
    case "signoff":
      return false;
  }
}

/** "…/pages/99887766/Payout+Preview" -> "Payout Preview". */
function confluenceUrlTitle(ref: string): string | undefined {
  const slug = ref.match(/\/pages\/\d+\/([^/?#]+)/)?.[1];
  if (!slug) return undefined;
  let text = slug;
  try {
    text = decodeURIComponent(slug.replace(/\+/g, " "));
  } catch {
    // keep the raw slug
  }
  text = text.replace(/[-_+]+/g, " ").replace(/\s+/g, " ").trim();
  return text || undefined;
}

/** Shape checks for an ImportBody, shared by project creation (before anything exists) and import. */
function checkImport(body: unknown): { pageId?: string } {
  if (!isRecord(body) || (body.source !== "paste" && body.source !== "confluence")) throw bad("source must be paste or confluence.");
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (body.source === "paste") {
    if (!content) throw bad("Paste the document markdown in content.");
    return {};
  }
  const ref = typeof body.ref === "string" ? body.ref.trim() : "";
  if (!ref) throw bad("Provide a Confluence page id or URL in ref.");
  const pageId = ref.match(/^\d+$/)?.[0] ?? ref.match(/\/pages\/(\d+)/)?.[1] ?? ref.match(/[?&]pageId=(\d+)/)?.[1];
  if (!pageId) throw bad(`"${ref}" is not a Confluence page id or URL.`);
  return { pageId };
}

function plannedFields(pt: PlannedTask): Omit<DeliveryTask, "projectId" | "acceptanceCriteria" | "jiraKey" | "branch" | "status" | "runIds" | "reworkCount" | "escalated" | "checks" | "qa"> {
  return {
    id: pt.id,
    title: pt.title,
    description: pt.description ?? "",
    priority: pt.priority ?? "medium",
    tags: pt.tags ?? [],
    dependencies: pt.dependencies ?? [],
    relatedFiles: pt.relatedFiles ?? [],
    epicId: pt.epicId ?? "",
    type: pt.type ?? "task",
    repo: pt.repo ?? "",
    size: pt.size ?? "M",
    team: pt.team ?? "",
    wave: pt.wave ?? 1,
    traces: pt.traces ?? [],
  };
}

export function plannedOf(t: DeliveryTask): PlannedTask {
  const out: PlannedTask = {
    id: t.id,
    title: t.title,
    description: t.description,
    priority: t.priority,
    tags: t.tags,
    dependencies: t.dependencies,
    relatedFiles: t.relatedFiles,
    acceptanceCriteria: t.acceptanceCriteria.map((ac) => ({ id: ac.id, text: ac.text })),
    epicId: t.epicId,
    type: t.type,
    repo: t.repo,
    size: t.size,
    team: t.team,
    wave: t.wave,
    traces: t.traces,
  };
  if (t.blockedBy) out.blockedBy = t.blockedBy;
  return out;
}

/** `<type>-<KEY>-<slug>`, e.g. feature-CP-52155-agreement-progress-page. */
export function branchFor(pd: ProjectData, t: Pick<DeliveryTask, "id" | "title" | "type">, key: string | null): string {
  const prefix = t.type === "bug" ? "bugfix" : t.type === "spike" ? "spike" : "feature";
  const slug = slugify(t.title.replace(/^\[[^\]]*\]\s*/, "")).slice(0, 40).replace(/-+$/, "");
  return `${prefix}-${key ?? `${pd.project.key}-${t.id}`}-${slug}`;
}

function taskOrder(t: DeliveryTask): number {
  return Number(t.id.replace(/\D+/g, "")) || 0;
}

function uniqBy<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((t) => {
    const k = key(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export { depsSatisfied };
