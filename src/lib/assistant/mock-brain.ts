/**
 * The rule-based brain: no model, just the tools' utterance templates. It matches the message
 * against every tool, resolves the captured phrases into ids (slots.ts), fills the rest from the
 * page, asks for what is still missing, and proposes one tool call. Small talk, "help" and
 * "did you mean" suggestions are canned.
 */
import { isRequired } from "./define";
import { matchUtterances, normalize, words } from "./match";
import { askFor, optionsFor, pageDefault, resolveSlot, type Resolution } from "./slots";
import type { AssistantBrain, AssistantTool, BrainEvent, Choice, PendingAsk, ToolContext, ToolGroup, ToolInput } from "./types";

const GREETING = /^(?:hi|hello|hey|hiya|yo|good\s+(?:morning|afternoon|evening)|howdy)(?:\s+there)?$/i;
const THANKS = /^(?:thanks?|thank\s+you|thx|ty|cheers|great|perfect|awesome|nice|cool|ok|okay|got\s+it)(?:\s+(?:a\s+lot|so\s+much))?$/i;
const HELP = /^(?:help|\?|commands|menu|what\s+(?:can|do)\s+you\s+do|what\s+are\s+you|who\s+are\s+you|how\s+do\s+(?:you|i)\s+use\s+(?:you|this)|what\s+can\s+i\s+(?:ask|say|do)(?:\s+here)?|show\s+(?:me\s+)?(?:commands|examples))$/i;
const CANCEL = /^(?:cancel|never\s*mind|forget\s+it|stop|no|nope|skip|abort)$/i;

export const GROUP_LABEL: Record<ToolGroup, string> = {
  navigation: "Get around",
  session: "You and the app",
  projects: "Projects",
  stages: "Stages and gates",
  epics: "Epics",
  tasks: "Tasks",
  qa: "QA",
  inbox: "Inbox and requests",
  runs: "Runs and workflows",
  memory: "Memory",
  settings: "Settings",
};

/** `{project}` in an example becomes the page's project, or the first project. */
export async function fillExample(example: string, ctx: ToolContext): Promise<string> {
  if (!example.includes("{project}")) return example;
  let name = "my project";
  try {
    const projects = await ctx.world.projects();
    name = projects.find((p) => p.id === ctx.page.projectId)?.name ?? projects[0]?.name ?? name;
  } catch {
    // keep the placeholder name
  }
  return example.replaceAll("{project}", name);
}

const firstName = (name: string) => name.split(/\s+/)[0] || name;

/** Starter chips: what most people want first. */
export async function starterChoices(ctx: ToolContext): Promise<Choice[]> {
  const out = ["What's waiting for me?", "Show my projects"];
  if (ctx.page.projectId) out.push("Summarize this project", "What's blocking this stage?");
  else out.push("Summarize {project}");
  out.push("Search memory for checkout", "What can you do?");
  return Promise.all(out.map(async (t) => ({ label: await fillExample(t, ctx), reply: await fillExample(t, ctx) })));
}

interface Candidate {
  tool: AssistantTool;
  input: ToolInput;
  /** The first parameter that did not resolve, with why and what to pick instead. */
  failed?: { param: string; message: string; options?: Choice[]; raw?: Record<string, string> };
  /** The match's specificity (UtteranceMatch.literal). */
  literal: number;
}

/** Kinds that only exist inside a project, so the project must be known first. */
const IN_PROJECT = new Set(["task", "epic", "requirement", "change", "stage-note"]);

