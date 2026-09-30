/**
 * In-page jumps inside a rendered BRD/AAD: a citation chip scrolls to its row in the Sources
 * table, and a "[B1 §Requirements 3]" trace scrolls to that section (and list item) of the BRD.
 */

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** A short cobalt highlight on the target (a steady outline when motion is reduced). */
function flash(el: Element) {
  const html = el as HTMLElement;
  if (reducedMotion() || typeof html.animate !== "function") {
    const prev = html.style.outline;
    html.style.outline = "2px solid var(--ring)";
    window.setTimeout(() => (html.style.outline = prev), 1800);
    return;
  }
  html.animate(
    [
      { backgroundColor: "var(--primary-soft)", boxShadow: "0 0 0 2px var(--ring)" },
      { backgroundColor: "var(--primary-soft)", boxShadow: "0 0 0 2px var(--ring)", offset: 0.6 },
      { backgroundColor: "transparent", boxShadow: "0 0 0 0 transparent" },
    ],
    { duration: 2000, easing: "ease-out" },
  );
}

function scrollTo(el: Element) {
  el.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" });
  flash(el);
}

/** Scroll to the Sources row for "R2" / "N1" (first cell), else to the Sources heading. */
export function jumpToSource(root: HTMLElement | null, source: string): boolean {
  if (!root) return false;
  const want = source.trim().toUpperCase();
  const rows = Array.from(root.querySelectorAll("tr"));
  const row = rows.find((tr) => (tr.querySelector("td")?.textContent ?? "").trim().toUpperCase() === want);
  if (row) {
    scrollTo(row);
    return true;
  }
  const headings = Array.from(root.querySelectorAll("h2, h3"));
  const heading = [...headings].reverse().find((h) => /sources/i.test(h.textContent ?? ""));
  if (heading) {
    scrollTo(heading);
    return true;
  }
  return false;
}

/**
 * Scroll to a section by its heading text ("Requirements"), optionally to its list item numbered
 * `item`, e.g. BRD requirement 7. A section can hold several lists (the BRD's candidate
 * requirements are a second `<ol start="7">`), so the item is looked up in the list whose number
 * range covers it: an `<ol>` counts from its `start`, a `<ul>` continues from the list before it.
 */
export function jumpToSection(root: HTMLElement | null, section: string, item?: number): boolean {
  if (!root) return false;
  const want = section.trim().toLowerCase();
  const headings = Array.from(root.querySelectorAll("h1, h2, h3, h4"));
  const heading = headings.find((h) => (h.textContent ?? "").trim().toLowerCase() === want) ?? headings.find((h) => (h.textContent ?? "").toLowerCase().includes(want));
  if (!heading) return false;
  if (item !== undefined) {
    let el: Element | null = heading.nextElementSibling;
    let next = 1;
    while (el && !/^H[1-3]$/.test(el.tagName)) {
      if (el.tagName === "OL" || el.tagName === "UL") {
        const attr = el.tagName === "OL" ? Number.parseInt(el.getAttribute("start") ?? "", 10) : Number.NaN;
        const start = Number.isFinite(attr) ? attr : el.tagName === "OL" ? 1 : next;
        const items = Array.from(el.children).filter((c) => c.tagName === "LI");
        const li = item >= start ? items[item - start] : undefined;
        if (li) {
          scrollTo(li);
          return true;
        }
        next = start + items.length;
      }
      el = el.nextElementSibling;
    }
  }
  scrollTo(heading);
  return true;
}

/** After answering a request the page's next state is at the top: bring the sub-step pills back into view. */
export function scrollToStageTop(): void {
  if (typeof window === "undefined") return;
  const nav = document.querySelector('nav[aria-label="Stage steps"]');
  if (!nav) return;
  const top = nav.getBoundingClientRect().top;
  if (top >= 0) return;
  window.scrollTo({ top: Math.max(0, window.scrollY + top - 72), behavior: reducedMotion() ? "auto" : "smooth" });
}
