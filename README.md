# workflow-ui

A Next.js 16 app that walks a project through a five-stage, agent-assisted delivery flow on weft. Today it runs against an in-memory mock of the weft daemon. Nothing it does reaches Jira, Confluence or a repository.

The build contract, domain rules and seed states are in [docs/SPEC.md](docs/SPEC.md).
The visual style follows [docs/design/STYLE.md](docs/design/STYLE.md) and the reference images in `docs/design/reference/`.

| # | Stage | Owner (label only) | Workflow | Status in weft |
|---|---|---|---|---|
| 1 | Requirements | Product Owner | `po-brd` | Exists in `po-workspace/.weft/workflows`; scripted copy here |
| 2 | Architecture | Architect | `architect-aad` | Exists in `po-workspace/.weft/workflows`; scripted copy here |
| 3 | Implementation | Developer | `dev-plan`, `dev-task` | Not in weft; defined by this app |
| 4 | QA Certification | QA | `qa-verify` | Not in weft; defined by this app |
| 5 | PO Review | Product Owner | none | Sign-off in the app |

## What is real and what is mocked

- `/api/weft/*` has the same paths and JSON shapes as the weft daemon API (`../weft`), so it can be pointed at a real daemon.
- The `po-brd` and `architect-aad` scripts copy the po-workspace workflows: inputs, phases, human-request keys, question text and answer schemas. The agent output is canned content from `src/server/mock/content`.
- `dev-plan`, `dev-task` and `qa-verify` are made up here, shaped like `po-brd` so real weft workflows can adopt them.
- Also mocked: "Create in Jira" (assigns keys from `<jiraProject>-52140`), the Confluence fetch behind "Import existing BRD / AAD", code changes and checks, QA evidence, and the timers that make runs progress.

There are no roles. The "Acting as" name in the top bar is sent as `x-actor` and recorded on every answer and approval.

## Quick start

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000. Settings has the demo speed (instant, fast, realistic; fast is the default), "Skip ahead" to move running agents to their next human step, and "Reset demo data".

State lives in memory. It survives hot reload and is lost on a server restart, which reseeds the demo. The engine, store and orchestrator are built once and kept on `globalThis.__workflowUi`, so edits to their code take effect after Reset, which rebuilds them from the current code, or after a restart.

## Memory page

`/memory` is a read-only view of the po-workspace memory vault (`po-workspace/memory/`, the Obsidian vault the pipeline reads and cites). It lists every note with its type, status, trust flags and connections, shows each note's claims, prose and neighbors, draws the connection graph, and makes `[M <note-id>]` / `[M <note-id>#^c-xxxxxx]` citations in documents link to the note with a hover card. ⌘K searches the vault too.

