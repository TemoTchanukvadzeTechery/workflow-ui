# workflow-ui build spec

A Next.js 16 **mock** frontend for a five-stage, agent-assisted delivery flow. It will later be wired to the real weft daemon (`../weft`). Today only two stages have real weft workflows (`po-brd`, `architect-aad` in `../po-workspace/.weft/workflows`); the rest are mocked with workflows shaped like them.

This file is the contract for everyone building the app. Where it disagrees with the research brief (`$SCRATCH/brief.md`), **this file wins**.

- Research brief (exact weft shapes, real questions, seed content, design patterns): `/tmp/claude-1000/-home-tchan-Projects-Techery-workflow-ui/7e210aa0-15a2-47ce-bc8c-ac4e7632bb08/scratchpad/brief.md`
- Raw research reports: same folder, `report-*.md`
- Next.js 16 rules: same folder, `next16-notes.md` (read it; Next 16 differs from what you know)

## 1. Product

| # | Stage | Owner (label only) | Workflow(s) | Result |
|---|---|---|---|---|
| 1 | Requirements | Product Owner | `po-brd` [REAL] | BRD (accepted) + epics (accepted, then mock "Create in Jira") |
| 2 | Architecture | Architect | `architect-aad` [REAL] | AAD (accepted) + epic updates (accepted) |
| 3 | Implementation | Developer | `dev-plan`, `dev-task` [SPEC] | Dev notes → generated task plan → dev approves → agents implement + verify each task → dev approves each task |
| 4 | QA Certification | QA | `qa-verify` [SPEC] | Agent runs automated + manual tests with proof; QA reviews each task; trace matrix + code/memory change review; final approval |
| 5 | PO Review | Product Owner | none | PO signs off; project is Done |

**Decisions the user made (binding):**

1. **No roles.** Anyone can do and approve anything. Every decision records the "Acting as" name (header `x-actor`), shown in the top bar with the note "No roles yet: anyone can approve".
2. **Requirement channels: Jira + Confluence only** (po-brd `seeds`), plus notes (po-brd `notes`: a repo note file such as `notes/examples/reorder-reminders.md`, or pasted note text). No Slack, uploads, transcripts, Figma, "coming soon" badges or similar.
3. **Rejections loop back.** Documents get another revise round inside their stage (the real `revise` decision). A task the developer rejects gets a rework cycle inside its dev-task run. A task QA rejects (`bugs-found`) **loops back to implementation**: a new dev-task run starts automatically with the bugs as feedback, the developer reviews it again, then qa-verify runs again automatically. The project stays in Stage 4 meanwhile. Earlier stages can be **reopened explicitly** (e.g. PO "Send back" at Stage 5, or "Reopen" on any approved stage); later stages then show a *stale* banner until they are re-approved.
4. **Live simulation.** Runs progress on server-side timers: steps tick, cost accrues, runs pause with "Needs your input", like weft. Speed setting: instant / fast (default) / realistic.
5. **Mock backend in Next.js route handlers**, in-memory, seeded on first access, reset from Settings. The browser talks HTTP only. `/api/weft/*` mirrors the weft daemon API exactly so it can later proxy to `http://127.0.0.1:4781`.
6. **Visual style: the Dribbble reference** (cool grey + cobalt, bento cards, neo-grotesk, light + dark). Status meaning follows weft. Tokens are isolated so a weft-warm theme is a token swap.
7. **Epics:** proposed from the BRD, updated by architecture, accepted by a human, then a mock **"Create in Jira"** assigns keys (`<jiraProject>-52140…`). Banner: "Mock: po-brd and architect-aad do not write to Jira today."
8. **Mid-flow projects:** seeded demo projects at every stage, plus **Import existing BRD / AAD** (paste markdown, or a Confluence page id/URL that the mock "fetches") on project creation and on the Stage 1/2 page. An imported document skips that stage's run; the stage still needs epics accepted and its gate approved.

