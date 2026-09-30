"use client";

/**
 * Demo controls: who you are acting as, how fast the simulated agents run, where /api/weft is
 * served from, reset and skip-ahead tools, and which workflows are real weft versus mocked.
 */
import { AlertTriangle, Check, CircleX, Database, FastForward, RotateCcw, Server, UserRound } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ErrorState, InitialsAvatar, PageHeader, SectionCard, SegmentedControl, StatusPill } from "@/components/common";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { DEFAULT_ACTOR, useActorName } from "@/lib/api/actor";
import { useDaemonProbe, useFastForward, useMeta, useResetDemo, useSettings, useUpdateSettings, useWorkflows } from "@/lib/api/queries";
import { STAGES, type DemoSpeed, type Settings } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";

const SPEEDS: Array<{ value: DemoSpeed; label: string; factor: string; line: string }> = [
  { value: "instant", label: "Instant", factor: "x0", line: "Steps finish at once; every run jumps straight to its next human step." },
  { value: "fast", label: "Fast", factor: "x1", line: "Steps take a few seconds. The default, good for a live walkthrough." },
  { value: "realistic", label: "Realistic", factor: "x5", line: "Five times slower than fast, closer to how long real agents take." },
];

const REAL_WORKFLOWS = new Set(["po-brd", "architect-aad"]);

/**
 * A radio card: one option of a segmented choice, with a one-line explanation. Drawn like the
 * stage forms' OptionCards: options sit in a well track (see the radiogroup), the checked one is
 * a raised segment with an ink check.
 */
function OptionCard({ checked, onSelect, disabled, title, badge, children, icon }: { checked: boolean; onSelect: () => void; disabled?: boolean; title: string; badge?: ReactNode; children: ReactNode; icon?: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "group flex min-w-0 flex-col gap-1.5 rounded-[16px] p-3.5 text-left transition-[background-color,box-shadow] duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60",
        checked ? "bg-raised shadow-(--raised-shadow)" : "hover:bg-raised/60",
      )}
    >
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors", checked ? "border-transparent bg-ink text-ink-foreground" : "border-muted-foreground/45")}
        >
          {checked ? <Check className="size-3" strokeWidth={3} /> : null}
        </span>
        {icon}
        <span className={cn("text-[15px] font-medium", checked ? "text-heading" : "text-muted-foreground group-hover:text-heading")}>{title}</span>
        <span className="flex-1" />
        {badge}
      </span>
      <span className="pl-7 text-[13px] leading-5 text-muted-foreground">{children}</span>
    </button>
  );
}

function ActingAsCard() {
  const [actor, setActor] = useActorName();
  const [draft, setDraft] = useState<string | null>(null);
  const inputId = useId();
  const value = draft ?? actor;
  const dirty = draft !== null && draft.trim() !== actor;
  const save = () => {
    if (draft === null) return;
    const name = draft.trim() || DEFAULT_ACTOR;
    setActor(name);
    setDraft(null);
    toast.success(`Acting as ${name}`);
  };
  return (
    <SectionCard title="Acting as" description="Every answer, approval and note records this name.">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label htmlFor={inputId} className="text-[13px] font-medium text-heading">
          Display name
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <InitialsAvatar name={value.trim() || DEFAULT_ACTOR} size="xl" ring />
          <Input id={inputId} value={value} onChange={(e) => setDraft(e.target.value)} placeholder={DEFAULT_ACTOR} className="min-w-0 flex-1 basis-48" autoComplete="name" maxLength={60} />
          <Button type="submit" size="lg" disabled={!dirty}>
            Save
          </Button>
        </div>
        <p className="flex items-start gap-2 rounded-[16px] bg-well px-4 py-3 text-[13px] leading-5 text-muted-foreground">
          <UserRound aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
          <span>
            <span className="font-medium text-heading">No roles yet: anyone can approve.</span> Stage owners (Product Owner, Architect, Developer, QA) are labels only. The name is kept in this browser and sent with each request.
          </span>
        </p>
      </form>
    </SectionCard>
  );
}

