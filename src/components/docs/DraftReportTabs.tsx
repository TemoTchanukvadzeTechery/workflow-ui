"use client";

/**
 * The "draft report" attachment of a review request as tabs with counts (wrapping onto more rows
 * when narrow). Its format is a series of `## <Title>\n\n- item` sections, and an empty section is
 * `- none` (po-brd main.ts section()). The same parser reads the plan report and the memory
 * "changes" attachment.
 */
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { Markdown } from "./Markdown";

export interface ReportSection {
  title: string;
  items: string[];
  /** Section text that is not a bullet list, kept as markdown. */
  body?: string;
}

const NONE = /^(none|none found|n\/a)\.?$/i;

export function parseReportSections(markdown: string): ReportSection[] {
  const sections: ReportSection[] = [];
  let current: ReportSection | null = null;
  let item: string[] | null = null;
  let body: string[] = [];
  const closeItem = () => {
    if (current && item) {
      const text = item.join("\n").trim();
      if (text && !NONE.test(text)) current.items.push(text);
    }
    item = null;
  };
  const closeSection = () => {
    closeItem();
    if (current) {
      const rest = body.join("\n").trim();
      if (rest) current.body = rest;
      sections.push(current);
    }
    body = [];
  };
  for (const line of markdown.split("\n")) {
    const heading = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading?.[1]) {
      closeSection();
      current = { title: heading[1], items: [] };
      continue;
    }
    if (!current) continue;
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      closeItem();
      item = [bullet[1] ?? ""];
    } else if (item && (/^\s+\S/.test(line) || line.trim() === "")) {
      item.push(line.trim());
    } else {
      closeItem();
      body.push(line);
    }
  }
  closeSection();
  return sections;
}

/** Sections that deserve attention when non-empty get an amber count. */
const ATTENTION = /blocking|conflict|decisions needed|not traced|not covered|risk|open question/i;

export interface DraftReportTabsProps {
  markdown: string;
  className?: string;
  onCitationClick?: (source: string, part: string) => void;
  /** Shown when the markdown has no sections. */
  emptyText?: string;
}

export function DraftReportTabs({ markdown, className, onCitationClick, emptyText = "The report is empty." }: DraftReportTabsProps) {
  const sections = parseReportSections(markdown);
  const [tab, setTab] = useState<string | null>(null);
  if (sections.length === 0) {
    return markdown.trim() ? <Markdown source={markdown} size="sm" className={className} onCitationClick={onCitationClick} /> : <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }
  const active = tab !== null && sections.some((s, i) => `s${i}` === tab) ? tab : "s0";
  return (
    <Tabs value={active} onValueChange={setTab} className={cn("min-w-0 gap-3", className)}>
      {/* Tabs wrap onto more rows instead of scrolling sideways, so no section is hidden off the edge. */}
      <div className="pb-1">
        <TabsList variant="line" className="h-auto w-full flex-wrap justify-start gap-x-1 gap-y-2 group-data-horizontal/tabs:h-auto">
          {sections.map((section, i) => {
            const count = section.items.length;
            const loud = count > 0 && ATTENTION.test(section.title);
            return (
              <TabsTrigger key={i} value={`s${i}`} className="h-8 flex-none rounded-full px-3 text-[13px] data-active:bg-muted">
                <span>{section.title}</span>
                <span
                  className={cn(
                    "ml-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 font-mono text-[10.5px] tabular-nums",
                    loud ? "bg-status-attention-bg text-status-attention-fg" : "bg-muted text-muted-foreground",
                  )}
                  aria-label={`${count} items`}
                >
                  {count}
                </span>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </div>
      {sections.map((section, i) => (
        <TabsContent key={i} value={`s${i}`} className="min-w-0">
          {section.items.length === 0 && !section.body ? (
            <p className="rounded-lg bg-muted/50 px-3 py-4 text-center text-[13px] text-muted-foreground">None.</p>
          ) : (
            <div className="space-y-2">
              {section.body ? <Markdown source={section.body} size="sm" onCitationClick={onCitationClick} /> : null}
              {section.items.length > 0 ? (
                <ol className="space-y-1.5">
                  {section.items.map((text, j) => (
                    <li key={j} className="flex gap-2.5 rounded-lg border border-border px-3 py-2">
                      <span className="mt-0.5 font-mono text-[11px] text-muted-foreground tabular-nums">{j + 1}</span>
                      <Markdown source={text} size="sm" className="[&_p]:my-0" onCitationClick={onCitationClick} />
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
          )}
        </TabsContent>
      ))}
    </Tabs>
  );
}
