"use client";

/**
 * One EventSource on /api/events for the whole app. Each LiveEvent invalidates the matching
 * queries (debounced), so every screen stays live without polling; "notify" events become toasts.
 * A notify for what the page already shows is dropped, and a burst (Run QA agents on 9 tasks) is
 * batched into one toast ("9 QA reviews waiting"). Mount useLiveUpdates() once, in providers.tsx.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { LiveEvent } from "@/lib/delivery/types";

type Conn = "connecting" | "open" | "closed";
type NotifyEvent = Extract<LiveEvent, { type: "notify" }>;

/** A burst is flushed this long after its last notify, and at most this long after its first. */
const NOTIFY_QUIET_MS = 800;
const NOTIFY_MAX_WAIT_MS = 2_000;

/** What a paused run of each workflow waits for, as a plural noun for batched toasts. */
const REQUEST_NOUN: Record<string, string> = {
  "qa-verify": "QA reviews",
  "dev-task": "task reviews",
  "dev-plan": "plan reviews",
  "po-brd": "po-brd requests",
  "architect-aad": "architect-aad requests",
};

/** "qa-verify needs your input" → "qa-verify"; "T-4 ready for review" (dev-task) → "dev-task". */
function waitingWorkflow(title: string): string | undefined {
  const m = /^(\S+) needs your input$/.exec(title);
  if (m) return m[1];
  return / ready for review$/.test(title) ? "dev-task" : undefined;
}

/**
 * Whether the current page already shows what a notify points at: the same path with every
 * query param of the href (so /qa matches /qa?step=tasks), or the request card itself is on the
 * page (HumanRequestCard's id is request-<runId>-<hId>).
 */
function pageShows(href: string | undefined): boolean {
  if (!href || typeof window === "undefined") return false;
  let target: URL;
  try {
    target = new URL(href, window.location.href);
  } catch {
    return false;
  }
  if (target.origin !== window.location.origin || target.pathname !== window.location.pathname) return false;
  const request = target.searchParams.get("request");
  const i = request ? request.indexOf(":") : -1;
  if (request && i > 0 && document.getElementById(`request-${request.slice(0, i)}-${request.slice(i + 1)}`)) return true;
  const current = new URLSearchParams(window.location.search);
  return [...target.searchParams].every(([k, v]) => current.get(k) === v);
}

/** One toast per notify, or per group of a burst: requests waiting, runs failed, other updates. */
export function batchNotifications(events: NotifyEvent[]): NotifyEvent[] {
  if (events.length <= 1) return events;
  const groups = new Map<string, NotifyEvent[]>();
  for (const e of events) {
    const kind = e.level === "attention" && waitingWorkflow(e.title) ? "waiting" : e.level;
    groups.set(kind, [...(groups.get(kind) ?? []), e]);
  }
  return [...groups.entries()].map(([kind, list]) => {
    if (list.length === 1) return list[0];
    const n = list.length;
    const workflows = new Set(list.map((e) => waitingWorkflow(e.title)));
    const only = workflows.size === 1 ? [...workflows][0] : undefined;
    const title =
      kind === "waiting"
        ? `${n} ${only ? (REQUEST_NOUN[only] ?? `${only} requests`) : "requests"} waiting`
        : kind === "error"
          ? `${n} runs failed`
          : kind === "success"
            ? `${n} runs finished`
            : `${n} updates`;
    const hrefs = new Set(list.map((e) => e.href));
    const href = hrefs.size === 1 ? list[0].href : kind === "waiting" ? "/inbox" : kind === "error" ? "/runs?status=failed" : undefined;
    const bodies = list.map((e) => (kind === "waiting" ? (e.body ?? e.title) : e.title));
    const body = `${bodies.slice(0, 2).join(" · ")}${n > 2 ? ` · +${n - 2} more` : ""}`;
    const projects = new Set(list.map((e) => e.projectId));
    return { type: "notify", level: list[0].level, title, body, ...(href ? { href } : {}), ...(projects.size === 1 && list[0].projectId ? { projectId: list[0].projectId } : {}) };
  });
}
let connState: Conn = "connecting";
const connListeners = new Set<() => void>();
function setConn(s: Conn) {
  connState = s;
  for (const l of connListeners) l();
}

