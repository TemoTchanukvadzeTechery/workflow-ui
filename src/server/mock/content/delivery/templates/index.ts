import "server-only";
/**
 * Picks the code template for a task's repo and applies generic rework. Bespoke packs (AGR, LCE)
 * override individual tasks; everything else, including tasks a developer adds to a plan, lands
 * here, so any task in any project gets a plausible diff for its repo.
 */
import type { WorkingTree } from "@/server/mock/workflows/delivery-lib/diff";
import { clip, hashString } from "@/server/mock/workflows/delivery-lib/util";
import type { CheckName, ReworkResult, RunTask, TaskImpl } from "../types";
import { angularImpl, angularReworkSpec, type AngularKind } from "./angular";
import { auth0Impl, auth0ReworkTest } from "./auth0";
import { contractImpl } from "./contracts";
import { domainFor, type Domain } from "./domain";
import { e2eImpl, e2eReworkTest } from "./e2e";
import { gatewayImpl, gatewayReworkTest } from "./gateway";
import { javaImpl, javaReworkTest } from "./java";
import { TEST_FILE, repoKind } from "./repos";

export interface ImplHints {
  name?: string;
  kind?: AngularKind;
  pkg?: string;
  path?: string;
  area?: string;
  api?: string;
  flag?: string;
  url?: string;
  upstream?: string;
  resign?: boolean;
  /** null = never fault; undefined = decide deterministically. */
  fault?: CheckName | null;
  baseTests?: number;
  /** Service, route and contract vocabulary; the agreements one when unset. */
  domain?: Domain;
}

/** Roughly one task in four trips a check on its first implementation. */
function autoFault(task: RunTask, kind: ReturnType<typeof repoKind>): CheckName | undefined {
  if (kind !== "java" && kind !== "angular") return undefined;
  const h = hashString(`${task.id}:${task.title}`);
  if (h % 4 !== 1) return undefined;
  const options: CheckName[] = kind === "java" ? ["unit", "lint", "typecheck"] : ["lint", "typecheck", "unit"];
  return options[(h >>> 3) % options.length];
}

function guessAngularKind(task: RunTask): AngularKind {
  const t = task.title.toLowerCase();
  if (/\b(flag|launchdarkly|feature toggle)\b/.test(t)) return "flag";
  if (/\b(authori[sz]ation|guard|role|access|permission)\b/.test(t)) return "guard";
  return "page";
}

export function templateImpl(task: RunTask, hints: ImplHints = {}): TaskImpl {
  const kind = repoKind(task.repo);
  const fault = hints.fault === null ? undefined : (hints.fault ?? autoFault(task, kind));
  switch (kind) {
    case "java":
      return javaImpl(task, { name: hints.name, pkg: hints.pkg, domain: hints.domain, path: hints.path, fault, baseTests: hints.baseTests });
    case "angular":
      return angularImpl(task, {
        kind: hints.kind ?? guessAngularKind(task),
        name: hints.name,
        area: hints.area,
        api: hints.api,
        flag: hints.flag,
        fault,
        baseTests: hints.baseTests,
      });
    case "gateway":
      return gatewayImpl(task, { name: hints.name, path: hints.path, upstream: hints.upstream, resign: hints.resign, baseTests: hints.baseTests, domain: hints.domain });
    case "contracts":
      return contractImpl(task, { name: hints.name, path: hints.path, baseTests: hints.baseTests, domain: hints.domain });
    case "e2e":
      return e2eImpl(task, { name: hints.name, url: hints.url, baseTests: hints.baseTests });
    case "auth0":
      return auth0Impl(task);
  }
}

/**
 * Generic developer rework: records the feedback where the code is and adds a regression test
 * named after it, so every rework cycle visibly changes the task diff.
 */
export function genericRework(tree: WorkingTree, impl: TaskImpl, task: RunTask, cycle: number, feedback: string): ReworkResult {
  const text = clip(feedback || "address review comments", 100);
  const kind = repoKind(task.repo);
  const testPath = impl.files.map((f) => f.path).find((p) => TEST_FILE.test(p) && tree.has(p));
  const main = impl.primaryFile;
  const name = /\/(\w+?)(Service|Controller|Component|Page|Test)?\.(java|kt|ts)$/.exec(main)?.[1] ?? "Feature";

  if (tree.has(main)) {
    const comment = main.endsWith(".yaml") || main.endsWith(".yml") ? `# Review follow-up ${cycle}: ${text}` : `// Review follow-up ${cycle}: ${text}`;
    const lines = (tree.get(main) ?? "").split("\n");
    const anchor = lines.find((l) => /^\s*(public |export |exports\.|class |fun |routes:|get:)/.test(l)) ?? lines[0];
    tree.insertAfter(main, anchor, main.endsWith(".java") || main.endsWith(".kt") ? `    ${comment}` : comment);
  }
  if (testPath) {
    // The package in the test path says which vocabulary the service was written in.
    if (kind === "java") tree.insertBeforeLast(testPath, "}", javaReworkTest(/(\w+)ServiceTest\.java$/.exec(testPath)?.[1] ?? name, cycle, text, domainFor(/\/customer\/(\w+)\//.exec(testPath)?.[1])));
    else if (kind === "e2e") tree.insertBeforeLast(testPath, "}", e2eReworkTest(/(\w+)Test\.kt$/.exec(testPath)?.[1] ?? name, cycle, text));
    else if (kind === "gateway") tree.insertBeforeLast(testPath, "});", gatewayReworkTest([...(tree.get(main) ?? "").matchAll(/path: (\S+)/g)].pop()?.[1] ?? "/v1/agreements", cycle, text));
    else if (kind === "auth0") tree.insertBeforeLast(testPath, "});", auth0ReworkTest(cycle, text));
    else tree.insertBeforeLast(testPath, "});", angularReworkSpec(cycle, text, testPath));
  }
  return { summary: `Applied review feedback: ${text}`, primaryFile: testPath ?? main };
}
