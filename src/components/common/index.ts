/**
 * Shared presentational building blocks (owner A), styled after docs/design/STYLE.md. Most are
 * server-compatible; RelativeTime, Elapsed, IdChip, JsonView, HealthPill and SegmentedControl
 * are client components.
 */
export { ActorLabel, InitialsAvatar, actorText, type ActorLabelProps, type InitialsAvatarProps } from "./actor-label";
export { CircleIconButton, type CircleIconButtonProps } from "./circle-icon-button";
export { EmptyState, type EmptyStateProps } from "./empty-state";
export { ErrorState, type ErrorStateProps } from "./error-state";
export { FactCell, FactStrip, type FactCellProps, type FactStripProps } from "./fact-cell";
export { DeltaTriangle, FloatingChip, type DeltaTriangleProps, type FloatingChipProps } from "./floating-chip";
export { GlassTooltip, type GlassTooltipItem, type GlassTooltipProps } from "./glass-tooltip";
export { HealthPill, healthReasonText, type HealthPillProps } from "./health-pill";
export { IdChip, type IdChipProps } from "./id-chip";
export { JsonView, type JsonViewProps } from "./json-view";
export { Kicker, type KickerProps } from "./kicker";
export { KpiTile, type KpiDelta, type KpiTileProps } from "./kpi-tile";
export { Duration, Money, Tokens, type DurationProps, type MoneyProps, type TokensProps } from "./numbers";
export { PageHeader, type PageHeaderProps } from "./page-header";
export { Elapsed, RelativeTime, type ElapsedProps, type RelativeTimeProps } from "./relative-time";
export { SectionCard, type SectionCardProps } from "./section-card";
export { HatchedBar, SegmentBar, stageSegment, stageSegments, type HatchedBarProps, type Segment, type SegmentBarProps, type SegmentState } from "./segment-bar";
export { SegmentedControl, type SegmentedControlProps, type SegmentedItem } from "./segmented-control";
export { CardSkeleton, PageSkeleton } from "./skeletons";
export { STAGE_ICONS, STAGE_ICON_BY_NAME, StageIcon, type StageIconProps } from "./stage-icon";
export { CountBadge, StatusDot, StatusPill, type CountBadgeProps, type StatusDotProps, type StatusPillProps } from "./status";
export { StripedBar, type StripedBarProps } from "./striped-bar";
export { TokenChip, type TokenChipProps } from "./token-chip";
export { revealInScroller, useScrollFade } from "./use-scroll-fade";
export { TONE_CLASSES, toneClasses, type ToneClasses } from "./tone";
export { ToolbarButton, ToolbarGroup, ToolbarText, type ToolbarButtonProps, type ToolbarGroupProps, type ToolbarTextProps } from "./toolbar";
