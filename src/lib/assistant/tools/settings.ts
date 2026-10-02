import { delivery } from "@/lib/api/client";
import { qk } from "@/lib/api/keys";
import type { DemoSpeed, Settings } from "@/lib/delivery/types";
import { defineTool } from "../define";
import type { ResultBlock, ToolContext } from "../types";

/** The Settings page's speed options. */
const SPEEDS: Record<DemoSpeed, { label: string; factor: string; line: string }> = {
  instant: { label: "Instant", factor: "x0", line: "Steps finish at once; every run jumps straight to its next human step." },
  fast: { label: "Fast", factor: "x1", line: "Steps take a few seconds. The default, good for a live walkthrough." },
  realistic: { label: "Realistic", factor: "x5", line: "Five times slower than fast, closer to how long real agents take." },
};

const SOURCE_LABEL: Record<Settings["dataSource"], string> = { mock: "Built-in mock", weft: "weft daemon" };

/** Write the result into the settings query, like useUpdateSettings. */
async function updateSettings(patch: Partial<Settings>, ctx: ToolContext): Promise<Settings> {
  const s = await delivery.updateSettings(patch);
  ctx.qc.setQueryData(qk.settings, s);
  return s;
}

const SHARED = "This applies to everyone using this demo server, not just you.";

/** Demo settings: speed, where /api/weft is served from, the daemon, and resetting the demo. */
export const settingsTools = [
  defineTool({
    name: "show_settings",
    group: "settings",
    title: "Show the settings",
    description: "Show the demo's settings: who you act as, the demo speed, the data source behind /api/weft (built-in mock or weft daemon) and the daemon URL.",
    effect: "read",
    params: {},
    utterances: [
      "(what are|what're|whats|what's) [my|the] [current] settings",
      "(show|list|get) [me] [my|the] current settings",
      "(what's|what is|whats) the [current] (demo speed|speed|data source|daemon url|daemon address|weft daemon url)",
      "(which|what) data source (is|am i|are we) (active|in use|using|being used|on)",
      "(are we|am i|is it) (on|using|running on) [the] (mock|daemon|weft daemon|real daemon|real weft)",
      "how fast (is|are) [the] (demo|agents|simulation|runs) [running|set to]",
    ],
    examples: ["What are my settings?", "Which data source am I using?"],
    covers: ["delivery.settings"],
    summary: () => "Show the settings",
    run: async (_input, ctx) => {
      const s = await ctx.world.settings();
      const speed = SPEEDS[s.speed];
      return {
        text: `Demo speed is ${speed.label.toLowerCase()} (${speed.factor}) and /api/weft is served by the ${s.dataSource === "weft" ? `weft daemon at ${s.weftDaemon}` : "built-in mock"}. You're acting as ${ctx.actor.name}.`,
        blocks: [
          {
            type: "facts",
            facts: [
              { label: "Acting as", value: ctx.actor.name },
              { label: "Demo speed", value: `${speed.label} (${speed.factor}): ${speed.line}` },
              { label: "Data source", value: SOURCE_LABEL[s.dataSource] },
              { label: "Daemon URL", value: s.weftDaemon },
            ],
          },
          { type: "links", links: [{ label: "Open Settings", href: "/settings" }] },
        ],
      };
    },
  }),
  defineTool({
    name: "set_demo_speed",
    group: "settings",
    title: "Change the demo speed",
    description: "Set how long each simulated agent step takes: instant (x0), fast (x1, the default) or realistic (x5). Applies to every run, including ones already going.",
    effect: "write",
    params: {
      speed: {
        kind: "enum",
        description: "instant, fast or realistic",
        values: ["instant", "fast", "realistic"],
        synonyms: {
          instant: ["x0", "immediate", "immediately", "fastest", "max", "maximum", "no delay", "zero", "instantly"],
          fast: ["x1", "default", "normal", "quick", "standard"],
          realistic: ["x5", "slow", "slower", "real", "real time", "realtime", "lifelike", "real speed"],
        },
        ask: "Which speed: instant, fast or realistic?",
      },
    },
    utterances: [
      "(set|change|switch|put) [the] [demo] speed to {speed}",
      "(use|switch to|go) [the] {speed} [demo] speed",
      "make [the] (demo|agents|simulation|runs|steps) {speed}",
      "(run|make) [the] (demo|agents|simulation) (at|on) {speed} [speed]",
      "(set|change) [the] [demo] speed",
    ],
    examples: ["Set the demo speed to instant", "Make the agents realistic"],
    covers: ["delivery.updateSettings"],
    summary: ({ speed }) => `Set the demo speed to ${SPEEDS[speed].label.toLowerCase()} (${SPEEDS[speed].factor})`,
    preview: ({ speed }) => [{ type: "text", text: `${SPEEDS[speed].line} ${SHARED}` }],
    run: async ({ speed }, ctx) => {
      const s = await updateSettings({ speed }, ctx);
      return { text: `Demo speed: ${SPEEDS[s.speed].label.toLowerCase()}. ${SPEEDS[s.speed].line}` };
    },
  }),
  defineTool({
    name: "set_data_source",
    group: "settings",
    title: "Switch the data source",
    description:
      "Choose where /api/weft is served from: the built-in mock, or a real weft daemon (proxied to the daemon URL). Applies to everyone on this server; projects stay mocked either way. Switching to the daemon only goes ahead when it answers.",
    effect: "write",
    params: {
      dataSource: {
        kind: "enum",
        description: "mock (built in) or weft (the daemon)",
        values: ["mock", "weft"],
        synonyms: {
          mock: ["built in", "builtin", "the mock", "mocked", "simulated", "simulation", "fake", "demo", "local", "built in mock"],
          weft: ["daemon", "weft daemon", "the daemon", "real", "real daemon", "real weft", "proxy", "the weft daemon"],
        },
        ask: "Which data source: the built-in mock or the weft daemon?",
      },
    },
    utterances: [
      "(switch|change|set) [the] (data source|source|backend|weft api) to [the] {dataSource}",
      "(use|switch to|switch back to|go back to|connect to) [the] {dataSource} (data source|backend|engine|daemon)",
      "(switch back to|go back to) [the] {dataSource}",
      "(use|switch to) [the] {dataSource} mock",
    ],
    examples: ["Switch the data source to the weft daemon", "Switch back to the mock"],
    covers: ["delivery.updateSettings", "delivery.daemonProbe", "delivery.settings"],
    summary: ({ dataSource }) => (dataSource === "weft" ? "Switch /api/weft to the weft daemon" : "Switch /api/weft back to the built-in mock"),
    preview: async ({ dataSource }, ctx) => {
      const s = await ctx.world.settings();
      if (s.dataSource === dataSource) return [{ type: "text", text: `/api/weft already comes from the ${SOURCE_LABEL[dataSource].toLowerCase()}.` }];
      if (dataSource === "mock") return [{ type: "text", text: `A simulated weft engine inside this app runs all five workflows again. ${SHARED}` }];
      const probe = await delivery.daemonProbe();
      const blocks: ResultBlock[] = [
        { type: "text", text: `${SHARED} Runs, pending requests and blobs then come from the daemon at ${probe.url}, while projects stay mocked and keep pointing at mock run ids the daemon does not know.` },
        probe.ok
          ? { type: "text", tone: "success", text: `The daemon answers${probe.version ? ` (weft ${probe.version})` : ""}.` }
          : { type: "text", tone: "danger", text: `${probe.error ?? `No weft daemon answered at ${probe.url}.`} Start the daemon or set another URL first; I won't switch while it doesn't answer.` },
      ];
      return blocks;
    },
    run: async ({ dataSource }, ctx) => {
      const current = await ctx.world.settings();
      if (current.dataSource === dataSource) return { text: `/api/weft already comes from the ${SOURCE_LABEL[dataSource].toLowerCase()}.` };
      if (dataSource === "weft") {
        // Settings only offers the switch once the saved daemon URL answers.
        const probe = await delivery.daemonProbe();
        if (!probe.ok) throw new Error(`${probe.error ?? `No weft daemon answered at ${probe.url}.`} Start the daemon or set another URL first.`);
      }
      const s = await updateSettings({ dataSource }, ctx);
      return {
        text: s.dataSource === "weft" ? `Data source: weft daemon. /api/weft now proxies to ${s.weftDaemon}; switch back to the mock for the full demo.` : "Data source: built-in mock.",
      };
    },
  }),
  defineTool({
    name: "set_daemon_url",
    group: "settings",
    title: "Set the weft daemon URL",
    description: "Save the http(s) URL of the weft daemon that /api/weft proxies to when the data source is the daemon.",
    effect: "write",
    params: { url: { kind: "text", description: "The daemon's base URL, e.g. http://127.0.0.1:4781", ask: "What's the daemon's URL? For example http://127.0.0.1:4781." } },
    utterances: [
      "(set|change|update) [the] [weft] daemon (url|address) to {url}",
      "(point|connect) [the] [weft] daemon (at|to) {url}",
      "(use|connect to) [the] [weft] daemon at {url}",
      "(set|change|update) [the] [weft] daemon (url|address)",
    ],
    examples: ["Set the daemon URL to http://127.0.0.1:4781"],
    covers: ["delivery.updateSettings"],
    summary: ({ url }) => `Set the daemon URL to ${url}`,
    preview: () => [{ type: "text", text: `Only the saved URL is used, and only while the data source is the weft daemon. ${SHARED}` }],
    run: async ({ url }, ctx) => {
      const s = await updateSettings({ weftDaemon: url.trim() }, ctx);
      return { text: `Daemon URL set to ${s.weftDaemon}.${s.dataSource === "weft" ? " /api/weft proxies there now." : ""}` };
    },
  }),
  defineTool({
    name: "probe_daemon",
    group: "settings",
    title: "Check the weft daemon",
    description: "Check whether a weft daemon answers at the saved daemon URL, and which weft version it runs.",
    effect: "read",
    params: {},
    utterances: [
      "(is|check if|check whether) [the] [weft] daemon [is] (up|running|reachable|available|answering|alive|online)",
      "(probe|ping|check|test) [the] [weft] daemon [connection|url]",
      "can [you|we|i] reach the [weft] daemon",
      "does the [weft] daemon (answer|respond|work)",
    ],
    examples: ["Is the daemon up?", "Check the daemon"],
    covers: ["delivery.daemonProbe"],
    summary: () => "Check the weft daemon",
    run: async () => {
      const p = await delivery.daemonProbe();
      return p.ok
        ? { text: `The weft daemon at ${p.url} answers${p.version ? ` (weft ${p.version})` : ""}. You can switch the data source to it.` }
        : { text: `${p.error ?? `No weft daemon answered at ${p.url}.`} Start the daemon or save another URL in Settings.`, blocks: [{ type: "links", links: [{ label: "Open Settings", href: "/settings" }] }] };
    },
  }),
  defineTool({
    name: "reset_demo",
    group: "settings",
    title: "Reset the demo data",
    description: "Put the seeded projects back in their starting states and delete projects created since: every project, run, answer and decision. Affects everyone on this demo server.",
    effect: "destructive",
    params: {},
    utterances: [
      "reset [the|all] [demo] (demo|data|app|everything|seed data|projects)",
      "(start over|start fresh|start from scratch)",
      "(restore|reload) [the] (seed|seeded|demo) data",
      "(wipe|clear) [the] demo [data]",
      "put [the] (demo|projects) back [to the start|to the starting state|to the beginning]",
    ],
    examples: ["Reset the demo data"],
    covers: ["delivery.reset"],
    summary: () => "Reset all demo data",
    preview: () => [{ type: "text", tone: "danger", text: `Every project, run, answer and decision goes back to the seeded state, and projects created since are deleted. ${SHARED}` }],
    run: async (_input, ctx) => {
      await delivery.reset();
      // Like useResetDemo: everything is stale now.
      void ctx.qc.invalidateQueries();
      return { text: "Demo data reset. The seeded projects are back in their starting states.", blocks: [{ type: "links", links: [{ label: "Go home", href: "/" }] }] };
    },
  }),
] as const;
