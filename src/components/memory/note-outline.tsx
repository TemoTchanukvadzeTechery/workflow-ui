/**
 * "On this page" for a note's prose: its H2/H3 headings with the ids rehype-slug gives them, so
 * long seeded notes (20-50 sections) are navigable. Rendered only when there is enough to jump
 * between. Hook-free and server-compatible.
 */
import { SectionCard } from "@/components/common";
import { extractHeadings } from "@/components/docs";
import { cn } from "@/lib/utils";

const MIN_HEADINGS = 4;

export function NoteOutline({ prose, className }: { prose: string; className?: string }) {
  const headings = extractHeadings(prose).filter((h) => h.depth === 2 || h.depth === 3);
  if (headings.length < MIN_HEADINGS) return null;
  return (
    <SectionCard density="dense" title="On this page" className={cn("min-w-0", className)}>
      <nav aria-label="Note sections" className="-mr-2 max-h-[min(50vh,420px)] overflow-y-auto pr-2">
        <ul className="flex flex-col">
          {headings.map((h) => (
            <li key={h.id}>
              <a
                href={`#${h.id}`}
                className={cn(
                  "-mx-2 block truncate rounded-[10px] px-2 py-1 text-sm transition-colors hover:bg-well/70 hover:text-heading focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                  h.depth === 2 ? "font-medium text-foreground" : "pl-5 text-muted-foreground",
                )}
              >
                {h.text}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </SectionCard>
  );
}
