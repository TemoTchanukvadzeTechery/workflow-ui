"use client";

/**
 * GFM markdown for BRDs, AADs, reports and memory: rehype-slug heading ids (matching toc.ts),
 * bordered tables, fenced mermaid rendered by MermaidBlock, and source citations such as
 * [N1 L2, R2 Acceptance Criteria] as small mono chips with a tooltip. Raw HTML is not rendered
 * (react-markdown escapes it), which matters because agent output is untrusted.
 */
import { createContext, memo, useContext, type ComponentProps, type ReactNode } from "react";
import ReactMarkdown, { type Components, type ExtraProps, type Options } from "react-markdown";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { describeCitationPart, parseCitation, remarkCitations } from "./citations";
import { MermaidBlock } from "./MermaidBlock";

export interface MarkdownProps {
  source: string;
  /** Called with the source id ("R2") and the whole citation text ("R2 Acceptance Criteria"). */
  onCitationClick?: (source: string, part: string) => void;
  className?: string;
  /** Prefix for heading ids when two copies of one document share a page. */
  idPrefix?: string;
  /** Smaller type for rails and report tabs. */
  size?: "base" | "sm";
}

type HastNode = { type: string; value?: string; tagName?: string; properties?: Record<string, unknown>; children?: HastNode[] };

function hastText(node: HastNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(hastText).join("");
}

/** The click handler lives in context so the component map can be static (stable identities). */
const CitationClick = createContext<MarkdownProps["onCitationClick"]>(undefined);

function CitationChip({ inner }: { inner: string }) {
  const onCitationClick = useContext(CitationClick);
  const parts = parseCitation(inner) ?? [];
  return (
    <span className="mx-0.5 inline-flex flex-wrap gap-0.5 align-baseline">
      {parts.map((part, i) => {
        const chip = (
          <span
            className={cn(
              // One line per chip: in a narrow table cell the text wraps between chips, never inside one.
              "inline-flex h-[18px] items-center rounded-[5px] border border-border bg-muted px-1 font-mono text-[10.5px] leading-none whitespace-nowrap text-muted-foreground",
              onCitationClick && "cursor-pointer hover:border-primary/40 hover:text-foreground",
            )}
          >
            {part.raw}
          </span>
        );
        return (
          <Tooltip key={i}>
            <TooltipTrigger asChild>
              {onCitationClick ? (
                <button type="button" className="rounded-[5px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" onClick={() => onCitationClick(part.source, part.raw)} aria-label={`Citation ${describeCitationPart(part)}`}>
                  {chip}
                </button>
              ) : (
                // Not a tab stop: a long AAD has hundreds of citations. Mouse users get the tooltip, screen readers the sr-only text.
                <span>
                  {chip}
                  <span className="sr-only"> ({describeCitationPart(part)})</span>
                </span>
              )}
            </TooltipTrigger>
            <TooltipContent side="top">{describeCitationPart(part)}</TooltipContent>
          </Tooltip>
        );
      })}
    </span>
  );
}

type P<K extends keyof React.JSX.IntrinsicElements> = ComponentProps<K> & ExtraProps;

