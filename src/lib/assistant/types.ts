/**
 * The assistant: a chat panel that can do everything the UI can, through one registry of tools.
 *
 * - A **tool** is one thing a person can do in the app (start a run, approve a gate, search
 *   memory, open a page). It calls the same `src/lib/api/client.ts` functions the buttons call,
 *   so it is attributed to the "Acting as" name like any click. Its `params` double as the JSON
 *   schema a language model gets (`toolDefinitions()`), and its `utterances` teach the rule-based
 *   mock brain how people ask for it.
 * - A **brain** turns what the person typed into text, questions and tool calls. Today it is the
 *   rule-based `mockBrain`; a Claude-backed brain can implement the same `AssistantBrain` later.
 * - The panel shows each call as a card. Reads run straight away; anything that changes state
 *   waits for Confirm.
 */
import type { QueryClient } from "@tanstack/react-query";
import type { delivery, memory, weft } from "@/lib/api/client";
import type { StageId } from "@/lib/delivery/types";
import type { PendingEntry } from "@/lib/weft/types";
import type { Tone } from "@/lib/weft/labels";
import type { World } from "./world";

// ---------------------------------------------------------------------------------------------
// Coverage: every API client function is reached by some tool (checked by tsc in tools/index.ts)
// ---------------------------------------------------------------------------------------------

type Fns<T, P extends string> = { [K in keyof T & string]: `${P}.${K}` }[keyof T & string];
/** "delivery.startRequirements", "weft.answer", "memory.search", … */
export type ClientFn = Fns<typeof weft, "weft"> | Fns<typeof delivery, "delivery"> | Fns<typeof memory, "memory">;

// ---------------------------------------------------------------------------------------------
// Parameters and their kinds
// ---------------------------------------------------------------------------------------------

/**
 * How a parameter's value is found in what the person typed (see slots.ts). Entity kinds resolve
 * against live data: "checkout" becomes the project id `checkout-v2`, "T-3" a task id.
 */
export type ParamKind =
  | "project" // project id, from its name, key or id; defaults to the page's project
  | "stage" // StageId, from "requirements", "BRD", "stage 2", "QA", "sign-off"…
  | "run" // run id (or a unique prefix); defaults to the page's run
  | "task" // task id in the resolved project, from "T-3", its Jira key or its title
  | "epic" // epic id in the resolved project, from its id, Jira key or title
  | "requirement" // BR ref in the resolved project's trace, "BR-2"
  | "change" // change-review id in the resolved project, from its id or label
  | "stage-note" // stage note id in the resolved project, from its id or text
  | "doc" // "brd" | "aad" | "plan"
  | "note" // memory note id `<type>/<slug>`, from an id or a memory search
  | "workflow" // weft workflow name
  | "person" // a display name for "Acting as"
  | "page" // a top-level page: home, inbox, projects, runs, memory, settings, new-project
  | "enum" // one of `values` (with `synonyms`)
  | "number"
  | "boolean"
  | "text" // free text, kept verbatim (comments, notes, requests, queries)
  | "json"; // a JSON object (workflow input)

export interface ParamSpec {
  kind: ParamKind;
  /** Shown in confirmations and given to a model as the parameter's description. */
  description: string;
  /** Default true. An optional parameter is never asked for. */
  required?: boolean;
  /** For "enum". */
  values?: readonly string[];
  /** For "enum": extra words for a value, e.g. { approved: ["approve", "accept", "ok"] }. */
  synonyms?: Readonly<Record<string, readonly string[]>>;
  /** The question asked when a required value is missing. Default from the kind. */
  ask?: string;
  /** Take the page's project/stage/run/note when not given. Default true for those kinds. */
  fromPage?: boolean;
}

export type Params = Readonly<Record<string, ParamSpec>>;

interface KindValue {
  project: string;
  stage: StageId;
  run: string;
  task: string;
  epic: string;
  requirement: string;
  change: string;
  "stage-note": string;
  doc: "brd" | "aad" | "plan";
  note: string;
  workflow: string;
  person: string;
  page: PageId;
  enum: string;
  number: number;
  boolean: boolean;
  text: string;
  json: Record<string, unknown>;
}

