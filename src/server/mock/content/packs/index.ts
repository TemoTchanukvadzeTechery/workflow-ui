import "server-only";
/**
 * Content packs by project id. A run picks its pack from StartMeta.projectId, falling back to
 * the output path (brd/<id>.md, aad/<id>.md; the real po-workspace paths brd/brd.md and
 * aad/aad.md mean AGR). Projects without a pack use the generic generator.
 */
import { agrPack } from "./agr";
import { aslPack } from "./asl";
import { lcePack } from "./lce";
import { pprPack } from "./ppr";
import { rrPack } from "./rr";
import { smsPack } from "./sms";
import { tgPack } from "./tg";
import type { ContentPack } from "./types";

export type { ContentPack, ScriptedDep, ScriptedDiscovery } from "./types";

export const PACKS: readonly ContentPack[] = [agrPack, rrPack, aslPack, lcePack, pprPack, tgPack, smsPack];

export function packById(id: string | undefined): ContentPack | undefined {
  return id ? PACKS.find((p) => p.id === id) : undefined;
}

/** The pack for a run: by project id, else by the document path. */
export function pickPack(projectId?: string, path?: string): ContentPack | undefined {
  const byId = packById(projectId);
  if (byId) return byId;
  if (projectId) return undefined;
  const base = path?.split("/").pop()?.replace(/\.md$/, "");
  if (!base) return undefined;
  if (base === "brd" || base === "aad") return agrPack;
  return packById(base);
}
