"use client";

import { useEffect, useState } from "react";

export interface ElementSize {
  width: number;
  height: number;
}

/**
 * Content-box size of an element, kept current with a ResizeObserver. Returns a callback ref and
 * the size (0 x 0 until the first measurement, including during SSR).
 */
export function useElementSize<T extends Element>(): [(el: T | null) => void, ElementSize] {
  const [el, setEl] = useState<T | null>(null);
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      const width = Math.round(box.width * 100) / 100;
      const height = Math.round(box.height * 100) / 100;
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, size];
}