**Wording:** agent output is **Draft**/**Produced** until a human **Accepts** it; never call unaccepted work "Done". Use the real weft question text verbatim in human-request cards. No emoji anywhere; icons are lucide.

## 2. Architecture

```
Browser (client components, TanStack Query)
  │  fetch /api/weft/*  /api/delivery/*      EventSource /api/events
  ▼
Next.js route handlers (Node runtime)
  ├─ src/app/api/weft/[...path]/route.ts      → src/server/mock/daemon.ts (mock) | proxy to WEFT_DAEMON (settings.dataSource === "weft")
  ├─ src/app/api/delivery/[...path]/route.ts  → src/server/delivery/router.ts
  └─ src/app/api/events/route.ts              → src/server/bus.ts (SSE)
        │
src/server/runtime.ts  getRuntime(): { engine: MockEngine; store: DeliveryStore; bus: Bus }   (globalThis singleton; seeds on first call)
  ├─ src/server/mock/engine/*   the mock weft engine (journal → reduce → RunDetail), timers, human requests, blobs, workspace fs
  ├─ src/server/mock/workflows/* scripts: po-brd, architect-aad, dev-plan, dev-task, qa-verify (+ content packs)
  └─ src/server/delivery/*      projects, stages, epics, tasks, evidence, trace, inbox, dashboard, orchestrator, seeds
```

- All server code starts with `import "server-only";` and lives under `src/server/`. Client code never imports from `src/server/`.
- Isomorphic shared code: `src/lib/weft/*`, `src/lib/delivery/*` (types + pure helpers only).
- The singleton lives on `globalThis.__workflowUi` so HMR does not reset state. Route handlers export `export const dynamic = "force-dynamic"`.
- The delivery store talks to weft **only** through the `WeftBackend` interface (`src/server/mock/engine/api.ts`), so a real daemon (`src/server/weft/http-backend.ts`) can replace the mock engine. The orchestrator reacts to `WeftBackend.subscribe()` events.
- Blob refs are real sha256 hex (`crypto.createHash("sha256")`). Run ids are 8 lowercase hex chars. Human request ids are `h1`, `h2`, … per run.
- Clock/speed: `settings.speed` scales every `ctx.step({ms})`: instant ×0, fast ×1, realistic ×5. Seeding uses `engine.withVirtualClock(startAt, fn)` so seeded runs have realistic timestamps without waiting.

## 3. HTTP API

Errors are always `{ "error": string }` with 400 (bad input), 404 (not found), 409 (conflict/state). Every request may carry `x-actor: <name>` (default "Demo user").

### 3.1 `/api/weft/*` — identical to the weft daemon's `/api/*`

| Method + path | Response |
|---|---|
| GET `meta` | `Meta` |
| GET `workflows` | `WorkflowRow[]` (po-brd, architect-aad, dev-plan, dev-task, qa-verify) |
| GET `workflows/:name` | `WorkflowDetail` (input JSON Schema) |
| GET `runs?status=&workflow=&limit=&spend=1` | `RunRow[]`, newest first |
| POST `runs` `StartRunBody` | **202** `{ ok, runId, workflow }` |
| GET `runs/:id?detail=1` | `RunDetail` |
| GET `runs/:id/tree` | `TreePhase[]` |
| GET `runs/:id/report` | `text/markdown` |
| GET `runs/:id/pending` | `PendingRequest[]` (non-gate, pending) |
| GET `pending` | `PendingResponse` (oldest first; policy gates excluded) |
| POST `runs/:id/answer` `AnswerBody` | `{ ok, woke }`; weft's exact error texts (brief §B.2) |
| POST `runs/:id/cancel` / `resume` | `{ ok }` / `{ ok, runId }` |
| GET `runs/:id/artifacts` | `ArtifactEntry[]` |
| GET `runs/:id/patch?key=&stats=1` | `PatchResponse` |
| GET `blobs/:ref?as=text` | `text/plain` |
| GET `runs/:id/events?from=` | SSE: `id:<i>\ndata:<JournalRecord>\n\n`, `: heartbeat` every 15 s |

### 3.2 `/api/delivery/*`

| Method + path | Body | Response |
|---|---|---|
| GET `dashboard` | | `DashboardData` |
| GET `projects` | | `ProjectSummary[]` (updated desc) |
| POST `projects` | `CreateProjectBody` | `ProjectBundle` (201) |
| GET `projects/:id` | | `ProjectBundle` |
| DELETE `projects/:id` | | `{ ok }` |
| PATCH `projects/:id/intake` | `Partial<Intake> & { name?, summary? }` | `ProjectBundle` |
| POST `projects/:id/notes` | `NoteBody` | `StageNote` |
| DELETE `projects/:id/notes/:noteId` | | `{ ok }` |
| POST `projects/:id/stages/requirements/start` | | `{ runId }` (po-brd from intake) |
| POST `projects/:id/stages/architecture/start` | `StartArchitectureBody` | `{ runId }` (architect-aad) |
| POST `projects/:id/stages/implementation/start` | `StartPlanBody` | `{ runId }` (dev-plan) |
| POST `projects/:id/stages/:stage/import` | `ImportBody` | `ProjectBundle` (stage ∈ requirements, architecture) |
| POST `projects/:id/stages/:stage/decision` | `DecisionBody` | `ProjectBundle` (409 if blockers remain) |
| POST `projects/:id/stages/:stage/reopen` | `ReopenBody` | `ProjectBundle` |
| POST `projects/:id/epics` | `EpicUpsertBody` | `Epic` |
| DELETE `projects/:id/epics/:epicId` | | `{ ok }` |
| POST `projects/:id/epics/accept` | `{ stage }` | `ProjectBundle` |
| POST `projects/:id/epics/sync` | | `ProjectBundle` (mock Create in Jira) |
| POST `projects/:id/tasks/start` | `TaskStartBody` | `{ runIds }` |
| PATCH `projects/:id/tasks/:taskId` | `TaskPatchBody` | `DeliveryTask` |
| POST `projects/:id/tasks/:taskId/retry` | | `{ runId }` |
| POST `projects/:id/qa/start` | `QaStartBody` | `{ runIds }` |
| POST `projects/:id/trace/:brRef/waive` | `WaiveBody` | `TraceRow` |
| POST `projects/:id/changes/:changeId/review` | `ChangeReviewBody` | `ChangeReview` |
| GET `projects/:id/docs/:docId?v=` | | `{ doc, text, version }` |
| GET `inbox` | | `InboxItem[]` (tiers: blocking_run, awaiting_approval, fyi) |
| GET `activity?projectId=&limit=` | | `Activity[]` newest first |
| GET `workspace/files?prefix=notes/` | | `Array<{ path, size, updatedAt }>` |
| GET / PATCH `settings` | `Partial<Settings>` | `Settings` |
| POST `admin/reset` | | `{ ok }` (reseed) |
| POST `admin/fast-forward` | `{ runId? }` | `{ ok }` |

### 3.3 `/api/events`

SSE, one per browser tab: `event: change\ndata: <LiveEvent JSON>\n\n`; `: heartbeat` every 15 s. Emit `run` on every journal record (with projectId when known), `project` on every store mutation, `inbox` when pending requests change, `notify` for: a non-gate human request opened (level `attention`, "<workflow> needs your input", body = project name + question start, href = the stage page with `?request=<runId>:<hId>`), a task ready for review, a run failed (`error`), a run completed (`success`).

Client side is done: `src/lib/api/{client,keys,queries,live,actor}.ts`. **Use these hooks; do not call fetch directly in components.**

## 4. Domain rules (server: src/server/delivery)

Types: `src/lib/delivery/types.ts`, `src/lib/weft/types.ts`, `src/lib/weft/workflows.ts` (workflow I/O, request keys, answer schemas). Do not rename fields; add optional fields if you must, and say so in your report.

### 4.1 Run inputs

- **po-brd** (`stages/requirements/start`): `{ workflow: "po-brd", budget: intake.options.budget ?? "$8", input: { request, notes: sources(mapsTo notes).value, seeds: sources(mapsTo seeds).value, out: project.docPaths.brd, maxRounds, discover, discoveryRounds, maxQueries } }`. Validation (400): "Provide the PO's request text in request, or at least one note in notes."
- **architect-aad**: same shape, `input.brd = <accepted BRD path>`, request/sources/options from the body, stage notes appended to `notes` as inline text prefixed with their anchor (`"[BRD §Requirements] …"`), `out: docPaths.aad`, budget "$10". Validation: "Provide a BRD path in brd, the architect's request in request, or at least one note."
- **dev-plan**: `DevPlanInput` from the accepted BRD/AAD paths, developer notes (stage notes + body.notes), epics.
- **dev-task**: one run per task (`DevTaskInput`), `maxReworkCycles: 2`; a QA loop-back starts a new run with `origin: "qa"`, `feedback` = bugs.
- **qa-verify**: one run per task (`QaVerifyInput`), `environment: "internal-apps-test"`.

### 4.2 Orchestrator (reacts to engine events)

| Event | Effect |
|---|---|
| any `human.requested` (non-gate) | inbox + notify; stage status → needs_input |
| po-brd/architect-aad `human.requested` `review:N` | snapshot the file subject as a new `DocVersion` (source agent, roundKey `review:N`); doc status draft; store `lastReport` from the draft step output |
| `human.answered` with `reviewEdit` | new `DocVersion` (source human-edit) |
| po-brd/architect-aad `run.completed` | doc accepted if `output.accepted` (acceptedBy = actor of the accepting answer); store dependencies + memory; parse BR/FR lists; BRD → propose epics; AAD → update epics (changedIn "architecture", history before/after) |
| dev-plan `run.completed` approved | create `DeliveryTask[]` from `output.tasks` (status ready; jiraKey assigned if epics synced), `planApprovedAt`, `startMode`; auto-start dev-task runs per start mode, respecting dependencies and waves, at most 3 concurrent |
| dev-task step events | `task.latestStep` = label of the running step; `check` events → task.checks; `implement:*` output → diffStats; status mapping: Prepare/Implement → in_progress, Verify → verifying, Review pending → in_review, rework → changes_requested → in_progress |
| dev-task `run.completed` | approved → done (devReview decision with actor); cancelled → cancelled; escalated flag; if origin qa and approved → auto-start qa-verify for that task; when a wave completes, start the next wave (all-waves mode) |
| qa-verify `step.completed` key `report` | attach `EvidenceDraft[]` as `Evidence` (ids `EV-n`), update AC evidence links; qa.status testing → in_review when Certify opens |
| qa-verify `run.completed` | verdict → qa.status certified / bugs_found / blocked; bugs_found → start dev-task loop-back run |
| any `run.failed` | FYI inbox notice; health off_track |

### 4.2a Document formats (parse contract between the scripts and the store)

- **BRD** (template from `po-workspace/.claude/skills/po-brd/SKILL.md`): `# BRD: <title>`, then `## Business and Product Lead`, `## Problem to be Solved`, `## Proposed Solution`, `## Requirements`, `## Success Metrics`, `## Out of Scope`, `## Open Questions`, `## Implementation Plan`, `## Sources`. Requirements are a numbered list `N. <text> [citations]`; an item containing `(Candidate)` is a candidate. They become `BR-N`. Open questions are `Q<n>` items.
- **AAD** (template from `architect-aad/SKILL.md`): `# Architecture Approach - <title>` with the real section order (see `po-workspace/aad/aad.md`). Functional requirements are rows of the table under `### Functional Requirements`: `| FR<n> | <text> | [B1 §Requirements <n>] | <design element> |`. Each `§Requirements <n>` becomes a trace to `BR-<n>`. The system change table under `### High-Level Architecture` lists `| <system> | <Proposed / No change / …> | <change> |`.
- Content module contract: `src/server/mock/content/index.ts` (owner D) exports `INITIAL_WORKSPACE: Record<string, string>` (at least `memory/memory.md` = real po-workspace memory, `notes/examples/reorder-reminders.md`, plus a few more `notes/*.md`) and `mockConfluenceDoc(kind: "brd" | "aad", ref: string, title?: string): { title: string; content: string }` for "Import from Confluence".

### 4.3 Stage status, blockers, warnings (brief §A.4)

Status: `locked` (previous stage not approved; Stage 1 never), `not_started`, `in_progress`, `needs_input` (pending non-gate human request **or** an owner action is due: accept epics, start the run, generate the plan, run QA…), `in_review` (only the gate is left), `approved`, `failed`.

| Stage | Blockers (gate disabled) | Warnings (must be ticked) |
|---|---|---|
| 1 | BRD accepted (run output.accepted, or imported); ≥1 epic; all epics accepted or synced; no pending requests | BRD open questions / `lastReport.blockingQuestions`; memory discarded |
| 2 | AAD accepted (or imported); epic updates accepted; no pending requests | `decisionsNeeded`, `untracedRequirements` |
| 3 | plan approved; every non-cancelled task done; no pending requests | escalated tasks; tasks approved with failing checks |
| 4 | every non-cancelled task certified; every TraceRow met/waived; every ChangeReview reviewed; no pending requests | inconclusive evidence |
| 5 | Stage 4 approved | — |

Approving a stage sets `approvedAt`, appends a Decision, moves `currentStage` to the next stage. Approving Stage 5 sets `done`. `changes_requested` at a gate records the decision and keeps the stage open (Stage 5 "Send back" = reopen a chosen earlier stage). Reopen: the stage loses its approval (a `changes_requested` decision with the comment), `currentStage` moves back, later stages get `stale` and become locked until it is re-approved; their data is kept.

Health: `off_track` if any run failed without a newer success or a task is escalated; `at_risk` if the accepted BRD/AAD has blocking questions or a request has waited > 24 h; else `on_track`.

## 5. UI

### 5.1 Routes (App Router; server `page.tsx` awaits `params` and renders one client view)

| Route | Owner | Content |
|---|---|---|
| `/` | U1 | Home: bento dashboard (pipeline, needs-attention, KPIs, spend chart, activity) |
| `/inbox` | U1 | Tiered inbox (Blocking a run / Awaiting approval / FYI), J/K + Enter |
| `/projects` | U1 | Table + card toggle, filters |
| `/projects/new` | U1 | Intake (name, summary, request, sources, advanced, import) |
| `/projects/[projectId]` | U1 | Overview: StageStepper, next step, attention, KPIs, documents, activity |
| `/projects/[projectId]/[stage]` | A (dispatcher) → U2/U3/U4 | Stage workspace; `?step=` sub-step, `?request=<runId>:<hId>` focuses a request |
| `/projects/[projectId]/tasks/[taskId]` | U3 | Task detail |
| `/projects/[projectId]/docs/[docId]` | U5 | Full-page document viewer with versions (`?v=`) |
| `/runs`, `/runs/[runId]` | U5 | Weft-style run inspector |
| `/settings` | U1 | Acting as, speed, data source, reset, fast-forward |

`src/app/projects/[projectId]/layout.tsx` (U1) renders the project header + compact StageStepper above every project page.

### 5.2 Components and ownership

| Folder | Owner | Contents |
|---|---|---|
| `src/app/layout.tsx`, `src/app/providers.tsx`, `src/app/globals.css` | A | Root layout, QueryClient, live updates, Toaster, TooltipProvider, ThemeProvider, tokens |
| `src/components/shell/**` | A | AppSidebar (Home, Inbox + count, Projects, Runs, Settings; recent projects), TopBar (breadcrumb, ⌘K CommandPalette, live dot, speed chip, ActingAs menu, theme toggle) |
| `src/components/common/**` | A | StatusPill, StatusDot, StageIcon, Kicker, FactCell, RelativeTime, Duration, Money, IdChip (mono copyable), HatchedBar/SegmentBar, EmptyState, JsonView, KpiTile, SectionCard, ActorLabel, PageHeader |
| `src/lib/weft/labels.ts`, `src/lib/format.ts` | A | Status labels/tones for RunStatus, StageStatus, DeliveryTaskStatus, QaTaskStatus, HumanKind; money/duration/relative-time formatting |
| `src/components/stages/*/index.tsx` placeholders + `src/app/projects/[projectId]/[stage]/page.tsx` | A | Dispatcher + placeholder views (`RequirementsStageView`, `ArchitectureStageView`, `ImplementationStageView`, `QaStageView`, `SignoffStageView`, each `({ projectId }: { projectId: string })`) that U2–U4 replace |
| `src/components/hitl/**`, `src/lib/weft/schema-form.ts` | H | HumanRequestCard, SchemaForm (port of weft adapt.ts:620-705), bespoke forms: DependencyReviewForm, DocReviewForm, MemoryReviewForm, PlanReviewForm, TaskReviewForm, QaReviewForm; `RequestList` (all pending requests of a set of runs) |
| `src/components/docs/**` | H | Markdown (GFM + slug + citation chips), MermaidBlock (client-only dynamic import), DocViewer (TOC, edit/preview, versions, diff), DraftReportTabs, VersionDiff, TextDiff |
| `src/components/stage/**` | H | StageStepper (large + compact), StageLayout (header, sub-step pills, main, right rail with Requests / Notes / Activity tabs, sticky GateFooter), GateFooter + GateDialog (blockers tooltip, warnings checkboxes, comment), NotesPanel, StaleBanner, LockedStage, ReopenDialog, RunChip |
| `src/components/projects/**` | H | IntakeForm (request textarea with detected-ref chips via extractRefs, SourcesPicker, advanced options, validation), SourcesPicker (Jira key / Confluence id or URL / note file picker / pasted note; single-token paste warning), ImportDocDialog |
| `src/components/dashboard/**`, `src/app/{page,inbox,projects,settings}/**`, project layout + overview | U1 | |
| `src/components/stages/requirements/**`, `src/components/stages/architecture/**`, `src/components/epics/**` | U2 | Stage 1–2 views, EpicTable, EpicSheet, EpicDiff, ExistingEpics |
| `src/components/stages/implementation/**`, `src/components/tasks/**`, task detail page | U3 | PlanEditor, TaskBoard (kanban + table), TaskCard, TaskDetail (ledger, Changes/Checks/AC/Agent log/Notes), ReadyForTestNote |
| `src/components/stages/qa/**`, `src/components/stages/signoff/**`, `src/components/evidence/**`, `src/components/trace/**` | U4 | QA tasks table, EvidenceGallery, TraceMatrix, ChangesReview, final approval, PO summary + sign-off |
| `src/app/runs/**`, `src/components/runs/**`, doc page | U5 | RunsTable, RunHeader, RunLedger (phase-grouped), StepPane (FactCells, Input/Output Structured/JSON), tabs Steps/Notes/Artifacts/Changes, DiffView, gates toggle |

Do not edit files you do not own. If you need a change in someone else's file, work around it locally and list the request in your final report.

### 5.3 Visual system (brief §D.2)

> The current visual spec is [docs/design/STYLE.md](design/STYLE.md), built from the reference images in `docs/design/reference/`. Where it differs from the notes below, STYLE.md wins.

- Tokens in `globals.css` (shadcn variable names, Tailwind v4 `@theme inline`), light + `.dark`, via `next-themes` (`attribute="class"`, default system). Light: background `#F2F2F3`, card `#FFFFFF`, foreground `#232E32`, muted-foreground `#6B7075`, border `#E4E4E7`, primary `#1B47DB` (soft `#E8EEFC`), accent terracotta `#B26552` used rarely. Dark: background `#0F1214`, card `#171B1E`, foreground `#E7EAEC`, muted-fg `#9AA1A7`, border `#262B2F`, primary `#6997E4` (soft `#1A2440`).
- Status tones (CSS vars `--status-<tone>-fg/-bg`): running `#1B47DB/#E8EEFC` (pulsing dot), needs_input `#B45309/#FEF3C7`, in_review `#5B4BB7/#EEEBFA`, approved/done/certified `#15803D/#DCFCE7` (check icon), failed/changes_requested/bugs_found `#B91C1C/#FEE2E2`, locked/not_started `#71717A/#F4F4F5` (lock icon). Dark variants: same hue, fg lighter, bg ~15% alpha. Status is never color-only: pill = icon + label.
- Stages have no color of their own; icons: Requirements `FileText`, Architecture `Network`, Implementation `Code2`, QA `FlaskConical`, PO Review `BadgeCheck`.
- Hatching for partial/in-progress segments: `repeating-linear-gradient(135deg, currentColor 0 2px, transparent 2px 6px)` at ~35% opacity; done = solid.
- Type: Geist Sans / Geist Mono (already loaded). Body 14/20, tables 13, labels 12 medium, card titles 16–18 medium, page titles 28–36 regular −0.02em, KPI numerals 40–48 `tabular-nums`, kicker 10–11 uppercase 0.12em tracking. Mono for ids, run ids, paths, keys, JSON, diffs, logs.
- Shape: `--radius: 0.875rem`; cards `rounded-2xl`, no border in light (shadow `0 1px 2px rgba(0,0,0,.04)`), 1px hairline in dark; buttons and pills `rounded-full`.
- Density: overview pages airy (`p-6 gap-4`); stage/task/run pages comfortable-dense (40px rows, `p-4` cards, 13px text, 12px mono logs).
- Motion: status-dot pulse, skeleton shimmer, 150ms transitions; honor `prefers-reduced-motion`.
- Layout: collapsible shadcn Sidebar (240px / 56px icons), 48px top bar. Must work at 1280px and down to ~390px (stacked, no horizontal page scroll).

### 5.4 Human request UX (every stage)

- `HumanRequestCard` takes a `PendingRequest`/`HumanState` + runId. It joins `key` from `useRun(runId).humans` when missing, picks a bespoke form by key prefix (`deps:review:`, `review:`, `memory:review`, `plan:review:`, `task:review:`, `qa:review:`), else `SchemaForm`.
- Header: mono `human.requested · h3`, workflow · runId · phase, risk badge, waiting time, "Holds the run until answered".
- Question verbatim. Markdown attachments render inline in tabs. File subjects (`mode: "edit"`) get an Edit/Preview toggle; submitting with edits sends `reviewEdit: { content, beforeSha256: reviewSubject.sha256 }`.
- Buttons: `approve`/`confirm` → "Deny & stop" / "Approve & resume"; `ask`/`review` → "Answer & resume". "Show answer JSON" disclosure. Errors inline; on "already answered" / "superseded" toast + refetch.
- Policy gates (`kind: "gate"`, `answeredBy: "policy"`) never appear in queues; runs view shows "N tool gates auto-approved by policy" behind a toggle.

## 6. Seed projects (server: src/server/delivery/seed.ts; content from brief §F)

| id | key | Name | Seeded state |
|---|---|---|---|
| `sms-consent` | SMS | SMS Consent Capture | Stage 1 not_started, intake saved |
| `reorder-reminders` | RR | Reorder Reminders | Stage 1, po-brd waiting on `deps:review:1` |
| `agreement-status-lookup` | ASL | Agreement Acceptance Status Lookup | Stage 2, architect-aad waiting on AAD `review:1` |
| `agreement-reporting` | AGR | Ambassador Agreement Acceptance Reporting | Stage 3 executing: T-1..T-3 done, T-4 in review (`task:review:1` pending), T-5 changes requested (rework running), T-6 in progress, T-7 blocked (Q4), T-8/T-9 ready; health at_risk. Real BRD/AAD/memory text from po-workspace |
| `compliance-export` | LCE | Legal & Compliance Reporting Export | Stage 4: 3 certified, CP-52202 `qa:review:1` pending, CP-52204 bugs_found → loop-back dev-task running |
| `policy-reacceptance` | PPR | Privacy Policy Re-acceptance Prompt | Stage 5 in_review (ready for sign-off) |
| `terms-gate` | TG | Agreement Acceptance at Login | Done (signed off 2026-09-02) |

Seeds are produced by **driving the real mock scripts** with scripted answers inside `engine.withVirtualClock(...)` (so the run inspector shows realistic ledgers and timestamps), then switching to live time. Any run that should be "live" at the end of seeding (e.g. AGR T-6) is started after the virtual clock ends.

## 7. Conventions

- TypeScript strict; no `any` unless unavoidable (comment why). Prefer small components. Client components start with `"use client"`.
- Next 16: `params`/`searchParams` are Promises; `useSearchParams` needs `<Suspense>`; route handlers `export const dynamic = "force-dynamic"`; do not enable `cacheComponents`; no `middleware.ts`.
- shadcn components are in `src/components/ui` (Radix base, `nova` preset). Use them; do not re-add. `cn` from `@/lib/utils`. Icons: `lucide-react`.
- Charts: shadcn `chart` (recharts). Read `/home/tchan/.claude/…/dataviz` guidance only if you build charts (U1).
- Money `$6.92`, tokens `46,099 tok`, durations `05:24` or `2m 14s`, relative times via date-fns `formatDistanceToNowStrict` ("3m ago").
- Accessibility: buttons are `<button>`, icon buttons have `aria-label`, focus rings visible, status never color-only.
- Verify your work: `pnpm exec tsc --noEmit -p .` must show no errors **in your files** (others may be mid-work). Run `pnpm exec eslint <your paths>`.
