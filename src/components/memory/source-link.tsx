/**
 * One claim/frontmatter source, rendered by kind (plan A4): a document source links into the vault
 * (/memory/document/<slug>, with its §section muted); a Jira key or Confluence page id is a mono
 * chip, hyperlinked only when NEXT_PUBLIC_JIRA_BASE_URL / NEXT_PUBLIC_CONFLUENCE_BASE_URL is set;
 * a bitbucket.org path is an https external link. Accepts the CLI's parsed MemorySource (claims)
 * or a raw frontmatter `sources:` string, which it parses the same way the server does.
 * Hook-free and server-compatible.
 */
import { ExternalLink, FileText } from "lucide-react";
import Link from "next/link";
import type { MemorySource } from "@/lib/memory/types";
import { cn } from "@/lib/utils";

const DOCUMENT_RE = /^\[\[documents?\/([a-z0-9-]+)\]\](?:\s+§\s*(.+))?$/;
const JIRA_RE = /^[A-Z][A-Z0-9]+-\d+$/;
const CONFLUENCE_RE = /^confluence:(.+)$/;
const BITBUCKET_RE = /^bitbucket\.org\/\S+$/;

/** A raw frontmatter source string → MemorySource, or null when it matches no known kind. */
export function parseSourceString(raw: string): MemorySource | null {
  const text = raw.trim();
  const doc = DOCUMENT_RE.exec(text);
  if (doc) return { kind: "document", ref: doc[1], ...(doc[2] ? { section: doc[2].trim() } : {}) };
  if (JIRA_RE.test(text)) return { kind: "jira", ref: text };
  const page = CONFLUENCE_RE.exec(text);
  if (page) return { kind: "confluence", ref: page[1] };
  if (BITBUCKET_RE.test(text)) return { kind: "code", ref: text };
  return null;
}

const CHIP =
  "inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-[8px] bg-foreground/[0.05] px-2 font-mono text-xs text-foreground dark:bg-foreground/[0.07]";
const LINK_TEXT = "min-w-0 truncate underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none";

function stripTrailingSlash(base: string): string {
  return base.replace(/\/+$/, "");
}

export interface SourceLinkProps {
  /** A parsed claim source, or a raw frontmatter `sources:` entry. */
  source: MemorySource | string;
  className?: string;
}

export function SourceLink({ source, className }: SourceLinkProps) {
  const parsed = typeof source === "string" ? parseSourceString(source) : source;
  // A string no grammar matches still shows, muted, so nothing in the frontmatter is hidden.
  if (!parsed) {
    return (
      <span className={cn(CHIP, "text-muted-foreground", className)} title={String(source)}>
        <span className="min-w-0 truncate">{String(source).trim()}</span>
      </span>
    );
  }

  if (parsed.kind === "document") {
    return (
      <span className={cn(CHIP, className)} title={`documents/${parsed.ref}${parsed.section ? ` §${parsed.section}` : ""}`}>
        <FileText aria-hidden className="size-3 shrink-0 text-muted-foreground" strokeWidth={2} />
        <Link href={`/memory/document/${parsed.ref}`} className={LINK_TEXT}>
          {parsed.ref}
        </Link>
        {parsed.section ? <span className="min-w-0 truncate text-muted-foreground">§{parsed.section}</span> : null}
      </span>
    );
  }

  if (parsed.kind === "jira" || parsed.kind === "confluence") {
    const base = parsed.kind === "jira" ? process.env.NEXT_PUBLIC_JIRA_BASE_URL : process.env.NEXT_PUBLIC_CONFLUENCE_BASE_URL;
    const label = parsed.kind === "jira" ? parsed.ref : `confluence:${parsed.ref}`;
    const href = base
      ? parsed.kind === "jira"
        ? `${stripTrailingSlash(base)}/browse/${encodeURIComponent(parsed.ref)}`
        : `${stripTrailingSlash(base)}/pages/viewpage.action?pageId=${encodeURIComponent(parsed.ref)}`
      : undefined;
    if (!href) {
      return (
        <span className={cn(CHIP, className)} title={parsed.kind === "jira" ? "Jira ticket (set NEXT_PUBLIC_JIRA_BASE_URL to link it)" : "Confluence page (set NEXT_PUBLIC_CONFLUENCE_BASE_URL to link it)"}>
          <span className="min-w-0 truncate">{label}</span>
        </span>
      );
    }
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cn(CHIP, "transition-colors hover:text-heading", className)}>
        <span className={cn(LINK_TEXT, "truncate")}>{label}</span>
        <ExternalLink aria-hidden className="size-3 shrink-0 text-muted-foreground" strokeWidth={2} />
      </a>
    );
  }

  // code: bitbucket.org/<workspace>/<repo>[/path][@ref] → link to the repo path without the @ref.
  const url = `https://${parsed.ref.split("@")[0]}`;
  return (
    <a href={url} target="_blank" rel="noreferrer" className={cn(CHIP, "transition-colors hover:text-heading", className)} title={parsed.ref}>
      <span className={cn(LINK_TEXT, "truncate")}>{parsed.ref}</span>
      <ExternalLink aria-hidden className="size-3 shrink-0 text-muted-foreground" strokeWidth={2} />
    </a>
  );
}
