import "server-only";
/**
 * Registry of mock workflows served by the mock daemon (GET /api/weft/workflows). po-brd and
 * architect-aad mirror po-workspace/.weft/workflows; dev-plan, dev-task and qa-verify are SPEC.
 */
import type { MockWorkflow } from "../engine/api";
import { architectAad } from "./architect-aad";
import { devPlan } from "./dev-plan";
import { devTask } from "./dev-task";
import { poBrd } from "./po-brd";
import { qaVerify } from "./qa-verify";

export const MOCK_WORKFLOWS: MockWorkflow[] = [poBrd, architectAad, devPlan, devTask, qaVerify] as MockWorkflow[];