type ValueOf<S extends ParamSpec> = S["kind"] extends "enum" ? (S["values"] extends readonly (infer V)[] ? V : string) : KindValue[S["kind"]];
type Simplify<T> = { [K in keyof T]: T[K] } & {};
/** The input object a tool's `run` gets: required params present, optional ones maybe. */
export type InputOf<P extends Params> = Simplify<
  { -readonly [K in keyof P as P[K]["required"] extends false ? never : K]: ValueOf<P[K]> } & {
    -readonly [K in keyof P as P[K]["required"] extends false ? K : never]?: ValueOf<P[K]>;
  }
>;

export type PageId = "home" | "inbox" | "projects" | "new-project" | "runs" | "memory" | "settings";

// ---------------------------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------------------------

export type ToolGroup = "navigation" | "session" | "projects" | "stages" | "epics" | "tasks" | "qa" | "inbox" | "runs" | "memory" | "settings";

/** read: runs without asking. write: waits for Confirm. destructive: Confirm in the danger tone. */
export type ToolEffect = "read" | "write" | "destructive";

export interface ToolDef<N extends string, P extends Params, C extends readonly ClientFn[]> {
  /** snake_case, unique; the name a model calls it by. */
  name: N;
  group: ToolGroup;
  /** Short imperative title for the card: "Start the requirements run". */
  title: string;
  /** One or two sentences for a model: what it does and when to use it. */
  description: string;
  effect: ToolEffect;
  params: P;
  /**
   * Phrasings the mock brain recognises. `[x]` is optional, `(a|b)` picks one, `{param}`
   * captures a parameter; matching ignores case and a leading "please", "can you" and the like.
   * E.g. "start [the] (requirements|brd|po-brd) [run] [for|on] {projectId}".
   */
  utterances: readonly string[];
  /** Example requests for help and suggestions; `{project}` becomes a real project name. */
  examples: readonly string[];
  /** The client functions this tool calls (see ClientFn). Feeds the coverage check. */
  covers: C;
  /** One line for the card, with names rather than ids: "Start the po-brd run for Checkout v2". */
  summary: (input: InputOf<P>, ctx: ToolContext) => string | Promise<string>;
  /** Extra lines for the confirmation card (gate warnings, what happens next). Optional. */
  preview?: (input: InputOf<P>, ctx: ToolContext) => Promise<ResultBlock[]> | ResultBlock[];
  /** Why it can't run right now, as a disabled button would say (a gate with blockers). Confirm is disabled. */
  blocked?: (input: InputOf<P>, ctx: ToolContext) => Promise<string | undefined> | string | undefined;
  run: (input: InputOf<P>, ctx: ToolContext) => Promise<ToolResult>;
}

/** A defined tool (see define.ts). The input type is erased so tools fit in one registry. */
export interface AssistantTool<N extends string = string, C extends readonly ClientFn[] = readonly ClientFn[]> {
  name: N;
  group: ToolGroup;
  title: string;
  description: string;
  effect: ToolEffect;
  params: Params;
  utterances: readonly string[];
  examples: readonly string[];
  covers: C;
  summary: (input: ToolInput, ctx: ToolContext) => string | Promise<string>;
  preview?: (input: ToolInput, ctx: ToolContext) => Promise<ResultBlock[]> | ResultBlock[];
  blocked?: (input: ToolInput, ctx: ToolContext) => Promise<string | undefined> | string | undefined;
  run: (input: ToolInput, ctx: ToolContext) => Promise<ToolResult>;
}

export type ToolInput = Record<string, unknown>;

/** Where the person is: the page's project, stage, run or memory note become defaults. */
export interface PageContext {
  pathname: string;
  projectId?: string;
  stage?: StageId;
  runId?: string;
  noteId?: string;
}

