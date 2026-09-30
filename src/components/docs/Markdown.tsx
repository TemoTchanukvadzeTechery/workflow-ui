"use client";

/**
 * GFM markdown for BRDs, AADs, reports and memory: rehype-slug heading ids (matching toc.ts),
 * ruled tables (no outer border, STYLE 6), fenced mermaid rendered by MermaidBlock, and source
 * citations such as [N1 L2, R2 Acceptance Criteria] as small mono token chips with a tooltip. Raw HTML is not rendered
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
              "token-chip h-[18px] rounded-[5px] px-1 font-mono text-[10.5px] leading-none",
              onCitationClick && "cursor-pointer transition-[filter] hover:brightness-95 dark:hover:brightness-125",
            )}
          >
            {part.raw}
          </span>
        );
        return (
          <Tooltip key={i}>
            <TooltipTrigger asChild>
              {onCitationClick ? (
                <button type="button" className="rounded-[5px] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none" onClick={() => onCitationClick(part.source, part.raw)} aria-label={`Citation ${describeCitationPart(part)}`}>
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
      return <Tag className={cn("scroll-mt-20 font-medium tracking-[-0.015em] text-heading", cls, className)} {...props} />;
    };
  return {
    h1: heading("h1", sm ? "mt-4 mb-2 text-xl leading-7" : "mt-6 mb-4 text-[32px] leading-[1.12] font-normal tracking-[-0.03em] first:mt-0"),
    h2: heading("h2", sm ? "mt-5 mb-2 text-[17px] leading-6" : "mt-10 mb-3 border-b border-rule pb-2 text-[22px] leading-8 first:mt-0"),
    h3: heading("h3", sm ? "mt-4 mb-1.5 text-[15px] leading-6" : "mt-7 mb-2 text-[17px] leading-7"),
    h4: heading("h4", "mt-5 mb-1.5 text-[15px] leading-6"),
    h5: heading("h5", "mt-4 mb-1 text-sm text-muted-foreground"),
    h6: heading("h6", "mt-4 mb-1 text-xs text-muted-foreground uppercase tracking-[0.08em]"),
    p: ({ node: _node, className, ...props }: P<"p">) => {
      void _node;
      return <p className={cn("my-3", className)} {...props} />;
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
      return <ul className={cn("my-3 space-y-1.5 pl-5 marker:text-muted-foreground", isTaskList ? "list-none pl-1" : "list-disc", className)} {...props} />;
    },
    ol: ({ node: _node, className, ...props }: P<"ol">) => {
      void _node;
      return <ol className={cn("my-3 list-decimal space-y-1.5 pl-5 marker:text-muted-foreground", className)} {...props} />;
    },
    li: ({ node: _node, className, ...props }: P<"li">) => {
      void _node;
      return <li className={cn("pl-1 [&>input]:mr-1.5 [&>input]:align-middle", className)} {...props} />;
    },
    blockquote: ({ node: _node, className, ...props }: P<"blockquote">) => {
      void _node;
      return <blockquote className={cn("my-4 rounded-r-[14px] border-l-2 border-primary/50 bg-well/50 py-1.5 pr-3 pl-4 text-muted-foreground", className)} {...props} />;
    },
    hr: ({ node: _node, className, ...props }: P<"hr">) => {
      void _node;
      return <hr className={cn("my-8 border-rule", className)} {...props} />;
    },
    table: ({ node: _node, className, ...props }: P<"table">) => {
      void _node;
      return (
        <div className="relative my-4 w-full overflow-x-auto">
          {/* break-word, not the root's anywhere: anywhere shrinks min-content and splits words mid-cell; the wrapper scrolls instead. */}
          <table className={cn("w-full border-collapse text-[13px] leading-5 [overflow-wrap:break-word]", className)} {...props} />
        </div>
      );
    },
    thead: ({ node: _node, className, ...props }: P<"thead">) => {
      void _node;
      return <thead className={cn(className)} {...props} />;
    },
    th: ({ node: _node, className, ...props }: P<"th">) => {
      void _node;
      return <th className={cn("h-10 border-b border-rule px-3 py-2 text-left align-bottom text-[13px] font-normal text-muted-foreground first:pl-1", className)} {...props} />;
    },
    td: ({ node: _node, className, ...props }: P<"td">) => {
      void _node;
      return <td className={cn("border-b border-rule px-3 py-2.5 align-top first:pl-1", className)} {...props} />;
    },
    img: ({ node: _node, className, alt, ...props }: P<"img">) => {
      void _node;
      // eslint-disable-next-line @next/next/no-img-element -- markdown images are arbitrary URLs
      return <img alt={alt ?? ""} className={cn("my-4 max-w-full rounded-[16px]", className)} {...props} />;
    },
    pre: ({ node, className, children, ...props }: P<"pre">) => {
      const code = (node as HastNode | undefined)?.children?.find((c) => c.type === "element" && c.tagName === "code");
      const classes = code?.properties?.className;
      const lang = Array.isArray(classes) ? classes.map(String).find((c) => c.startsWith("language-"))?.slice(9) : undefined;
      if (lang === "mermaid") return <MermaidBlock code={hastText(code).replace(/\n$/, "")} />;
      return (
        <pre className={cn("my-4 overflow-x-auto rounded-[16px] bg-well/60 p-4 font-mono text-[12.5px] leading-5 text-heading", className)} {...props}>
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
const INLINE_CODE = "[&_:not(pre)>code]:rounded-[6px] [&_:not(pre)>code]:bg-foreground/[0.06] [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[0.84em] [&_:not(pre)>code]:text-heading";

function MarkdownImpl({ source, onCitationClick, className, idPrefix, size = "base" }: MarkdownProps): ReactNode {
  // `relative` keeps the absolutely positioned sr-only citation text inside any scroll container
  // around the document; without it, a long doc in a max-height viewer stretched the whole page.
  return (
    <CitationClick.Provider value={onCitationClick}>
      <TooltipProvider delayDuration={150}>
        <div className={cn("relative min-w-0 text-foreground [overflow-wrap:anywhere]", INLINE_CODE, size === "sm" ? "text-sm leading-6" : "text-[15px] leading-[1.7]", className)}>
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
