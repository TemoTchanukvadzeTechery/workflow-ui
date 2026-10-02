/**
 * The mock brain's phrase matching. A tool's utterance template compiles to one anchored,
 * case-insensitive regular expression:
 *
 *   "start [the] (requirements|brd) [run] [for|on] {projectId}"
 *     → ^\s+start(?:\s+the)?\s+(?:requirements|brd)(?:\s+run)?(?:\s+(?:for|on))?\s+(?<projectId>.+?)$
 *
 * `[x y]` is optional (it may hold alternatives: `[for|on]`), `(a|b)` picks one, `{name}`
 * captures a parameter (lazily, so the words after it still match). Matching runs on the
 * person's text after `normalize` with one space prepended (so a leading optional unit works),
 * with case kept so free-text captures stay verbatim.
 */

/** Polite or filler openings dropped before matching ("can you please start…" → "start…"). */
const LEADING = [
  /^(?:hey|hi|hello|ok(?:ay)?|so|well|um+|alright)[,!.\s]+/i,
  /^(?:please|pls|kindly)\s+/i,
  /^(?:can|could|would|will)\s+you\s+(?:please\s+)?/i,
  /^(?:i\s+(?:want|need|would\s+like|'d\s+like)\s+(?:you\s+)?to|i'd\s+like\s+to|let'?s|lets|go\s+ahead\s+and|help\s+me(?:\s+to)?|try\s+to|now)\s+/i,
];
const TRAILING = [/\s*(?:please|pls|thanks|thank\s+you|for\s+me|now)[.!?]*$/i, /[\s.!?]+$/];

/** Trim, collapse whitespace, unify quotes and drop filler at either end (repeatedly). */
export function normalize(text: string): string {
  let s = text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
  for (let changed = true; changed; ) {
    changed = false;
    for (const re of [...LEADING, ...TRAILING]) {
      const next = s.replace(re, "");
      if (next !== s && next.length > 0) {
        s = next.trim();
        changed = true;
      }
    }
  }
  return s;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Split "a|b" at the top level only (not inside nested brackets). */
function splitAlternatives(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "[" || c === "(" || c === "{") depth++;
    else if (c === "]" || c === ")" || c === "}") depth--;
    else if (c === "|" && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

/** Index of the bracket closing the one at `open`. */
function closing(s: string, open: number): number {
  const pair: Record<string, string> = { "[": "]", "(": ")", "{": "}" };
  const want = pair[s[open]];
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === s[open]) depth++;
    else if (s[i] === want && --depth === 0) return i;
  }
  throw new Error(`unbalanced "${s[open]}" in utterance: ${s}`);
}

/**
 * A sequence of units. A unit that follows whitespace in the template needs whitespace in the
 * text (optional units take theirs with them: "start [the] run" matches "start run" and "start
 * the run"); a unit written flush against the previous one needs none, so "{projectId}'s" and
 * "run(s)" work. Top level starts as if after a space (the text is matched with one prepended);
 * inside a group the group owns the space, so each alternative starts flush.
 */
function compileSeq(s: string, slots: string[], nested = false): { re: string; words: number } {
  let re = "";
  let words = 0;
  let i = 0;
  let spaced = !nested;
  const sep = () => (spaced ? "\\s+" : "");
  while (i < s.length) {
    const c = s[i];
    if (c === " ") {
      spaced = true;
      i++;
      continue;
    }
    if (c === "[" || c === "(") {
      const end = closing(s, i);
      const alts = splitAlternatives(s.slice(i + 1, end)).map((a) => compileSeq(a.trim(), slots, true));
      const body = alts.map((a) => a.re).join("|");
      if (c === "[") re += `(?:${sep()}(?:${body}))?`;
      else {
        re += `${sep()}(?:${body})`;
        words += Math.min(...alts.map((a) => a.words));
      }
      i = end + 1;
    } else if (c === "{") {
      const end = closing(s, i);
      const name = s.slice(i + 1, end).trim();
      slots.push(name);
      re += `${sep()}(?<${name}>.+?)`;
      i = end + 1;
    } else {
      let j = i;
      while (j < s.length && !" [({".includes(s[j])) j++;
      re += `${sep()}${escape(s.slice(i, j))}`;
      words++;
      i = j;
    }
    spaced = false;
  }
  return { re, words };
}

export interface CompiledUtterance {
  source: string;
  re: RegExp;
  slots: string[];
  /** Literal words that must match: a rough specificity for ranking. */
  words: number;
}

const cache = new Map<string, CompiledUtterance>();

export function compileUtterance(source: string): CompiledUtterance {
  const hit = cache.get(source);
  if (hit) return hit;
  const slots: string[] = [];
  const { re, words } = compileSeq(source.trim(), slots);
  const compiled = { source, re: new RegExp(`^${re}$`, "i"), slots, words };
  cache.set(source, compiled);
  return compiled;
}

export interface UtteranceMatch {
  utterance: CompiledUtterance;
  /** Raw captured text per parameter name. */
  captures: Record<string, string>;
  /**
   * Characters matched by the template's own words rather than captured: the specificity used
   * to rank matches. "switch to dark mode" scores higher on "(switch to) {theme} mode" than on
   * "switch to {name}", which captures more of it.
   */
  literal: number;
}

/** Every utterance of a tool that matches the (normalized) text, most specific first. */
export function matchUtterances(text: string, utterances: readonly string[]): UtteranceMatch[] {
  const out: UtteranceMatch[] = [];
  for (const source of utterances) {
    const u = compileUtterance(source);
    const m = u.re.exec(` ${text}`);
    if (!m) continue;
    const captures: Record<string, string> = {};
    let captured = 0;
    for (const name of u.slots) {
      const v = m.groups?.[name]?.trim();
      if (v) {
        captures[name] = v;
        captured += v.length;
      }
    }
    out.push({ utterance: u, captures, literal: text.length - captured });
  }
  return out.sort((a, b) => b.literal - a.literal);
}

/** Lowercase words of a text, for keyword-overlap suggestions. */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);
}
