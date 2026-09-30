import { Compass, FolderKanban, House } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <div className="flex flex-1 items-center justify-center py-16">
      <div className="card-surface flex w-full max-w-lg flex-col items-center gap-4 rounded-2xl px-6 py-10 text-center">
        <span className="inline-flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Compass aria-hidden className="size-5" strokeWidth={1.75} />
        </span>
        <div className="flex flex-col gap-1.5">
          <div className="kicker">404</div>
          <h1 className="text-2xl font-normal tracking-[-0.02em]">Nothing lives at this address</h1>
          <p className="text-sm text-muted-foreground">The project, stage, run or document may have been removed, or the demo data was reset.</p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button className="rounded-full" asChild>
            <Link href="/">
              <House aria-hidden />
              Home
            </Link>
          </Button>
          <Button variant="outline" className="rounded-full" asChild>
            <Link href="/projects">
              <FolderKanban aria-hidden />
              All projects
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
