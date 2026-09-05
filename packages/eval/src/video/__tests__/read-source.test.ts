import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { normalizeVideoSource, parseVideoSourceText, readVideoSource } from "../read-source.js";

function event(type: string, payload: Record<string, unknown> = {}, extra = {}) {
  return { actorId: "ada", type, payload, pulseIndex: 0, ...extra };
}

describe("video source adapters", () => {
  it("retains legacy row order, silence and final states without backfilling emotion", () => {
    const rows = [
      { pulse: 2, agent: "ada", type: "message_sent", content: "Anyone here?" },
      { pulse: 0, agent: "ada", type: "no_op_recorded", privateMotive: "Keep them here." },
      { pulse: 0, agent: "nox", type: "reaction_sent", content: "reacted 😠" },
    ];
    const story = normalizeVideoSource({ name: "Room", transcript: rows, finalStates: { ada: { shame: 0.9 } } });
    expect(story.steps.map(step => step.text)).toEqual([
      "Anyone here?", "no op recorded", "Keep them here.", "reacted 😠", "shame: 0.9",
    ]);
    expect(story.steps.map(step => step.pulse)).toEqual([2, 0, 0, 0, undefined]);
    expect(story.steps.slice(0, 4).every(step => step.emotion === undefined)).toBe(true);
    expect(story.steps[2]?.visibility).toBe("private");
    expect(story.steps[4]?.emotion).toEqual({ source: "snapshot", values: { shame: 0.9 } });
    expect(story.steps[0]?.raw).toBe(rows[0]);
  });

  it("classifies legacy engine errors as operator records, never emotion", () => {
    const story = normalizeVideoSource([
      { pulse: -1, agent: "ada", type: "no_op_recorded", privateMotive: "Fallback applied: No JSON object found" },
    ]);
    expect(story.sourceKind).toBe("transcript");
    expect(story.steps.every(step => step.visibility === "operator" && !step.emotion)).toBe(true);
    expect(story.steps[0]?.sourceRefs).toEqual(["/0"]);
  });

  it("joins motives and drivers by intent while retaining every original event position", () => {
    const events = [
      event("reply_sent", { content: "No." }, { sourceIntentId: "i1", id: "e1", pulseIndex: -1 }),
      event("private_motive_summary", { summary: "I resent this.", emotionDrivers: ["resentment"], engineAuthored: false }, { sourceIntentId: "i1" }),
      event("private_motive_summary", { summary: "An unjoined thought.", emotionDrivers: ["fearOfExclusion"] }),
      event("repetition_blocked", { reason: "near duplicate" }),
      event("future_event", { nested: { remains: "visible" }, score: 7 }),
    ];
    const story = normalizeVideoSource({ id: "recorded", events });
    expect(story.steps).toHaveLength(5);
    expect(story.steps[0]?.emotion).toEqual({ source: "driver", drivers: ["resentment"] });
    expect(story.steps[0]?.sourceRefs).toEqual(["/events/0", "/events/1"]);
    expect(story.steps[1]?.sourceRefs).toEqual(["/events/1", "/events/0"]);
    expect(story.steps[1]?.text).toBe("I resent this.");
    expect(story.steps[2]?.kind).toBe("private");
    expect(story.steps[3]?.visibility).toBe("operator");
    expect(story.steps[4]?.text).toContain('nested: {"remains":"visible"}');
    expect(story.steps[4]?.raw).toBe(events[4]);
  });

  it("does not turn engine-authored motive drivers into feelings", () => {
    const story = normalizeVideoSource({ events: [
      event("no_op_recorded", {}, { sourceIntentId: "broken" }),
      event("private_motive_summary", { summary: "Fallback applied: parse error", emotionDrivers: ["anger"] }, { sourceIntentId: "broken" }),
    ] });
    expect(story.steps.every(step => !step.emotion && step.visibility === "operator")).toBe(true);
  });

  it("preserves committed speech visibility when its motive is engine-authored", () => {
    for (const type of ["message_sent", "reply_sent", "reaction_sent"]) {
      const story = normalizeVideoSource({ events: [
        event(type, { content: "Already committed.", emoji: "👍" }, { sourceIntentId: "i1" }),
        event("private_motive_summary", { summary: "Fallback applied: motive unavailable", emotionDrivers: ["anger"] }, { sourceIntentId: "i1" }),
      ] });
      expect(story.steps[0]).toMatchObject({ visibility: "public", action: type.replace(/_/g, " ") });
      expect(story.steps[1]?.visibility).toBe("operator");
      expect(story.steps.every(step => !step.emotion)).toBe(true);
      const legacy = normalizeVideoSource([{ pulse: 0, agent: "ada", type, content: "Already committed.", privateMotive: "Fallback applied: unavailable" }]);
      expect(legacy.steps.map(step => step.visibility)).toEqual(["public", "operator"]);
    }
  });

  it("keeps legacy private motives out of public event text", () => {
    const story = normalizeVideoSource({ events: [event("no_op_recorded", { privateMotiveSummary: "I need time." })] });
    expect(story.steps[0]?.text).not.toContain("I need time.");
    expect(story.steps[1]?.text).toBe("I need time.");
    expect(story.steps[1]?.visibility).toBe("private");
  });

  it.each(["no_op_recorded", "repetition_blocked", "memory_written", "intent_blocked", "llm_failure", "stagnation_detected", "operator_warning"])(
    "retains internal visibility for %s when old exports say public", type => {
      const raw = normalizeVideoSource({ events: [event(type, {}, { visibility: { visibleToSpectators: true, visibilityReason: "public" } })] });
      const legacy = normalizeVideoSource([{ pulse: 0, agent: "ada", type, private: false }]);
      expect(raw.steps[0]?.visibility).toBe("operator");
      expect(legacy.steps[0]?.visibility).toBe("operator");
    },
  );

  it("preserves authored phases and complete dialogue; rejects invalid cues and unknown actors", () => {
    const script = {
      version: "perfectman-video-v1", title: "A room", agents: [{ id: "ada", name: "Ada" }],
      steps: [{ phase: "Climax", kind: "message", actorId: "ada", text: "He said you were easy to fool.", emotion: { label: "angry" }, duration: 4 }],
    };
    const story = normalizeVideoSource(script);
    expect(story.steps[0]).toMatchObject({ phase: "Climax", text: script.steps[0]!.text, duration: 4, emotion: { source: "authored", label: "angry" } });
    expect(() => normalizeVideoSource({ ...script, steps: [{ ...script.steps[0], actorId: "absent" }] })).toThrow("Unknown script actorId");
    expect(() => normalizeVideoSource({ ...script, steps: [{ ...script.steps[0], duration: -1 }] })).toThrow();
    expect(() => normalizeVideoSource({ ...script, steps: [{ ...script.steps[0], emotion: {} }] })).toThrow();
    expect(() => normalizeVideoSource({ ...script, agents: [...script.agents, ...script.agents] })).toThrow("unique");
  });

  it("rejects summaries, malformed row data, and non-finite event payloads", () => {
    expect(() => normalizeVideoSource({ version: "narrations-v1", narrations: {} })).toThrow("matching scenarios/<scenarioId>.json");
    expect(() => normalizeVideoSource([{ agent: "ada", pulse: "zero", type: "message_sent" }])).toThrow();
    expect(() => normalizeVideoSource({ events: [event("unknown", { invalid: Infinity })] })).toThrow();
    expect(() => normalizeVideoSource([])).toThrow("Unsupported");
  });

  it("parses only REPLAY_DATA JSON, without running page scripts", () => {
    const value = { agentIds: [], pulses: [] };
    const html = `<script>throw new Error('never execute');</script><script type='application/json' id='REPLAY_DATA'>${JSON.stringify(value)}</script>`;
    expect(parseVideoSourceText(html)).toEqual(value);
    expect(() => parseVideoSourceText('<script id="REPLAY_DATA" type="application/json">globalThis.process.exit(1)</script>')).toThrow();
    expect(() => parseVideoSourceText('<script id="REPLAY_DATA">{}</script>')).toThrow("application/json");
    expect(() => parseVideoSourceText("<html>No replay</html>")).toThrow("no REPLAY_DATA");
  });

  it("hashes the exact bytes used to normalize a file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "perfectman-video-source-"));
    try {
      const path = join(directory, "saved.json");
      const bytes = Buffer.from('[{"pulse":0,"agent":"ada","type":"message_sent","content":"Olá."}]\n');
      await writeFile(path, bytes);
      const result = await readVideoSource(path);
      expect(result.sourceSha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(result.story.title).toBe("saved");
      expect(await readFile(path)).toEqual(bytes);
      await expect(readVideoSource(directory)).rejects.toThrow("must be a file");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