/** What a tool can use besides the API client. Built by the panel (use-assistant.ts). */
export interface ToolContext {
  qc: QueryClient;
  world: World;
  page: PageContext;
  /** Client-side navigation (router.push). */
  navigate: (href: string) => void;
  /** Refetch what a write touched, like the UI's mutations do. No project: every project. */
  invalidate: (projectId?: string) => void;
  /** next-themes. */
  setTheme: (theme: "light" | "dark" | "system") => void;
  actor: { name: string; set: (name: string) => void };
  openPalette: (search?: string) => void;
}

// ---------------------------------------------------------------------------------------------
// Results: small, serialisable blocks the panel renders (they are kept in the chat history)
// ---------------------------------------------------------------------------------------------

export interface ResultItem {
  title: string;
  subtitle?: string;
  /** Right-aligned muted text, e.g. "2h ago" or "$1.20". */
  meta?: string;
  href?: string;
  status?: { label: string; tone: Tone };
}

export type ResultBlock =
  | { type: "items"; title?: string; items: ResultItem[]; empty?: string; more?: { label: string; href: string } }
  | { type: "facts"; title?: string; facts: Array<{ label: string; value: string; href?: string }> }
  | { type: "text"; text: string; tone?: Tone }
  | { type: "markdown"; title?: string; text: string; href?: string }
  | { type: "links"; links: Array<{ label: string; href: string }> }
  /** A weft human request, rendered as the same form the Inbox shows (answering it is the form's job). */
  | { type: "request"; runId: string; request: PendingEntry; projectId?: string };

export interface ToolResult {
  /** What happened, in a sentence or two. */
  text: string;
  blocks?: ResultBlock[];
}

// ---------------------------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------------------------

export interface Choice {
  label: string;
  /** Sent as the person's reply when picked. */
  reply: string;
}

export type CallStatus = "proposed" | "running" | "done" | "error" | "cancelled";

export interface ToolCallPart {
  type: "call";
  id: string;
  tool: string;
  input: ToolInput;
  /** Resolved for display when the call was proposed (names, not ids). */
  summary: string;
  /** Param label/value rows for the card. */
  details: Array<{ label: string; value: string }>;
  preview?: ResultBlock[];
  /** Set when the tool said it can't run yet; Confirm stays disabled. */
  blocked?: string;
  status: CallStatus;
  result?: ToolResult;
  error?: string;
}

export type AssistantPart = { type: "text"; text: string } | { type: "choices"; options: Choice[] } | ToolCallPart;

export type ChatMessage =
  | { id: string; role: "user"; text: string; at: number }
  | { id: string; role: "assistant"; parts: AssistantPart[]; at: number };

/** A question the brain asked for a missing parameter; the next reply answers it. */
export interface PendingAsk {
  tool: string;
  input: ToolInput;
  param: string;
  /** Phrases captured for later parameters, resolved once this one is known (a task named before its project). */
  raw?: Record<string, string>;
  /** Replies that did not answer it; after one, the next miss is treated as a new message. */
  misses?: number;
}

// ---------------------------------------------------------------------------------------------
// Brains
// ---------------------------------------------------------------------------------------------

export type BrainEvent =
  | { type: "text"; text: string }
  | { type: "choices"; options: Choice[] }
  /** Propose a tool call; the panel runs reads and asks before writes. */
  | { type: "call"; tool: string; input: ToolInput }
  /** Ask for a parameter; the next reply is offered to `respond` as `pending`. */
  | { type: "ask"; pending: PendingAsk };

export interface BrainInput {
  text: string;
  history: readonly ChatMessage[];
  pending?: PendingAsk;
  ctx: ToolContext;
  tools: readonly AssistantTool[];
}

/**
 * Turns one message into events. The mock brain matches phrasings; a model-backed brain would
 * send `history` and `toolDefinitions()` to the model (through a server route that holds the
 * API key), stream its text, and turn its tool_use blocks into "call" events. The panel runs
 * those calls in the browser, with the person's confirmation, and their results go back to the
 * model as tool_result on the next `respond`.
 */
export interface AssistantBrain {
  id: string;
  /** Shown in the panel header, e.g. "Rule-based mock". */
  label: string;
  respond(input: BrainInput): AsyncIterable<BrainEvent>;
}