/** "open" while the SSE stream is connected; the top bar shows a live dot. */
export function useLiveConnection(): Conn {
  return useSyncExternalStore(
    (l) => {
      connListeners.add(l);
      return () => connListeners.delete(l);
    },
    () => connState,
    () => "connecting" as Conn,
  );
}

export function useLiveUpdates(onNotify?: (e: NotifyEvent) => void) {
  const qc = useQueryClient();
  const pending = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notifyRef = useRef(onNotify);
  const burst = useRef<{ events: NotifyEvent[]; first: number; timer: ReturnType<typeof setTimeout> | null }>({ events: [], first: 0, timer: null });
  useEffect(() => {
    notifyRef.current = onNotify;
  }, [onNotify]);

  useEffect(() => {
    const flush = () => {
      timer.current = null;
      const keys = [...pending.current];
      pending.current.clear();
      for (const k of keys) {
        const key = JSON.parse(k) as unknown[];
        void qc.invalidateQueries({ queryKey: key });
      }
    };
    const queue = (...keys: unknown[][]) => {
      for (const k of keys) pending.current.add(JSON.stringify(k));
      if (!timer.current) timer.current = setTimeout(flush, 150);
    };

    const flushNotify = () => {
      const b = burst.current;
      b.timer = null;
      // Re-check at flush time: the invalidations above may have rendered the request by now.
      const events = b.events.filter((e) => !pageShows(e.href));
      b.events = [];
      for (const e of batchNotifications(events)) {
        if (notifyRef.current) notifyRef.current(e);
        else defaultNotify(e);
      }
    };
    const notify = (ev: NotifyEvent) => {
      if (pageShows(ev.href)) return;
      const b = burst.current;
      const now = Date.now();
      if (b.events.length === 0) b.first = now;
      b.events.push(ev);
      if (b.timer) clearTimeout(b.timer);
      b.timer = setTimeout(flushNotify, Math.max(0, Math.min(NOTIFY_QUIET_MS, b.first + NOTIFY_MAX_WAIT_MS - now)));
    };

    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      setConn("connecting");
      es = new EventSource("/api/events");
      es.onopen = () => setConn("open");
      es.onerror = () => {
        setConn("closed");
        es?.close();
        if (!closed) retry = setTimeout(connect, 2_000);
      };
      es.addEventListener("change", (msg) => {
        let ev: LiveEvent;
        try {
          ev = JSON.parse((msg as MessageEvent<string>).data) as LiveEvent;
        } catch {
          return;
        }
        switch (ev.type) {
          case "run":
            queue(["weft", "run", ev.runId], ["weft", "runs"], ["weft", "pending"], ["inbox"], ["dashboard"], ["projects"]);
            if (ev.projectId) queue(["project", ev.projectId], ["activity"]);
            break;
          case "project":
            queue(["project", ev.projectId], ["projects"], ["dashboard"], ["inbox"], ["activity"], ["doc", ev.projectId]);
            break;
          case "inbox":
            queue(["inbox"], ["dashboard"], ["weft", "pending"]);
            break;
          case "settings":
            queue(["settings"]);
            break;
          case "reset":
            void qc.invalidateQueries();
            break;
          case "notify":
            notify(ev);
            break;
        }
      });
    };
    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      if (timer.current) clearTimeout(timer.current);
      if (burst.current.timer) clearTimeout(burst.current.timer);
      burst.current = { events: [], first: 0, timer: null };
      es?.close();
      setConn("closed");
    };
  }, [qc]);
}

function defaultNotify(ev: NotifyEvent) {
  const opts = { description: ev.body };
  if (ev.level === "error") toast.error(ev.title, opts);
  else if (ev.level === "success") toast.success(ev.title, opts);
  else if (ev.level === "attention") toast.warning(ev.title, opts);
  else toast.info(ev.title, opts);
}