/** Resolve a match's captures in parameter order (a task resolves inside its project). */
async function resolveCaptures(tool: AssistantTool, captures: Record<string, string>, ctx: ToolContext, literal: number, base: ToolInput = {}): Promise<Candidate> {
  const input: ToolInput = { ...base };
  const params = Object.entries(tool.params);
  for (const [i, [param, spec]] of params.entries()) {
    const raw = captures[param];
    if (raw === undefined) {
      if (input[param] === undefined) {
        const fallback = pageDefault(spec, ctx);
        if (fallback !== undefined) input[param] = fallback;
      }
      continue;
    }
    if (IN_PROJECT.has(spec.kind) && input.projectId === undefined && "projectId" in tool.params) {
      // "Retry T-3" off a project page: ask for the project, keep "T-3" for afterwards.
      const later = Object.fromEntries(params.slice(i).flatMap(([p]) => (captures[p] === undefined ? [] : [[p, captures[p]]])));
      const options = await optionsFor({ ctx, input, spec: tool.params.projectId });
      return { tool, input, failed: { param: "projectId", message: "Which project is that in?", options, raw: later }, literal };
    }
    const r = await resolveSlot(raw, { ctx, input, spec });
    if (!r.ok) return { tool, input, failed: { param, message: r.message, options: r.options }, literal };
    input[param] = r.value;
  }
  return { tool, input, literal };
}

async function candidatesFor(text: string, tools: readonly AssistantTool[], ctx: ToolContext): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const tool of tools) {
    // Most specific template first; fall back to the next one when its phrases don't resolve
    // ("what's blocking QA": QA is a stage, not a project).
    let firstFailure: Candidate | undefined;
    let resolved: Candidate | undefined;
    for (const m of matchUtterances(text, tool.utterances)) {
      let c: Candidate;
      try {
        c = await resolveCaptures(tool, m.captures, ctx, m.literal);
      } catch (e) {
        c = { tool, input: {}, failed: { param: "", message: e instanceof Error ? e.message : String(e) }, literal: m.literal };
      }
      if (!c.failed) {
        resolved = c;
        break;
      }
      firstFailure ??= c;
    }
    const pick = resolved ?? firstFailure;
    if (pick) out.push(pick);
  }
  // Fully resolved first, then the more specific template.
  return out.sort((a, b) => Number(!!a.failed) - Number(!!b.failed) || b.literal - a.literal);
}

/** Say what didn't resolve and ask for it (keeping later phrases for when it's answered). */
async function* askAgain(c: Candidate): AsyncGenerator<BrainEvent> {
  const failed = c.failed!;
  const spec = c.tool.params[failed.param];
  yield { type: "text", text: spec && !failed.message.endsWith("?") ? `${failed.message} ${askFor(failed.param, spec)}` : failed.message };
  if (failed.options?.length) yield { type: "choices", options: failed.options };
  if (spec) yield { type: "ask", pending: { tool: c.tool.name, input: c.input, param: failed.param, raw: failed.raw } };
}

/** Ask for the first missing required parameter, or propose the call. */
async function* complete(tool: AssistantTool, input: ToolInput, ctx: ToolContext): AsyncGenerator<BrainEvent> {
  for (const [param, spec] of Object.entries(tool.params)) {
    if (input[param] !== undefined || !isRequired(spec)) continue;
    const fallback = pageDefault(spec, ctx);
    if (fallback !== undefined) {
      input[param] = fallback;
      continue;
    }
    yield { type: "text", text: askFor(param, spec) };
    const options = await optionsFor({ ctx, input, spec });
    if (options.length) yield { type: "choices", options };
    yield { type: "ask", pending: { tool: tool.name, input, param } };
    return;
  }
  // The card says the rest: what it will do, whether it changes anything, Confirm.
  yield { type: "call", tool: tool.name, input };
}

/** "Did you mean": tools sharing the most words with the message. */
async function suggestions(text: string, tools: readonly AssistantTool[], ctx: ToolContext): Promise<Choice[]> {
  const asked = new Set(words(text));
  const scored = tools
    .map((t) => {
      const vocab = new Set(words([t.title, ...t.utterances.map((u) => u.replace(/\{[^}]*\}/g, " ")), ...t.examples].join(" ")));
      let score = 0;
      for (const w of asked) if (vocab.has(w)) score += w.length > 3 ? 2 : 1;
      return { t, score };
    })
    .filter((s) => s.score >= 2 && s.t.examples.length)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  return Promise.all(scored.map(async ({ t }) => ({ label: await fillExample(t.examples[0], ctx), reply: await fillExample(t.examples[0], ctx) })));
}