Unlike the rest of the app it reads real data: the server runs `node tools/memory/memory.mjs` (the vault's own CLI, contract in `po-workspace/tools/memory/CONTRACT.md`) one call at a time and caches the result until a note file changes. When the vault's derived search index is missing it is rebuilt automatically; the first build may download a small embeddings model. A file watcher refreshes open Memory pages when notes change. Code: `src/server/memory` (config, CLI runner, service, router, watcher), `src/app/api/memory`, `src/app/memory`, `src/components/memory`.

| Variable | Default | Use |
|---|---|---|
| `MEMORY_WORKSPACE` (or `PO_WORKSPACE`) | `../po-workspace` | The workspace holding `memory/` and `tools/memory/memory.mjs` |
| `NEXT_PUBLIC_OBSIDIAN_VAULT` | unset | Vault name; shows an "Open in Obsidian" button on notes |
| `NEXT_PUBLIC_JIRA_BASE_URL` | unset | Links Jira keys in note sources, e.g. `https://example.atlassian.net` |
| `NEXT_PUBLIC_CONFLUENCE_BASE_URL` | unset | Links `confluence:<id>` sources to `<base>/pages/viewpage.action?pageId=<id>` |

## Seeded demo projects

| Key | Project | What to look at |
|---|---|---|
| SMS | SMS Consent Capture | Requirements, Intake: saved intake, run not started |
| RR | Reorder Reminders | Requirements, Discovery: `po-brd` waits on the dependency review (`deps:review:1`) |
| ASL | Agreement Acceptance Status Lookup | Architecture, Drafts: `architect-aad` waits on AAD review round 1 |
| AGR | Ambassador Agreement Acceptance Reporting | Implementation, Execution: T-1 to T-3 done, T-4 to T-6 reach developer review (T-5 after a rework), T-7 blocked on Q4, T-8 and T-9 ready. Uses the real BRD, AAD and memory text from po-workspace |
| LCE | Legal & Compliance Reporting Export | QA Certification: 3 tasks certified, CP-52202 waits on QA review, CP-52204 had bugs and is back in developer review |
| PPR | Privacy Policy Re-acceptance Prompt | PO Review: ready for sign-off |
| TG | Agreement Acceptance at Login | Done, signed off on 2026-09-02 |

AGR and LCE runs are live at the end of seeding, so their tasks move on for a minute or so after a reset.

## Architecture

```
Browser (client components, TanStack Query)
  ├─ /api/weft/*      weft daemon API: served by the mock engine, or proxied to a daemon
  ├─ /api/delivery/*  projects, stages, documents, epics, tasks, QA, inbox, settings, reset
  ├─ /api/memory/*    the po-workspace memory vault, read through its CLI
  └─ /api/events      one SSE stream per tab: change hints and toasts
```

- `src/app`: routes. Each `page.tsx` renders one client view. Route handlers are in `src/app/api`.
- `src/server/runtime.ts`: the process singleton (engine, delivery store, orchestrator, event bus, settings). It seeds on first use.
- `src/server/mock/engine`: the mock weft engine (journal, reducer to `RunDetail`, timers, human requests, blobs, in-memory workspace files). `src/server/mock/daemon.ts` serves `/api/weft/*` from it.
- `src/server/mock/workflows`: the five workflow scripts. `src/server/mock/content`: canned documents, discovery results, plans, diffs and evidence per seeded project, plus generic templates for new projects.
- `src/server/delivery`: `store.ts` (projects, stages, documents, epics, tasks, evidence, trace), `derive.ts` and `rules.ts` (stage status, blockers, warnings, health), `orchestrator.ts` (reacts to engine events), `inbox.ts`, `dashboard.ts`, `seed.ts`, `router.ts`.
- `src/server/weft`: `proxy.ts` (forwards `/api/weft/*` to a daemon) and `http-backend.ts` (`HttpWeftBackend`).
- `src/lib`: code shared by server and client. `lib/weft/workflows.ts` is the input, output, request-key and answer-schema contract of the five workflows; `lib/delivery/types.ts` holds the delivery types; `lib/api` has the client hooks. Components use those hooks, not `fetch`.
- `src/components`: shell, stage frame and gate (`stage`), human-request cards and forms (`hitl`), document viewer (`docs`), one folder per stage (`stages/*`), tasks, evidence, trace, runs, and shadcn primitives (`ui`).

## Connecting the real weft daemon

1. Start the daemon. Set `WEFT_DAEMON` before `pnpm dev`, or save the URL in Settings. The default is `http://127.0.0.1:4781`.
2. In Settings, Data source, choose "weft daemon". Settings checks the daemon's `/api/meta` first. The switch applies to everyone using this server.

This proxies `/api/weft/*` only, through a server-side fetch because the daemon refuses requests from another origin. The Runs list and run inspector then show the daemon's runs. `/api/delivery` keeps running on the mock engine, so project pages, stage pages and the inbox still point at mock runs the daemon does not know. In weft mode those pages do not work today.

To run the delivery flow on the daemon, give `DeliveryStore` a `new HttpWeftBackend(url)` as `weft` in `createRuntime` (`src/server/runtime.ts`). `HttpWeftBackend` implements the same `WeftBackend` interface as the mock engine. It follows runs by polling `GET /api/runs` every 2 s and reading each live run's events stream. It knows a run's project and the answering actor only for runs this process started or answered, because weft records neither. Before the swap works, these mock-only parts need replacing:

- `fs`: the store reads `brd/`, `aad/`, `plan/`, `memory/` and `notes/` through `WorkspaceFs`. It needs a version over the po-workspace checkout.
- `putBlob` and `now`: today they come from the engine.
- Seeding, the virtual clock, Skip ahead and Reset, which drive the mock engine directly.
- The Stage 3 and 4 workflows (next section). Until they exist in weft, only Stages 1 and 2 can run on the daemon.

## Adding real Stage 3 and 4 workflows

Write `dev-plan`, `dev-task` and `qa-verify` as weft workflows with the names, inputs, outputs, request keys and answer schemas in `src/lib/weft/workflows.ts`:

| Workflow | Input / output | Human request | Answer schema |
|---|---|---|---|
| `dev-plan` | `DevPlanInput` / `DevPlanOutput` | `plan:review:<round>` | `PLAN_REVIEW_SCHEMA` |
| `dev-task` | `DevTaskInput` / `DevTaskOutput` | `task:review:<cycle>` | `TASK_REVIEW_SCHEMA`, then `TASK_REVIEW_ESCALATED_SCHEMA` after `maxReworkCycles` |
| `qa-verify` | `QaVerifyInput` / `QaVerifyOutput` | `qa:review:<attempt>` | `QA_REVIEW_SCHEMA` |

The orchestrator also reads some steps by key: the `implement:<taskId>` and `rework:<n>:<taskId>` outputs of `dev-task` (`ImplementStepOutput`, for diff stats), the `check` journal events of `dev-task` (task checks), and the `report` output of `qa-verify` (`QaReportStepOutput`, the evidence attached before Certify). Keep those keys, or change `src/server/delivery/orchestrator.ts` together with the workflow. The mock scripts in `src/server/mock/workflows/` are the reference.

## Known limitations

- One in-memory state per server, shared by every viewer, with no authentication. A restart loses it.
- The weft data source proxies `/api/weft/*` only; see above.
- New projects get generated content from generic templates. Only the seven seeded projects have hand-written content, and QA runs on new projects still use the `qa-legal-01` test account and the `com.plexus.pww.agreements` E2E test names.
- Deleting a project cancels its open runs but leaves its files (such as `brd/<id>.md`), its runs (Runs hides them behind "Show N unlinked runs") and any memory update it applied to `memory/memory.md`. Reset clears all of it.
