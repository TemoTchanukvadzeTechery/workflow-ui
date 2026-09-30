"use client";

/**
 * URL state shared by the stage workspaces (SPEC 5.1): `?step=<sub-step>` selects the pill tab and
 * `?request=<runId>:<hId>` focuses one human request (inbox "Answer" links and notify toasts use
 * it). useSearchParams needs a <Suspense> boundary; the [stage] page already provides one.
 */
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

export interface RequestFocus {
  runId: string;
  /** Human request id within the run, e.g. "h3". */
  requestId: string;
}

/** Parse "0035d37f:h3". Returns null for anything else. */
export function parseRequestParam(value: string | null | undefined): RequestFocus | null {
  if (!value) return null;
  const i = value.indexOf(":");
  if (i <= 0 || i === value.length - 1) return null;
  return { runId: value.slice(0, i), requestId: value.slice(i + 1) };
}

/** Link to a stage workspace, optionally focused on a request and/or a sub-step. */
export function stageHref(projectId: string, stage: string, opts: { step?: string; request?: RequestFocus } = {}): string {
  const sp = new URLSearchParams();
  if (opts.step) sp.set("step", opts.step);
  if (opts.request) sp.set("request", `${opts.request.runId}:${opts.request.requestId}`);
  const q = sp.toString();
  return `/projects/${encodeURIComponent(projectId)}/${stage}${q ? `?${q}` : ""}`;
}

export function useStageParams(): {
  step: string | null;
  setStep: (step: string | null) => void;
  request: RequestFocus | null;
  clearRequest: () => void;
} {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const step = params.get("step");
  const requestRaw = params.get("request");
  const request = useMemo(() => parseRequestParam(requestRaw), [requestRaw]);

  const update = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value === null) next.delete(key);
      else next.set(key, value);
      const q = next.toString();
      // replace, not push: tab switches should not pile up in history.
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const setStep = useCallback((s: string | null) => update("step", s), [update]);
  const clearRequest = useCallback(() => update("request", null), [update]);

  return { step, setStep, request, clearRequest };
}
