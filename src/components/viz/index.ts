/**
 * Data-viz primitives in the reference's style (docs/design/STYLE.md 5). Client components, no
 * chart library: CSS and inline SVG, light and dark.
 *
 * - `FunnelColumns`: the Payments funnel. Props: `columns` ({ key, label, value, display, hint? }),
 *   `activeKey` / `defaultActiveKey` / `onActiveChange`, `onSelect`, `tooltip(col, i)` returning
 *   glass-tooltip segments ({ value, label?, labelFirst? }), `height` (bar area, default 200),
 *   `max`, `axis` ({ value, label }[]), `ariaLabel`. A radio group: hover, focus or arrows make a
 *   column active; click, Enter or Space call `onSelect`.
 * - `StepAreaChart`: the Retention chart. Props: `data` ({ label, value }[]), `highlightIndex`,
 *   `chipLabel`, `xLabels`, `height` (default 240), `formatValue`, `ariaLabel`.
 * - `DotMatrix`: the Transactions / Customers dots. Props: `columns` (counts), `labels`,
 *   `peakLabel` (default "Peak"), `tone` ("green" | "blue"), `maxRows` (default 4), `dotsPerRow`
 *   (1 | 2, default 2), `unit`, `ariaLabel`.
 * - `MeshInsightCard`: the Insights card. Props: `items` ({ value, title, body?, href? }[]),
 *   `intervalMs` (default 7000), `chipLabel` (default "Insights").
 * - `PromptBand`: the frosted prompt band. Props: `title`, `placeholder`, `suggestions`
 *   ({ token, label, href? }[]), `onSubmit(text)`, `defaultCollapsed`. On Home, pass
 *   `onSubmit={(t) => openCommandPalette(t)}` from `@/components/shell`.
 */
export { DotMatrix, type DotMatrixProps } from "./dot-matrix";
export { FunnelColumns, type FunnelColumn, type FunnelColumnsProps } from "./funnel-columns";
export { MeshInsightCard, type InsightItem, type MeshInsightCardProps } from "./mesh-insight-card";
export { PromptBand, type PromptBandProps, type PromptSuggestion } from "./prompt-band";
export { StepAreaChart, type StepAreaChartProps } from "./step-area-chart";
export { type GlassItem } from "./chips";
export { useElementSize, type ElementSize } from "./use-element-size";
