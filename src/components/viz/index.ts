/**
 * Data-viz primitives in the reference's style (docs/design/STYLE.md 5). Client components, no
 * chart library: CSS and inline SVG, light and dark.
 *
 * - `FunnelColumns`: the Payments funnel. Props: `columns` ({ key, label, value, display, hint? }),
 *   `activeKey` / `defaultActiveKey` / `onActiveChange`, `onSelect`, `tooltip(col, i)` returning
 *   GlassTooltipItem[] from common ({ label, value, valueFirst? }), `height` (bar area, default 200;
 *   the least height with `fill`), `fill` (stretch the bar area to the parent's height, measured),
 *   `max`, `baseline` (default 0), `axis` ({ value, label }[]), `ariaLabel`. A radio group: hover,
 *   focus or arrows make a column active; click, Enter or Space call `onSelect`.
 * - `StepAreaChart`: the Retention chart. Props: `data` ({ label, value }[]), `highlightIndex`,
 *   `chipLabel`, `xLabels`, `height` (default 240), `formatValue`, `ariaLabel`.
 * - `DotMatrix`: the Transactions / Customers dots. Props: `columns` (counts), `labels`,
 *   `peakLabel` (default "Peak"), `tone` ("green" | "blue"), `maxRows` (peak height in rows,
 *   default 5; the rest scale to it), `dotsPerRow` (1 | 2, default 2), `dotSize` (default 11),
 *   `unit`, `ariaLabel`.
 * - `MeshInsightCard`: the Insights card. Props: `items` ({ value, title, body?, href? }[]),
 *   `intervalMs` (default 7000), `chipLabel` (default "Insights").
 * - `MeshBackdrop`: that card's backdrop alone (mesh, glass chevron, scrim, grain, dark dimmer) for
 *   other loud cards. Props: `glass` (default true), `className`. Parent: `relative isolate
 *   overflow-hidden` plus its radius.
 * - `PromptBand`: the frosted prompt band. Props: `title`, `placeholder`, `compactPlaceholder`
 *   (default "Search or type a command", used when `placeholder` does not fit), `suggestions`
 *   ({ token, label, href? }[]; chips move to their own scrolling row when the band is narrow),
 *   `onSubmit(text)`, `defaultCollapsed`, `className`. On Home, pass
 *   `onSubmit={(t) => openCommandPalette(t)}` from `@/components/shell`.
 */
export { DotMatrix, type DotMatrixProps } from "./dot-matrix";
export { FunnelColumns, type FunnelColumn, type FunnelColumnsProps } from "./funnel-columns";
export { MeshBackdrop, MeshInsightCard, type InsightItem, type MeshBackdropProps, type MeshInsightCardProps } from "./mesh-insight-card";
export { PromptBand, type PromptBandProps, type PromptSuggestion } from "./prompt-band";
export { StepAreaChart, type StepAreaChartProps } from "./step-area-chart";
export { useElementSize, type ElementSize } from "./use-element-size";
