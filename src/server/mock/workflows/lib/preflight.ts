import "server-only";
/**
 * Preflight of both workflows (main.ts): fail before any paid step when the workspace has no
 * commits (drafting runs in a git worktree) or when there is nothing to draft from, then read
 * the skill that is embedded in every agent prompt.
 */
import type { WorkspaceFile } from "../../engine/api";
import type { Kit } from "./kit";

export const NO_COMMITS = "The workspace has no commits. Commit it first (git add -A && git commit), because the drafting step runs in a git worktree.";

export async function preflight(kit: Kit, opts: { skill: string; hasInput: boolean; noInputError: string }): Promise<WorkspaceFile> {
  kit.ctx.phase("Preflight");
  const commits = await kit.gitLog({ max: 1 }).then(
    (log) => log.commits.length,
    () => 0,
  );
  if (commits === 0) throw new Error(NO_COMMITS);
  if (!opts.hasInput) throw new Error(opts.noInputError);
  return kit.read(opts.skill);
}
