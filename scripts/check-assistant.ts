/**
 * Self-check of the assistant's tool registry, without a browser or the app running:
 *   pnpm exec tsx scripts/check-assistant.ts
 *
 * - tool names are unique snake_case;
 * - every utterance compiles, and each `{param}` it captures is one of the tool's params;
 * - every example (with `{project}` filled in) is matched by one of the tool's own utterances,
 *   and by no other tool's utterance more specifically, so "help" never suggests something
 *   the brain would route elsewhere.
 * Coverage of the API client is checked by the type checker (tools/index.ts).
 */
import { compileUtterance, matchUtterances, normalize } from "../src/lib/assistant/match";
import { INTERNAL, TOOLS } from "../src/lib/assistant/tools";

const SAMPLE_PROJECT = "Agreement Reporting";
const problems: string[] = [];
const names = new Set<string>();

for (const tool of TOOLS) {
  if (!/^[a-z][a-z0-9_]*$/.test(tool.name)) problems.push(`${tool.name}: name is not snake_case`);
  if (names.has(tool.name)) problems.push(`${tool.name}: duplicate name`);
  names.add(tool.name);
  if (!tool.utterances.length) problems.push(`${tool.name}: no utterances`);
  if (!tool.examples.length) problems.push(`${tool.name}: no examples`);
  for (const u of tool.utterances) {
    try {
      const c = compileUtterance(u);
      for (const slot of c.slots) if (!(slot in tool.params)) problems.push(`${tool.name}: utterance "${u}" captures {${slot}}, which is not a param`);
    } catch (e) {
      problems.push(`${tool.name}: utterance "${u}" does not compile: ${(e as Error).message}`);
    }
  }
}

let examples = 0;
for (const tool of TOOLS) {
  for (const ex of tool.examples) {
    examples++;
    const text = normalize(ex.replaceAll("{project}", SAMPLE_PROJECT));
    const own = matchUtterances(text, tool.utterances)[0];
    if (!own) {
      problems.push(`${tool.name}: example "${ex}" matches none of its utterances`);
      continue;
    }
    for (const other of TOOLS) {
      if (other === tool) continue;
      const m = matchUtterances(text, other.utterances)[0];
      if (m && m.literal > own.literal) problems.push(`${tool.name}: example "${ex}" is matched more specifically by ${other.name} ("${m.utterance.source}")`);
    }
  }
}

const covered = new Set(TOOLS.flatMap((t) => t.covers));
console.log(`${TOOLS.length} tools, ${TOOLS.reduce((n, t) => n + t.utterances.length, 0)} utterances, ${examples} examples; ${covered.size} client functions covered, ${Object.keys(INTERNAL).length} internal`);
if (problems.length) {
  console.log(`\n${problems.length} problem(s):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("ok");
