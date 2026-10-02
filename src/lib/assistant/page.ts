import { isStageId } from "@/lib/delivery/types";
import type { PageContext } from "./types";

/**
 * The project, stage, run or memory note the current URL is about, so "start QA" on a project
 * page needs no project name. Paths: /projects/<id>[/<stage>|/docs/…|/tasks/…], /runs/<runId>,
 * /memory/<type>/<slug>.
 */
export function pageContext(pathname: string): PageContext {
  const parts = pathname.split("/").filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  const page: PageContext = { pathname };
  if (parts[0] === "projects" && parts[1] && parts[1] !== "new") {
    page.projectId = parts[1];
    if (parts[2] && isStageId(parts[2])) page.stage = parts[2];
    if (parts[2] === "tasks") page.stage = "implementation";
  } else if (parts[0] === "runs" && parts[1]) {
    page.runId = parts[1];
  } else if (parts[0] === "memory" && parts.length >= 3) {
    page.noteId = `${parts[1]}/${parts.slice(2).join("/")}`;
  }
  return page;
}