function SpeedCard({ settings, pending }: { settings?: Settings; pending: boolean }) {
  const update = useUpdateSettings();
  const current = SPEEDS.find((s) => s.value === settings?.speed);
  return (
    <SectionCard title="Demo speed" description="How long each simulated agent step takes. Applies to every run, including ones already going." bodyClassName="flex flex-col gap-3">
      {!settings ? (
        <Skeleton className="h-12 rounded-[16px]" aria-hidden />
      ) : (
        <>
          <SegmentedControl
            aria-label="Demo speed"
            fullWidth
            itemClassName="px-2.5 sm:px-4"
            value={settings.speed}
            onValueChange={(speed) => {
              const s = SPEEDS.find((x) => x.value === speed);
              update.mutate({ speed }, { onSuccess: () => toast.success(`Demo speed: ${(s?.label ?? speed).toLowerCase()}`) });
            }}
            items={SPEEDS.map((s) => ({
              value: s.value,
              label: (
                <>
                  {s.label} <span className="hidden font-mono text-xs font-normal text-muted-foreground sm:inline">{s.factor}</span>
                </>
              ),
              ariaLabel: `${s.label} (${s.factor})`,
              title: s.line,
              disabled: pending || update.isPending,
            }))}
          />
          {current ? <p className="text-[13px] leading-5 text-muted-foreground">{current.line}</p> : null}
        </>
      )}
    </SectionCard>
  );
}

/**
 * Switching /api/weft to the daemon applies to the whole shared server, so it is confirmed first,
 * and only offered once the saved daemon URL answers.
 */
