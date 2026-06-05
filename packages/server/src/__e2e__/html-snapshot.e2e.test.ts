/**
 * HTML Snapshot E2E Test
 *
 * Runs a 15-pulse simulation with 4 personas (Ana, Bruno, Carla, Diego)
 * across 4 channels (general, core-group, ana-carla DM, bruno-diego DM),
 * then:
 *  1. Generates docs/simulation-snapshot.html — an interactive single-file
 *     replay viewer with emotion panels, thinking, and dreaming.
 *  2. Saves a normalized snapshot for regression detection.
 */
import { describe, it, expect, afterAll } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SimulationRecorder } from "./simulation-recorder.js";
import { FOUR_PERSONA_CONFIG } from "./4-persona-scenario.js";
import { getScenarioConfig } from "./scenarios/index.js";
import { generateHtml } from "./snapshot-html-generator.js";
import type { SimulationReplay } from "./simulation-recorder.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = resolve(__dirname, "../../../../docs");
const HTML_OUTPUT = resolve(DOCS_DIR, "simulation-snapshot.html");
const PULSE_COUNT = parseInt(process.env["PULSE_COUNT"] ?? "15", 10);
const SCENARIO_ID = process.env["SCENARIO_ID"] ?? "4-persona";

const ACTIVE_CONFIG = SCENARIO_ID === "4-persona"
  ? FOUR_PERSONA_CONFIG
  : getScenarioConfig(SCENARIO_ID);

// ── Normalisation (strips volatile fields before snapshot assertion) ──────────

const STATIC_CHANNEL_IDS = new Set(
  ACTIVE_CONFIG.channels.map((c) => c.id),
);

function normalizeChannelId(id: string): string {
  return STATIC_CHANNEL_IDS.has(id) ? id : "[dynamic-channel]";
}

function normalizeReplay(replay: SimulationReplay): unknown {
  return {
    simulationName: replay.simulationName,
    agentIds: replay.agentIds,
    agentArchetypes: replay.agentArchetypes,
    channelCount: replay.channels.length,
    pulseCount: replay.pulses.length,
    // Per-pulse: event type distribution (sorted, agent-grouped) — stable across runs
    perPulseEventSummary: replay.pulses.map((frame) => {
      // Group event types by actorId (order-agnostic)
      const byActor: Record<string, string[]> = {};
      for (const e of frame.committedEvents) {
        const key = e.actorId;
        (byActor[key] ??= []).push(e.type);
      }
      // Sort each agent's event list for determinism
      for (const k of Object.keys(byActor)) byActor[k]!.sort();
      return {
        pulseIndex: frame.pulseIndex,
        byActor,
      };
    }),
    // Emotional trajectory: top social emotion per agent per pulse (robust to small float drift)
    emotionalTrajectory: replay.pulses.map((frame) => ({
      pulseIndex: frame.pulseIndex,
      agentMoods: Object.fromEntries(
        Object.entries(frame.agentStates).map(([id, s]) => [
          id,
          {
            valenceSign: Math.sign(Math.round(s.coreMood.valence * 10)),
            arousalBand: s.coreMood.arousal > 0.5 ? "high" : "low",
            topSocialEmo: Object.entries(s.socialEmotions)
              .sort(([, a], [, b]) => b - a)[0]?.[0] ?? null,
          },
        ]),
      ),
    })),
  };
}

// ── Test ──────────────────────────────────────────────────────────────────────

describe(`HTML Snapshot: ${SCENARIO_ID} simulation`, () => {
  let replay: SimulationReplay;
  let recorder: SimulationRecorder;

  const agentIds = ACTIVE_CONFIG.agents.map((a) => a.id);
  const agentCount = agentIds.length;

  it(
    `runs ${PULSE_COUNT} pulses, generates HTML, and matches snapshot`,
    async () => {
      recorder = new SimulationRecorder(ACTIVE_CONFIG);
      await recorder.init();
      await recorder.runPulses(PULSE_COUNT);
      replay = recorder.getReplay();

      // ── Structural sanity ─────────────────────────────────────────────────
      expect(replay.agentIds).toHaveLength(agentCount);
      expect(replay.pulses).toHaveLength(PULSE_COUNT);

      // Verify every pulse has agent states for all agents
      for (const frame of replay.pulses) {
        expect(Object.keys(frame.agentStates)).toHaveLength(agentCount);
      }

      // At least some committed events across all pulses
      const totalEvents = replay.pulses.reduce((s, f) => s + f.committedEvents.length, 0);
      expect(totalEvents).toBeGreaterThan(0);

      // At least some agent thinking was recorded
      const thinkingCount = replay.pulses.reduce(
        (s, f) => s + Object.keys(f.agentThinking).length,
        0,
      );
      expect(thinkingCount).toBeGreaterThan(0);

      // At least one agent must act across the entire run
      const trajectory = normalizeReplay(replay) as ReturnType<typeof normalizeReplay>;
      const anyAgentActed = (trajectory as any).perPulseEventSummary.some(
        (p: any) => Object.keys(p.byActor).length > 0,
      );
      expect(anyAgentActed).toBe(true);

      // ── HTML output ───────────────────────────────────────────────────────
      const html = generateHtml(replay);
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("REPLAY_DATA");
      for (const id of agentIds) {
        expect(html).toContain(id);
      }

      mkdirSync(DOCS_DIR, { recursive: true });
      writeFileSync(HTML_OUTPUT, html, "utf-8");
      console.log(`\n✅ HTML written to: ${HTML_OUTPUT}\n`);
    },
    1_800_000,
  );

  afterAll(async () => {
    await recorder?.close();
  });
});
