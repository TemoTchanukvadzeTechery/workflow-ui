import "server-only";
/**
 * The process-wide mock backend: engine + delivery store + orchestrator + live bus + settings.
 * Kept on globalThis.__workflowUi so dev-server HMR does not wipe the demo state. Seeding starts
 * on first access; `ready` resolves when it is done (errors become FYI notices, never crashes).
 */
import type { DemoSpeed, Settings } from "@/lib/delivery/types";
import { INITIAL_WORKSPACE } from "@/server/mock/content";
import { createMockEngine } from "@/server/mock/engine";
import type { MockEngine } from "@/server/mock/engine/api";
import { MOCK_WORKFLOWS } from "@/server/mock/workflows";
import { createBus, type Bus } from "./bus";
import { Orchestrator } from "./delivery/orchestrator";
import { seedDemo } from "./delivery/seed";
import { DeliveryStore } from "./delivery/store";
import { bad, errorMessage } from "./delivery/util";

export interface Runtime {
  engine: MockEngine;
  store: DeliveryStore;
  bus: Bus;
  orchestrator: Orchestrator;
  settings(): Settings;
  updateSettings(patch: Partial<Settings>): Settings;
  /** Resolves when the current seeding pass is done. Replaced on reset(). */
  ready: Promise<void>;
  /**
   * Stop every run and replace this runtime with a fresh one built from the current code, then
   * reseed. Settings and the live bus carry over, so open tabs stay connected. Rebuilding (rather
   * than clearing in place) lets a running dev server pick up server-side edits on Reset.
   */
  reset(): Promise<void>;
}

const SPEEDS: readonly DemoSpeed[] = ["instant", "fast", "realistic"];

function defaultSettings(): Settings {
  return { speed: "fast", dataSource: "mock", weftDaemon: process.env.WEFT_DAEMON ?? "http://127.0.0.1:4781" };
}

function createRuntime(carry: { settings?: Settings; bus?: Bus } = {}): Runtime {
  let settings = carry.settings ?? defaultSettings();
  const bus = carry.bus ?? createBus();
  const engine = createMockEngine({ workflows: MOCK_WORKFLOWS, speed: () => settings.speed, initialFiles: INITIAL_WORKSPACE });
  const store = new DeliveryStore({ weft: engine, fs: engine.fs, putBlob: (text) => engine.putBlob(text), now: () => engine.now() }, bus);
  const orchestrator = new Orchestrator(store);
  orchestrator.start();

  const seed = async () => {
    store.seeding = true;
    try {
      await seedDemo({ engine, store, orchestrator });
    } catch (err) {
      console.error("[runtime] seeding failed:", err);
      store.addNotice("", "requirements", `Seeding the demo projects failed: ${errorMessage(err)}`);
    } finally {
      store.seeding = false;
      bus.publish({ type: "reset" });
    }
  };

  const rt: Runtime = {
    engine,
    store,
    bus,
    orchestrator,
    settings: () => ({ ...settings }),
    updateSettings(patch) {
      const next = { ...settings };
      if (patch && typeof patch === "object") {
        if (patch.speed !== undefined) {
          if (!SPEEDS.includes(patch.speed)) throw bad("speed must be instant, fast or realistic.");
          next.speed = patch.speed;
        }
        if (patch.dataSource !== undefined) {
          if (patch.dataSource !== "mock" && patch.dataSource !== "weft") throw bad("dataSource must be mock or weft.");
          next.dataSource = patch.dataSource;
        }
        if (patch.weftDaemon !== undefined) {
          if (typeof patch.weftDaemon !== "string" || !/^https?:\/\/\S+$/.test(patch.weftDaemon.trim())) throw bad("weftDaemon must be an http(s) URL.");
          next.weftDaemon = patch.weftDaemon.trim().replace(/\/+$/, "");
        }
      }
      settings = next;
      bus.publish({ type: "settings" });
      return { ...settings };
    },
    ready: Promise.resolve(),
    reset: () => resetRuntime(),
  };
  rt.ready = seed();
  return rt;
}

const g = globalThis as unknown as { __workflowUi?: Runtime; __workflowUiReset?: Promise<void> };

/** See Runtime.reset. Concurrent resets (two tabs clicking Reset) share one pass. */
export function resetRuntime(): Promise<void> {
  g.__workflowUiReset ??= (async () => {
    const old = g.__workflowUi;
    if (old) {
      await old.ready.catch(() => undefined);
      // Unsubscribe first so the cancellations journaled by fencing the old runs never reach a
      // store, then let those records flush before the old runtime is dropped.
      old.orchestrator.stop();
      old.engine.reset();
      await new Promise((resolve) => setTimeout(resolve, 20));
      await old.orchestrator.drain();
    }
    const rt = createRuntime({ settings: old?.settings(), bus: old?.bus });
    g.__workflowUi = rt;
    rt.bus.publish({ type: "reset" });
    await rt.ready;
  })().finally(() => {
    g.__workflowUiReset = undefined;
  });
  return g.__workflowUiReset;
}

export function getRuntime(): Runtime {
  if (!g.__workflowUi) g.__workflowUi = createRuntime();
  return g.__workflowUi;
}