function SwitchToDaemonDialog({ open, onOpenChange, url, probe }: { open: boolean; onOpenChange: (o: boolean) => void; url: string; probe: ReturnType<typeof useDaemonProbe> }) {
  const update = useUpdateSettings();
  const result = probe.data;
  const reachable = !probe.isPending && result?.ok === true;
  const switchNow = () =>
    update.mutate(
      { dataSource: "weft" },
      {
        onSuccess: () => {
          onOpenChange(false);
          toast.success("Data source: weft daemon");
        },
      },
    );
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Switch /api/weft to the weft daemon?</AlertDialogTitle>
          <AlertDialogDescription>
            This applies to everyone using this demo server, not just you. Runs, pending requests and blobs then come from the daemon at <span className="font-mono">{url}</span>, while projects stay mocked and keep pointing at mock run ids the daemon does not know.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div role="status" aria-live="polite" className="flex items-start gap-2 rounded-[16px] bg-well px-4 py-3 text-sm">
          {probe.isPending || !result ? (
            <>
              <Spinner className="mt-0.5" />
              <span>Checking that the daemon answers at {url}…</span>
            </>
          ) : result.ok ? (
            <>
              <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-status-success-fg" />
              <span>The daemon answers{result.version ? ` (weft ${result.version})` : ""}.</span>
            </>
          ) : (
            <>
              <CircleX aria-hidden className="mt-0.5 size-4 shrink-0 text-status-danger-fg" />
              <span>
                {result.error ?? `No weft daemon answered at ${url}.`} Start the daemon or save another URL first; switching now would break every page that reads runs.
              </span>
            </>
          )}
        </div>
        {probe.error ? (
          <p role="alert" className="text-xs text-destructive">
            Could not check the daemon: {probe.error.message}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          {!probe.isPending && result && !result.ok ? (
            <Button variant="secondary" onClick={() => probe.mutate()}>
              Check again
            </Button>
          ) : null}
          <Button disabled={!reachable || update.isPending} onClick={switchNow}>
            {update.isPending ? "Switching…" : "Switch for everyone"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DataSourceCard({ settings }: { settings?: Settings }) {
  const update = useUpdateSettings();
  const [confirmDaemon, setConfirmDaemon] = useState(false);
  const probe = useDaemonProbe();
  const [url, setUrl] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const urlId = useId();
  const daemon = url ?? settings?.weftDaemon ?? "";
  const weft = settings?.dataSource === "weft";

  const saveUrl = () => {
    if (url === null) return;
    setUrlError(null);
    update.mutate(
      { weftDaemon: url.trim() },
      {
        onSuccess: (s) => {
          setUrl(null);
          toast.success(`Daemon URL set to ${s.weftDaemon}`);
        },
        onError: (e) => setUrlError(e.message),
      },
    );
  };

  return (
    <SectionCard title="Data source" description="Where the weft API (/api/weft) is served from.">
      {!settings ? (
        <div className="space-y-2" aria-hidden>
          <Skeleton className="h-44 rounded-[20px]" />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div role="radiogroup" aria-label="Data source" className="grid gap-1 rounded-[20px] bg-well p-1">
            <OptionCard
              checked={!weft}
              disabled={update.isPending}
              onSelect={() => weft && update.mutate({ dataSource: "mock" }, { onSuccess: () => toast.success("Data source: built-in mock") })}
              title="Mock (built in)"
              icon={<Database aria-hidden className="size-4 text-muted-foreground" strokeWidth={1.75} />}
              badge={<span className="text-xs text-muted-foreground">Default</span>}
            >
              A simulated weft engine inside this app runs all five workflows on timers. Nothing leaves this server.
            </OptionCard>
            <OptionCard
              checked={weft}
              disabled={update.isPending}
              onSelect={() => {
                if (weft) return;
                // Check the saved daemon URL each time the confirmation opens.
                probe.mutate();
                setConfirmDaemon(true);
              }}
              title="weft daemon"
              icon={<Server aria-hidden className="size-4 text-muted-foreground" strokeWidth={1.75} />}
            >
              Proxy /api/weft to a real daemon. Needs the daemon running, by default on 127.0.0.1:4781. Applies to everyone on this server; you confirm first.
            </OptionCard>
          </div>
          <SwitchToDaemonDialog open={confirmDaemon} onOpenChange={setConfirmDaemon} url={settings.weftDaemon} probe={probe} />
          <form
            className="space-y-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              saveUrl();
            }}
          >
            <label htmlFor={urlId} className="text-[13px] font-medium text-heading">
              Daemon URL
            </label>
            <div className="flex flex-wrap gap-2">
              <Input
                id={urlId}
                value={daemon}
                onChange={(e) => setUrl(e.target.value)}
                className="min-w-0 flex-1 basis-56 font-mono text-sm md:text-sm"
                inputMode="url"
                spellCheck={false}
                aria-invalid={urlError ? true : undefined}
                aria-describedby={urlError ? `${urlId}-err` : undefined}
              />
              <Button type="submit" variant="secondary" size="lg" disabled={url === null || url.trim() === settings.weftDaemon || update.isPending}>
                Save URL
              </Button>
            </div>
            {urlError ? (
              <p id={`${urlId}-err`} role="alert" className="text-xs text-destructive">
                {urlError}
              </p>
            ) : null}
          </form>
          {weft ? (
            <Alert className="border-status-attention-fg/30 bg-status-attention-bg text-status-attention-fg">
              <AlertTriangle aria-hidden />
              <AlertTitle>/api/weft now proxies to {settings.weftDaemon}</AlertTitle>
              <AlertDescription className="text-foreground/85">
                Projects, epics, tasks and evidence stay mocked in this app, so project pages keep pointing at mock run ids the daemon does not know. Runs, pending requests and blobs come from the daemon. Switch back to Mock for the full demo.
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}

function DemoToolsCard() {
  const reset = useResetDemo();
  const ff = useFastForward();
  return (
    <SectionCard title="Demo tools" description="These affect everyone using this demo server." bodyClassName="flex flex-col divide-y divide-rule">
      <div className="flex flex-col gap-3 pb-4">
        <div className="space-y-1">
          <h3 className="text-[15px] font-medium text-heading">Skip to the next human step</h3>
          <p className="text-[13px] leading-5 text-muted-foreground">
            Every running agent finishes its simulated work now and stops at its next question, review or approval. Runs already waiting on a person are left alone.
          </p>
        </div>
        <Button
          variant="secondary"
          className="self-start"
          disabled={ff.isPending}
          onClick={() => ff.mutate(undefined, { onSuccess: () => toast.success("Skipped ahead: running agents moved on to their next human step") })}
        >
          {ff.isPending ? <Spinner /> : <FastForward aria-hidden />}
          Skip ahead
        </Button>
      </div>
      <div className="flex flex-col gap-3 pt-4">
        <div className="space-y-1">
          <h3 className="text-[15px] font-medium text-heading">Reset demo data</h3>
          <p className="text-[13px] leading-5 text-muted-foreground">Puts the seven seeded projects back in their starting states and deletes projects created since. Open pages refresh on their own.</p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" className="self-start" disabled={reset.isPending}>
              {reset.isPending ? <Spinner /> : <RotateCcw aria-hidden />}
              Reset demo data
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset all demo data?</AlertDialogTitle>
              <AlertDialogDescription>
                Every project, run, answer and decision goes back to the seeded state, and projects created since are deleted. This affects everyone using this demo server and cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction className="bg-destructive bg-none text-white shadow-none hover:bg-destructive/90 dark:text-[#1a0b0b]" onClick={() => reset.mutate()}>
                Reset demo data
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </SectionCard>
  );
}

function AboutCard() {
  const workflows = useWorkflows();
  const meta = useMeta();
  const stageOf = (name: string) => STAGES.find((s) => s.workflows.includes(name));
  return (
    <SectionCard
      title="Workflows"
      description="Requirements and Architecture run the real po-workspace weft workflows (scripted here). Implementation and QA are mocked in the same shape, so real workflows can replace them later."
      flush
    >
      {workflows.isPending ? (
        <div className="space-y-2 border-t border-rule px-5 py-4 sm:px-7" aria-busy="true" aria-label="Loading workflows">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-10 rounded-lg" />
          ))}
        </div>
      ) : workflows.error ? (
        <div className="border-t border-rule">
          <ErrorState title="Could not load workflows" error={workflows.error} onRetry={() => void workflows.refetch()} size="sm" />
        </div>
      ) : (
        <ul className="divide-y divide-rule border-t border-rule">
          {(workflows.data ?? []).map((w) => {
            const real = REAL_WORKFLOWS.has(w.name);
            const stage = stageOf(w.name);
            return (
              <li key={w.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-start sm:gap-5 sm:px-7">
                <div className="flex shrink-0 flex-col items-start gap-1 sm:w-40">
                  <span className="font-mono text-sm text-heading">{w.name}</span>
                  {stage ? (
                    <span className="text-xs text-muted-foreground">
                      Stage {stage.n} · {stage.title}
                    </span>
                  ) : null}
                  <StatusPill tone={real ? "success" : "neutral"} icon={real ? Check : null} label={real ? "Real weft workflow" : "Mocked (spec)"} size="sm" className="mt-0.5" />
                </div>
                <p className="min-w-0 flex-1 text-[13px] leading-5 text-muted-foreground">{w.description}</p>
              </li>
            );
          })}
          <li className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-start sm:gap-5 sm:px-7">
            <div className="flex shrink-0 flex-col gap-1 sm:w-40">
              <span className="text-sm text-heading">PO Review</span>
              <span className="text-xs text-muted-foreground">Stage 5</span>
            </div>
            <p className="min-w-0 flex-1 text-[13px] leading-5 text-muted-foreground">No workflow: the Product Owner reviews the certified work and signs off in the app.</p>
          </li>
        </ul>
      )}
      {meta.data ? (
        <p className="border-t border-rule px-5 py-4 font-mono text-xs text-muted-foreground sm:px-7">
          weft {meta.data.version} · repo {meta.data.repo.name} · {meta.data.defaults.provider}
          {meta.data.defaults.model ? ` / ${meta.data.defaults.model}` : ""}
        </p>
      ) : null}
    </SectionCard>
  );
}

export function SettingsView() {
  const settings = useSettings();
  return (
    <div className="@container flex min-w-0 flex-col gap-6">
      <PageHeader title="Settings" description="This app runs on a mock of the weft daemon. These settings shape the demo; nothing here touches Jira, Confluence or a real repository." />
      {settings.error && !settings.data ? (
        <SectionCard>
          <ErrorState title="Could not load settings" error={settings.error} onRetry={() => void settings.refetch()} />
        </SectionCard>
      ) : null}
      <div className="grid min-w-0 items-start gap-4 @5xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <ActingAsCard />
          <SpeedCard settings={settings.data} pending={settings.isPending} />
          <DemoToolsCard />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <DataSourceCard settings={settings.data} />
          <AboutCard />
        </div>
      </div>
    </div>
  );
}
