"use client";

/**
 * A fenced ```mermaid block. mermaid (~1 MB) is imported on first use in the browser only; the
 * theme follows next-themes. If the diagram does not parse, the source is shown instead, with
 * the error, so a broken diagram in an agent draft never hides content.
 */
import { useTheme } from "next-themes";
import { useEffect, useId, useState } from "react";
import { cn } from "@/lib/utils";

type State = { key: string; svg?: string; error?: string };

let renderSeq = 0;

export function MermaidBlock({ code, className }: { code: string; className?: string }) {
  const { resolvedTheme } = useTheme();
  // resolvedTheme is undefined outside a ThemeProvider and before mount; the html class is the truth then.
  const dark = resolvedTheme ? resolvedTheme === "dark" : typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const theme = dark ? "dark" : "neutral";
  const baseId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const key = `${theme}\n${code}`;
  const [state, setState] = useState<State | null>(null);

  useEffect(() => {
    let cancelled = false;
    const id = `mermaid-${baseId}-${++renderSeq}`;
    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme, fontFamily: "inherit" });
        const { svg } = await mermaid.render(id, code);
        if (!cancelled) setState({ key, svg });
      } catch (error) {
        // mermaid leaves its error graphic in the body when render fails.
        document.getElementById(id)?.remove();
        document.getElementById(`d${id}`)?.remove();
        if (!cancelled) setState({ key, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, theme, baseId, key]);

  const current = state?.key === key ? state : null;

  if (current?.svg) {
    return (
      <figure
        className={cn("my-5 overflow-x-auto rounded-[20px] bg-field p-4 shadow-[0_0_0_1px_var(--rule)] [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full", className)}
        role="img"
        aria-label="Diagram"
        // securityLevel "strict" makes mermaid sanitize labels and drop scripts and click handlers.
        dangerouslySetInnerHTML={{ __html: current.svg }}
      />
    );
  }
  return (
    <figure className={cn("my-4 space-y-2", className)}>
      {current?.error ? (
        <figcaption className="text-xs text-status-attention-fg">Diagram could not be rendered: {current.error.split("\n")[0]}</figcaption>
      ) : (
        <figcaption className="text-xs text-muted-foreground">Rendering diagram…</figcaption>
      )}
      <pre className="overflow-x-auto rounded-[16px] bg-well/60 p-4 font-mono text-xs leading-5">
        <code>{code}</code>
      </pre>
    </figure>
  );
}
