import { defineTool } from "../define";

/** The person and this browser: who they act as, and the theme. */
export const sessionTools = [
  defineTool({
    name: "act_as",
    group: "session",
    title: "Change who you act as",
    description: "Set the 'Acting as' name that every later decision and answer is attributed to (there are no roles yet).",
    effect: "read",
    params: { name: { kind: "person", description: "The person's display name" } },
    utterances: ["act as {name}", "(switch|change|set) [the] (user|person|actor|acting as|name) to {name}", "(i am|i'm|im) {name}", "(log in|sign in|login) as {name}"],
    examples: ["Act as Priya", "Switch the user to Alex"],
    covers: [],
    summary: ({ name }) => `Act as ${name}`,
    run: async ({ name }, ctx) => {
      ctx.actor.set(name);
      return { text: `You're now acting as ${name}. Decisions and answers from here on are attributed to ${name}.` };
    },
  }),
  defineTool({
    name: "who_am_i",
    group: "session",
    title: "Show who you act as",
    description: "Say which name decisions and answers are currently attributed to.",
    effect: "read",
    params: {},
    utterances: ["who am i [acting as]", "(what is|what's|whats) my name", "who (is|am) [the] (current user|acting as|i)", "who am i logged in as"],
    examples: ["Who am I acting as?"],
    covers: [],
    summary: () => "Show who you act as",
    run: async (_input, ctx) => ({ text: `You're acting as ${ctx.actor.name}. Anyone can approve anything for now; the name is what gets recorded.` }),
  }),
  defineTool({
    name: "set_theme",
    group: "session",
    title: "Change the theme",
    description: "Switch the app between the light theme, the dark theme, or following the system setting.",
    effect: "read",
    params: {
      theme: { kind: "enum", description: "light, dark or system", values: ["light", "dark", "system"], synonyms: { light: ["day", "bright"], dark: ["night", "dim"], system: ["auto", "automatic", "default", "os"] } },
    },
    utterances: [
      "(switch|change|set|turn) [the] (theme|mode|appearance|colors|colours) to {theme} [mode|theme]",
      "(use|switch to|turn on|enable|go|activate) {theme} (mode|theme)",
      "{theme} (mode|theme) [please]",
      "make it {theme}",
    ],
    examples: ["Switch to dark mode", "Use the system theme"],
    covers: [],
    summary: ({ theme }) => `Use the ${theme} theme`,
    run: async ({ theme }, ctx) => {
      ctx.setTheme(theme as "light" | "dark" | "system");
      return { text: theme === "system" ? "The theme now follows your system setting." : `Switched to the ${theme} theme.` };
    },
  }),
] as const;
