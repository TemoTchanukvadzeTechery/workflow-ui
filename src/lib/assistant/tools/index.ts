/**
 * Every assistant tool, in the order "help" lists them. One file per group; each tool says which
 * API client functions it calls (`covers`), and the check below fails the type check when a
 * client function is reachable from the UI but not from the assistant.
 */
import type { AssistantTool, ClientFn } from "../types";
import { epicsTools } from "./epics";
import { inboxTools } from "./inbox";
import { memoryTools } from "./memory";
import { navigationTools } from "./navigation";
import { projectsTools } from "./projects";
import { qaTools } from "./qa";
import { runsTools } from "./runs";
import { sessionTools } from "./session";
import { settingsTools } from "./settings";
import { stagesTools } from "./stages";
import { tasksTools } from "./tasks";

const ALL = [
  ...inboxTools,
  ...projectsTools,
  ...stagesTools,
  ...epicsTools,
  ...tasksTools,
  ...qaTools,
  ...runsTools,
  ...memoryTools,
  ...settingsTools,
  ...navigationTools,
  ...sessionTools,
] as const;

export const TOOLS: readonly AssistantTool[] = ALL;

export const toolByName = (name: string): AssistantTool | undefined => TOOLS.find((t) => t.name === name);

// ---------------------------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------------------------

/** Client functions no tool needs to call, and why. */
export const INTERNAL = {
  "weft.blobText": "Blob refs only appear inside documents and run reports, whose tools return the text already.",
} as const satisfies Partial<Record<ClientFn, string>>;

type Covered = (typeof ALL)[number]["covers"][number];
/** Client functions with no tool. Must stay empty: the assistant can do whatever the UI can. */
export type Uncovered = Exclude<ClientFn, Covered | keyof typeof INTERNAL>;

/** Accepts only `never`; anything else is a type error that prints the offending union. */
type MustBeEmpty<T extends never> = T;

/**
 * A type error here ("Type '"delivery.x" | …' does not satisfy the constraint 'never'") names
 * the client functions no tool covers: add a tool (or a `covers` entry) for each, or list it in
 * INTERNAL with the reason.
 */
export type CoverageComplete = MustBeEmpty<Exclude<ClientFn, Covered | keyof typeof INTERNAL>>;
