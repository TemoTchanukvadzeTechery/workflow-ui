import "server-only";
/**
 * GET /api/meta and the workflow registry (GET /api/workflows[/:name]) for the mock daemon.
 * Meta describes a daemon serving the po-workspace repo with weft's defaults: claude-opus-5 at
 * medium effort, low-risk tool gates auto-approved by policy, everything else asked.
 */
import type { Meta, WorkflowDetail, WorkflowRow } from "@/lib/weft/types";
import type { MockWorkflow } from "./api";
import { sha256Hex } from "./blobs";
import { DEFAULT_AGENT_ROUTE } from "./ctx";
import { apiError } from "./errors";

export const WORKSPACE_CWD = "/workspace/po-workspace";

export function mockMeta(): Meta {
  return {
    version: "0.1.0-mock",
    repo: { name: "po-workspace", cwd: WORKSPACE_CWD, weftDir: `${WORKSPACE_CWD}/.weft`, runsDir: `${WORKSPACE_CWD}/.weft/runs` },
    defaults: { ...DEFAULT_AGENT_ROUTE },
    limits: { concurrency: 8, maxTurns: 200, maxDepth: 4, stepTimeoutMs: 1_800_000 },
    approvalPolicy: { tiers: { low: "auto", medium: "ask", high: "ask", irreversible: "ask" } },
    fetchAllow: null,
    providers: [{ id: "claude", registered: true, concurrency: 4 }],
  };
}

const NAME = /^[A-Za-z0-9._-]+$/;

export class Registry {
  private readonly byId = new Map<string, MockWorkflow>();

  constructor(workflows: readonly MockWorkflow[]) {
    for (const wf of workflows) this.byId.set(wf.id, wf);
  }

  get(name: string): MockWorkflow | undefined {
    return this.byId.get(name);
  }

  rows(): WorkflowRow[] {
    return [...this.byId.values()].map((wf) => ({ id: wf.id, name: wf.id, file: wf.file, description: wf.description }));
  }

  detail(name: string): WorkflowDetail {
    if (!NAME.test(name) || name === "." || name === ".." || name.endsWith(".ts")) {
      throw apiError(`${JSON.stringify(name)} is not a registry workflow name — it must be a bare name from .weft/workflows, with no path separators`);
    }
    const wf = this.byId.get(name);
    if (!wf) throw apiError(`workflow ${name} not found`);
    return {
      id: wf.id,
      name: wf.id,
      file: wf.file,
      hash: sha256Hex(wf.id),
      description: wf.description,
      input: wf.input,
      output: wf.output,
      taskExtensions: null,
      schemaWarnings: [],
      taskExtensionSchemaVersion: 1,
      tasksConfigured: false,
      defaults: Object.keys(wf.defaults).length > 0 ? { ...wf.defaults } : null,
    };
  }
}
