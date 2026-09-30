import "server-only";
import type { AadReport, DraftReport } from "@/lib/delivery/types";
import type { PackMemory, MemoryInput } from "../memory";
import type { AtlQuery, DocResult, DocType, DraftContext } from "../types";

/** A dependency a scripted planner round lists: a catalog ref, optionally re-described. */
export type ScriptedDep = string | { ref: string; relation?: string; why?: string; title?: string };

export interface ScriptedDiscovery {
  /**
   * Planner rounds of the first pass, in order: the queries it proposes and the refs it lists as
   * relevant after seeing the previous results. The final round consolidates every listed ref.
   */
  rounds: Array<{ queries: AtlQuery[]; relevant: ScriptedDep[] }>;
  /** Extra refs a search-more pass finds; index 0 is pass 2. */
  more?: ScriptedDep[][];
}

/**
 * Authored content for one demo project, picked by projectId. Anything a pack leaves out falls
 * back to the generic generator.
 */
export interface ContentPack {
  id: string;
  key: string;
  title: string;
  brd?: (ctx: DraftContext) => DocResult<DraftReport>;
  aad?: (ctx: DraftContext) => DocResult<AadReport>;
  discovery?: Partial<Record<DocType, ScriptedDiscovery>>;
  memory?: Partial<Record<DocType, (opts: MemoryInput) => PackMemory>>;
}
