"use client";

import { useCallback } from "react";

/** Children that mark the selected item of a segmented control or tab list. */
const SELECTED = '[data-state="on"],[data-state="active"],[aria-selected="true"],[aria-checked="true"]';
/** The longest edge fade, in px. */
const FADE = 24;
/** How far a revealed item stays from the edge, clear of the fade. */
const EDGE = FADE + 4;

/**
 * Scroll `item` horizontally inside `scroller` until it is fully visible (clear of the edge fade).
 * Only the scroller moves, never the page, unlike scrollIntoView.
 */
export function revealInScroller(scroller: HTMLElement, item: HTMLElement | null | undefined) {
  if (!item || scroller.scrollWidth <= scroller.clientWidth) return;
  const box = scroller.getBoundingClientRect();
  const r = item.getBoundingClientRect();
  if (r.left < box.left + EDGE) scroller.scrollLeft -= box.left + EDGE - r.left;
  else if (r.right > box.right - EDGE) scroller.scrollLeft += r.right - (box.right - EDGE);
}

/**
 * For a one-row horizontal scroller that never wraps (segmented controls, tab lists). Returns a
 * callback ref that keeps `data-overflow` on the element while content is hidden past an edge
 * ("end", "start" or "both", removed when everything fits) and sets `--fade-start` /
 * `--fade-end` to the length of each edge fade (0-24px, the amount hidden). The `row-scroll-x`
 * utility in globals.css draws the fades. The selected child is scrolled into view on mount, and
 * any child that takes focus (keyboard or click) is scrolled clear of the fade.
 */
export function useScrollFade<T extends HTMLElement = HTMLElement>() {
  return useCallback((el: T | null) => {
    if (!el) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const max = el.scrollWidth - el.clientWidth;
        const hiddenStart = max > 1 ? Math.max(0, el.scrollLeft) : 0;
        const hiddenEnd = max > 1 ? Math.max(0, max - el.scrollLeft) : 0;
        const start = hiddenStart > 1;
        const end = hiddenEnd > 1;
        const next = start && end ? "both" : start ? "start" : end ? "end" : "";
        // Each fade is as long as what is hidden past that edge, up to FADE: a track that is
        // 4px too wide gets a 4px fade, not one that dims a whole segment.
        el.style.setProperty("--fade-start", `${start ? Math.min(FADE, Math.round(hiddenStart)) : 0}px`);
        el.style.setProperty("--fade-end", `${end ? Math.min(FADE, Math.round(hiddenEnd)) : 0}px`);
        if (next) el.dataset.overflow = next;
        else delete el.dataset.overflow;
      });
    };
    const resize = new ResizeObserver(update);
    const observeChildren = () => {
      resize.disconnect();
      resize.observe(el);
      for (const child of Array.from(el.children)) resize.observe(child);
    };
    const mutations = new MutationObserver(() => {
      observeChildren();
      update();
    });
    observeChildren();
    mutations.observe(el, { childList: true, subtree: true, characterData: true });
    // Keep a focused (or clicked) item clear of the edge fade: browsers only scroll it partly into view.
    const reveal = (e: FocusEvent) => {
      let item = e.target instanceof HTMLElement ? e.target : null;
      while (item && item.parentElement !== el) item = item.parentElement;
      revealInScroller(el, item);
    };
    el.addEventListener("scroll", update, { passive: true });
    el.addEventListener("focusin", reveal);
    revealInScroller(el, el.querySelector<HTMLElement>(SELECTED));
    update();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      el.removeEventListener("scroll", update);
      el.removeEventListener("focusin", reveal);
      el.style.removeProperty("--fade-start");
      el.style.removeProperty("--fade-end");
      delete el.dataset.overflow;
    };
  }, []);
}
