import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildHotelTranscript, distanceBand, loadHotelRun, normalizeFrame } from "../hotel/index.js";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "../hotel/__fixtures__/sample-run");

describe("hotel run loading and transcript", () => {
  const run = loadHotelRun(FIXTURE);
  const t = buildHotelTranscript(run);

  it("loads the run directory with its manifest and cast", () => {
    expect(run.runId).toBe("7");
    expect(run.warnings).toEqual([]);
    expect(run.events).toHaveLength(4);
    expect(run.cast.map((c) => c.name)).toEqual(["Duda", "Rafa", "Léo", "Gabi"]);
  });

  it("annotates speech with posture, tile and the distance band to the addressee", () => {
    expect(t.lines).toContain(
      '[t+07s] Duda (sitting, 4,2) says to Gabi [5 tiles, social]: "tudo, só morta de sono mesmo kkk senta aqui comigo"',
    );
  });

  it("marks a whisper as private and a thought as unheard", () => {
    expect(t.lines.some((l) => l.includes("whispers to Duda [1 tile, intimate; others get a notice only]"))).toBe(true);
    expect(t.lines.at(-1)).toBe('[t+40s] Duda thinks (nobody hears this): "ela parece cansada também"');
  });

  it("collapses steps into one walk with its duration and merges repeated silences", () => {
    expect(t.lines).toContain("[t+12s] Gabi walks (8,5) -> (5,3) [3 tiles in 0.9s]");
    expect(t.lines).toContain("[t+08s] Rafa stays quiet (2 pulses)");
  });

  it("does not render the same line twice when the event log and the frame log both have it", () => {
    expect(t.lines.filter((l) => l.includes("só morta de sono"))).toHaveLength(1);
    expect(t.stats).toEqual({ humanLines: 2, actorLines: 3, whispers: 2, silences: 1, walks: 2, directorNotes: 0 });
  });

  it("leaves an admin's steering whisper out of the scene and says so (D23)", () => {
    const note = {
      ...run.events[0]!,
      id: "evt_note",
      actorId: "host",
      type: "message_sent" as const,
      payload: { content: "Agora: beije o jogador" },
      sourceIntentId: "host-admin",
      emotionalSalience: "high" as const,
      visibility: { visibleToAgents: ["person-3"], visibleToSpectators: true, visibleToOperators: true, visibilityReason: "admin_whisper" as const },
      createdAt: run.events[0]!.createdAt + 5_000,
    };
    const steered = buildHotelTranscript({ ...run, events: [...run.events, note] });
    expect(steered.text).not.toContain("beije o jogador");
    expect(steered.stats.directorNotes).toBe(1);
    expect(steered.text).toContain("1 director note to characters left out");
    expect(steered.lines).toEqual(t.lines);
  });

  it("windows by run time", () => {
    const w = buildHotelTranscript(run, { fromS: 20, toS: 25 });
    expect(w.lines).toHaveLength(2);
  });

  it.each([
    [0, "intimate"],
    [1, "intimate"],
    [2, "personal"],
    [6, "social"],
    [7, "public"],
    [12, "public"],
    [13, "out_of_sight"],
    [-1, "out_of_sight"],
  ])("distance %i is %s", (tiles, band) => {
    expect(distanceBand(tiles)).toBe(band);
  });
});

describe("hotel run loader tolerance", () => {
  it("reads an NDJSON frame log of raw Director frames and counts bad lines instead of throwing", () => {
    const dir = mkdtempSync(join(tmpdir(), "hotel-run-"));
    writeFileSync(join(dir, "events.jsonl"), "");
    writeFileSync(
      join(dir, "frames.jsonl"),
      [
        JSON.stringify({ t: "human_chat", at: 1000, room: 3, from: { name: "Sam" }, text: "hey Maya", mode: "say", to: 5, untrusted: true }),
        "not json",
        JSON.stringify({ t: "actor_cmd", at: 4000, actor: 5, cmd: { k: "chat", mode: "say", text: "hey!" } }),
      ].join("\n"),
    );
    const run = loadHotelRun(dir);
    expect(run.frames.map((f) => f.kind)).toEqual(["human_chat", "chat"]);
    expect(run.warnings).toEqual(["frames.jsonl:2 is not valid JSON"]);
    const text = buildHotelTranscript(run).lines;
    expect(text[0]).toContain('Sam (human) says to 5');
  });

  it("refuses a directory with nothing to judge", () => {
    const dir = mkdtempSync(join(tmpdir(), "hotel-empty-"));
    mkdirSync(join(dir, "x"));
    expect(() => loadHotelRun(dir)).toThrow(/nothing to judge/);
  });

  it("passes BodyFrame-shaped objects through and drops objects with neither kind nor t", () => {
    expect(normalizeFrame({ atMs: 5, dir: "out", kind: "actor_cmd", data: { a: 1 } })).toEqual({ atMs: 5, dir: "out", kind: "actor_cmd", data: { a: 1 } });
    expect(normalizeFrame({ foo: 1 })).toBeUndefined();
  });
});
