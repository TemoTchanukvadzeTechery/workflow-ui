import "server-only";
/**
 * A run's journal: append-only, like weft's .weft/runs/<id>/journal.jsonl. Records are numbered
 * from 0 (the number is also the SSE `id:`) and stamped by the demo clock, so every read model
 * (reduce, tree, report, pending) is a fold over this list and nothing else.
 */
import type { JournalEvent, JournalRecord } from "@/lib/weft/types";

export function appendRecord(records: JournalRecord[], ev: JournalEvent, at: number): JournalRecord {
  const record: JournalRecord = { i: records.length, at, ev };
  records.push(record);
  return record;
}

/** Records from index `from` on; a negative `from` reads from the start. */
export function readFrom(records: readonly JournalRecord[], from = 0): JournalRecord[] {
  return records.slice(Math.max(0, from));
}