function buildComponents(size: "base" | "sm"): Components {
  const sm = size === "sm";
  const heading = (Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6", cls: string) =>
    function Heading({ node: _node, className, ...props }: P<typeof Tag>) {
      void _node;
      return <Tag className={cn("scroll-mt-20 font-medium tracking-[-0.01em] text-foreground", cls, className)} {...props} />;
    };
  return {
    h1: heading("h1", sm ? "mt-4 mb-2 text-lg" : "mt-6 mb-3 text-[26px] leading-tight font-normal tracking-[-0.02em] first:mt-0"),
    h2: heading("h2", sm ? "mt-4 mb-1.5 text-base" : "mt-8 mb-3 border-b border-border pb-1.5 text-xl first:mt-0"),
    h3: heading("h3", sm ? "mt-3 mb-1 text-sm" : "mt-6 mb-2 text-base"),
    h4: heading("h4", "mt-4 mb-1.5 text-sm"),
    h5: heading("h5", "mt-3 mb-1 text-sm text-muted-foreground"),
    h6: heading("h6", "mt-3 mb-1 text-xs text-muted-foreground uppercase tracking-[0.08em]"),
    p: ({ node: _node, className, ...props }: P<"p">) => {
      void _node;
      return <p className={cn("my-2.5 leading-relaxed", className)} {...props} />;
    },
    a: ({ node: _node, className, href, ...props }: P<"a">) => {
      void _node;
      const external = !!href && /^https?:\/\//.test(href);
      return (
        <a
          href={href}
          className={cn("text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary", className)}
          {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
          {...props}
        />
      );
    },
    ul: ({ node: _node, className, ...props }: P<"ul">) => {
      void _node;
      const isTaskList = typeof className === "string" && className.includes("contains-task-list");
      return <ul className={cn("my-2.5 space-y-1 pl-5", isTaskList ? "list-none pl-1" : "list-disc", className)} {...props} />;
    },
    ol: ({ node: _node, className, ...props }: P<"ol">) => {
      void _node;
      return <ol className={cn("my-2.5 list-decimal space-y-1 pl-5 marker:text-muted-foreground", className)} {...props} />;
    },
    li: ({ node: _node, className, ...props }: P<"li">) => {
      void _node;
      return <li className={cn("pl-0.5 leading-relaxed [&>input]:mr-1.5 [&>input]:align-middle", className)} {...props} />;
    },
    blockquote: ({ node: _node, className, ...props }: P<"blockquote">) => {
      void _node;
      return <blockquote className={cn("my-3 border-l-2 border-primary/40 bg-muted/40 py-1 pr-2 pl-3 text-muted-foreground", className)} {...props} />;
    },
    hr: ({ node: _node, className, ...props }: P<"hr">) => {
      void _node;
      return <hr className={cn("my-6 border-border", className)} {...props} />;
    },
    table: ({ node: _node, className, ...props }: P<"table">) => {
      void _node;
      return (
        <div className="relative my-3 w-full overflow-x-auto rounded-lg border border-border">
          {/* break-word, not the root's anywhere: anywhere shrinks min-content and splits words mid-cell; the wrapper scrolls instead. */}
          <table className={cn("w-full border-collapse text-[13px] [overflow-wrap:break-word]", className)} {...props} />
        </div>
      );
    },
    thead: ({ node: _node, className, ...props }: P<"thead">) => {
      void _node;
      return <thead className={cn("bg-muted/60", className)} {...props} />;
    },
    th: ({ node: _node, className, ...props }: P<"th">) => {
      void _node;
      return <th className={cn("border-b border-border px-2.5 py-1.5 text-left align-bottom text-xs font-medium text-muted-foreground", className)} {...props} />;
    },
    td: ({ node: _node, className, ...props }: P<"td">) => {
      void _node;
      return <td className={cn("border-t border-border px-2.5 py-1.5 align-top", className)} {...props} />;
    },
    img: ({ node: _node, className, alt, ...props }: P<"img">) => {
      void _node;
      // eslint-disable-next-line @next/next/no-img-element -- markdown images are arbitrary URLs
      return <img alt={alt ?? ""} className={cn("my-3 max-w-full rounded-lg", className)} {...props} />;
    },
    pre: ({ node, className, children, ...props }: P<"pre">) => {
      const code = (node as HastNode | undefined)?.children?.find((c) => c.type === "element" && c.tagName === "code");
      const classes = code?.properties?.className;
      const lang = Array.isArray(classes) ? classes.map(String).find((c) => c.startsWith("language-"))?.slice(9) : undefined;
      if (lang === "mermaid") return <MermaidBlock code={hastText(code).replace(/\n$/, "")} />;
      return (
        <pre className={cn("my-3 overflow-x-auto rounded-lg border border-border bg-muted/50 p-3 font-mono text-xs leading-5", className)} {...props}>
          {children}
        </pre>
      );
    },
    span: ({ node, className, children, ...props }: P<"span">) => {
      const inner = (node as HastNode | undefined)?.properties?.dataCitation;
      if (typeof inner === "string") return <CitationChip inner={inner} />;
      return (
        <span className={className} {...props}>
          {children}
        </span>
      );
    },
  };
}

const remarkPlugins = [remarkGfm, remarkCitations] as unknown as NonNullable<Options["remarkPlugins"]>;

const COMPONENTS = { base: buildComponents("base"), sm: buildComponents("sm") };
const INLINE_CODE = "[&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-muted [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[0.86em]";

function MarkdownImpl({ source, onCitationClick, className, idPrefix, size = "base" }: MarkdownProps): ReactNode {
  // `relative` keeps the absolutely positioned sr-only citation text inside any scroll container
  // around the document; without it, a long doc in a max-height viewer stretched the whole page.
  return (
    <CitationClick.Provider value={onCitationClick}>
      <TooltipProvider delayDuration={150}>
        <div className={cn("relative min-w-0 text-foreground [overflow-wrap:anywhere]", INLINE_CODE, size === "sm" ? "text-[13px]" : "text-sm", className)}>
          <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={[[rehypeSlug, { prefix: idPrefix ?? "" }]]} components={COMPONENTS[size]}>
            {source}
          </ReactMarkdown>
        </div>
      </TooltipProvider>
    </CitationClick.Provider>
  );
}

/** Memoized: documents are large and re-render on every keystroke of a nearby form otherwise. */
export const Markdown = memo(MarkdownImpl);
