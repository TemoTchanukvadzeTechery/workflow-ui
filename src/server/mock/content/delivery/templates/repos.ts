import "server-only";
/**
 * The repositories the plans target, how each one is verified, and a few naming helpers the code
 * templates share. Commands follow the repos' real toolchains (Gradle for the Java service and
 * pww-automation, Nx + pnpm for the Angular portal, terraform + jest for the Auth0 actions).
 */
import type { CheckName } from "../types";

export type RepoKind = "java" | "angular" | "gateway" | "contracts" | "e2e" | "auth0";

export function repoKind(repo: string): RepoKind {
  const r = repo.toLowerCase();
  if (r.includes("contract")) return "contracts";
  if (r.includes("auth0")) return "auth0";
  if (r.includes("gateway")) return "gateway";
  if (r.includes("automation") || r.includes("e2e") || r === "qa") return "e2e";
  if (r.startsWith("website-") || r.includes("portal") || r.includes("myaccount") || r.includes("web")) return "angular";
  return "java";
}

export interface CheckDef {
  name: CheckName;
  command: string;
}

/** The four checks every dev-task run executes, per repo kind. */
export function checkDefs(repo: string, focus: string): CheckDef[] {
  switch (repoKind(repo)) {
    case "java":
      return [
        { name: "typecheck", command: "./gradlew compileJava compileTestJava --console=plain" },
        { name: "lint", command: "./gradlew spotlessCheck checkstyleMain --console=plain" },
        { name: "unit", command: "./gradlew test --console=plain" },
        { name: "contract", command: "./gradlew contractTest --console=plain" },
      ];
    case "angular":
      return [
        { name: "typecheck", command: `pnpm nx run ${repo}:typecheck` },
        { name: "lint", command: `pnpm nx lint ${repo}` },
        { name: "unit", command: `pnpm nx test ${repo}` },
        { name: "e2e", command: `pnpm nx e2e ${repo}-e2e --grep "${focus}"` },
      ];
    case "gateway":
      return [
        { name: "typecheck", command: "pnpm run validate:routes" },
        { name: "lint", command: "pnpm exec yamllint -s routes/" },
        { name: "unit", command: "pnpm test -- routes" },
        { name: "contract", command: "pnpm run contract:verify" },
      ];
    case "contracts":
      return [
        { name: "typecheck", command: "pnpm run bundle" },
        { name: "lint", command: "pnpm exec redocly lint" },
        { name: "unit", command: "pnpm test" },
        { name: "contract", command: "pnpm run breaking -- --base origin/master" },
      ];
    case "auth0":
      return [
        { name: "typecheck", command: "terraform validate" },
        { name: "lint", command: "pnpm exec eslint actions/ && terraform fmt -check -recursive" },
        { name: "unit", command: "pnpm test -- actions/post-login" },
        { name: "contract", command: "terraform plan -var-file=tenants/dev.tfvars -lock=false" },
      ];
    case "e2e":
      return [
        { name: "typecheck", command: "./gradlew compileTestKotlin --console=plain" },
        { name: "lint", command: "./gradlew ktlintCheck --console=plain" },
        { name: "unit", command: "./gradlew test --tests 'com.plexus.pww.framework.*' --console=plain" },
        { name: "e2e", command: `./gradlew test --tests '${focus}' -Denv=internal-apps-test --console=plain` },
      ];
  }
}

/** Test sources across the repos: JUnit and Kotlin classes, Angular specs, vitest and jest files. */
export const TEST_FILE = /(Test\.(java|kt)|\.spec\.ts|\.test\.(ts|js))$/;

/** Counts test cases in the files of a diff-able tree (JUnit, Jest/Jasmine, Kotlin). */
export function countTests(files: ReadonlyArray<{ path: string; content: string | undefined }>): number {
  let n = 0;
  for (const f of files) {
    if (!f.content || !TEST_FILE.test(f.path)) continue;
    n += (f.content.match(/^\s*@(Test|ParameterizedTest)\b/gm) ?? []).length;
    n += (f.content.match(/^\s*(it|test)\(/gm) ?? []).length;
  }
  return n;
}

const ACRONYMS: Record<string, string> = { csv: "CSV", api: "API", ld: "LD", url: "URL", id: "ID" };

/** "returns required and accepted counts" -> "returnsRequiredAndAcceptedCounts" (test method names). */
export function testName(text: string, max = 7): string {
  const parts = text
    .replace(/`[^`]*`/g, " ")
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !/^(the|a|an|is|are|be|to|of|and|when|with|for|per|on|in|it|its)$/i.test(w))
    .slice(0, max);
  if (parts.length === 0) return "behavesAsSpecified";
  return parts
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (i === 0) return lower;
      return ACRONYMS[lower] ? ACRONYMS[lower][0] + ACRONYMS[lower].slice(1).toLowerCase() : lower[0].toUpperCase() + lower.slice(1);
    })
    .join("");
}

/** Java string literal. */
export function jstr(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** TypeScript single-quoted literal. */
export function tstr(text: string): string {
  return `'${text.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}
