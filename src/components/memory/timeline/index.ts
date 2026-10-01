/**
 * The vault timeline (plan §4): the Timeline tab on /memory, the note page's History card and the
 * diff drawer both share. Client components, plus the pure headline helpers.
 */
export { ChangeChips, ClaimChips, type ChangeChipsProps, type ClaimChipsProps } from "./change-chips";
export { CLAIM_CHANGE_META, CommitDiffSheet, type CommitDiffSheetProps, type CommitDiffTarget } from "./commit-diff-sheet";
export {
  ALL_FILES_MAX_LINES,
  blocksRuns,
  defaultDiffFile,
  eventHeadline,
  FILE_STATUS_META,
  fileCount,
  noteChangeCount,
  timelineNodeKind,
  vaultLabel,
  type FileStatusMeta,
  type TimelineNodeKind,
} from "./event-headline";
export { NoteHistoryCard, type NoteHistoryCardProps } from "./note-history-card";
export { MemoryTimelinePanel } from "./timeline-panel";
export { EventFileList, FileStatusGlyph, resolveNote, TimelineRail, type TimelineRailProps, type ViewDiff } from "./timeline-rail";
export { UncommittedBand, type UncommittedBandProps } from "./uncommitted-band";
