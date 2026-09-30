import "server-only";
/**
 * The real po-brd (0035d37f) and architect-aad (f442e3a3) run records, reduced to what the mock
 * replays: each planner round's queries and relevant list, the round-1 draft report, and the
 * memory change list. Extracted verbatim from po-workspace/.weft/runs/<id>/state.json.
 */
import type { AadReport, DraftReport } from "@/lib/delivery/types";
import { contentJson } from "./files";

export interface FixtureDep {
  ref: string;
  kind: "jira" | "confluence";
  title: string;
  relation: string;
  why: string;
}

export interface FixtureRound {
  queries: Array<{ purpose: string; args: string[] }>;
  relevant: FixtureDep[];
  done: boolean;
}

interface FixtureRun<R> {
  runId: string;
  input: Record<string, unknown>;
  rounds: FixtureRound[];
  report: R;
  memoryChanges: string[];
}

export interface AgrFixture {
  brd: FixtureRun<DraftReport>;
  aad: FixtureRun<AadReport>;
}

let fixture: AgrFixture | undefined;

export function agrFixture(): AgrFixture {
  fixture ??= contentJson<AgrFixture>("agr-fixture.json");
  return fixture;
}

/** The real requests, for seeding the AGR project exactly as it was run. */
export function agrRequests(): { brd: string; aad: string } {
  const fx = agrFixture();
  return { brd: String(fx.brd.input.request ?? ""), aad: String(fx.aad.input.request ?? "") };
}