async function* help(tools: readonly AssistantTool[], ctx: ToolContext): AsyncGenerator<BrainEvent> {
  const groups = [...new Set(tools.map((t) => t.group))];
  const lines = groups.map((g) => {
    const titles = tools.filter((t) => t.group === g).map((t) => t.title.toLowerCase());
    return `- **${GROUP_LABEL[g]}**: ${titles.slice(0, 5).join(", ")}${titles.length > 5 ? `, and ${titles.length - 5} more` : ""}`;
  });
  yield {
    type: "text",
    text: `I can do anything you can do in Wefty, ${tools.length} actions in all. Changes always wait for your Confirm.\n\n${lines.join("\n")}\n\nI'm a rule-based mock for now, so plain, direct phrasing works best. Try one of these:`,
  };
  const picks = groups.map((g) => tools.find((t) => t.group === g && t.examples.length)).filter((t): t is AssistantTool => !!t);
  yield { type: "choices", options: await Promise.all(picks.slice(0, 8).map(async (t) => ({ label: await fillExample(t.examples[0], ctx), reply: await fillExample(t.examples[0], ctx) }))) };
}

async function* respondTo(text: string, pending: PendingAsk | undefined, ctx: ToolContext, tools: readonly AssistantTool[]): AsyncGenerator<BrainEvent> {
  const t = normalize(text);

  if (pending) {
    const tool = tools.find((x) => x.name === pending.tool);
    const spec = tool?.params[pending.param];
    if (tool && spec) {
      if (CANCEL.test(t)) {
        yield { type: "text", text: "OK, I've dropped that." };
        return;
      }
      const smallTalk = GREETING.test(t) || THANKS.test(t) || HELP.test(t);
      const r: Resolution = smallTalk ? { ok: false, message: "" } : spec.kind === "text" ? { ok: true, value: text.trim() } : await resolveSlot(t, { ctx, input: pending.input, spec });
      if (r.ok) {
        const c = await resolveCaptures(tool, pending.raw ?? {}, ctx, 0, { ...pending.input, [pending.param]: r.value });
        if (c.failed) yield* askAgain(c);
        else yield* complete(tool, c.input, ctx);
        return;
      }
      // Not an answer. A new request, small talk or a second miss moves on; a first miss asks once more.
      if (!smallTalk && !(pending.misses ?? 0) && !(await candidatesFor(t, tools, ctx)).length) {
        yield { type: "text", text: `${r.message} ${askFor(pending.param, spec)}` };
        const options = r.options?.length ? r.options : await optionsFor({ ctx, input: pending.input, spec });
        if (options.length) yield { type: "choices", options };
        yield { type: "ask", pending: { ...pending, misses: 1 } };
        return;
      }
    }
  }

  if (!t) return;
  if (GREETING.test(t)) {
    yield { type: "text", text: `Hi ${firstName(ctx.actor.name)}! How can I help today?` };
    yield { type: "choices", options: await starterChoices(ctx) };
    return;
  }
  if (THANKS.test(t)) {
    yield { type: "text", text: "Anytime. Anything else?" };
    return;
  }
  if (HELP.test(t)) {
    yield* help(tools, ctx);
    return;
  }

  const candidates = await candidatesFor(t, tools, ctx);
  const best = candidates[0];
  if (best && !best.failed) {
    yield* complete(best.tool, best.input, ctx);
    return;
  }
  if (best?.failed) {
    yield* askAgain(best);
    return;
  }

  const options = await suggestions(t, tools, ctx);
  yield {
    type: "text",
    text: options.length
      ? "I'm not sure what you mean. I'm a rule-based mock for now, so I only understand set phrasings. Did you mean one of these?"
      : "I didn't catch that. I'm a rule-based mock for now, so I only understand set phrasings. Ask me “what can you do?” to see them.",
  };
  yield { type: "choices", options: options.length ? options : [{ label: "What can you do?", reply: "What can you do?" }, ...(await starterChoices(ctx)).slice(0, 2)] };
}

export const mockBrain: AssistantBrain = {
  id: "mock",
  label: "Rule-based mock",
  respond: ({ text, pending, ctx, tools }) => respondTo(text, pending, ctx, tools),
};
