/**
 * Shared with the server: layout.tsx inlines ASSISTANT_BOOT_SCRIPT at the top of <body> so the
 * docked panel's space is taken before first paint (no "use client" here, or the server would
 * import references instead of strings).
 */
export const ASSISTANT_OPEN_KEY = "wefty:assistant:open";

/** Open unless closed last time (a first visit opens it); without storage, open. */
export const ASSISTANT_BOOT_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(ASSISTANT_OPEN_KEY)})!=="0")document.documentElement.dataset.assistant="open"}catch(e){document.documentElement.dataset.assistant="open"}`;
