import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { PerfectmanUi } from "../../generated.js";
import { EMOTION_CANONICAL, SFX_CANONICAL, canonicalEmotion, canonicalSfx, canonicalize, clampFade, cueViolations, isCanonicalEmotion, isCanonicalSfx, normaliseCueName } from "../cue-vocab.js";
import { emotionLabel } from "../planner.js";
import { rig } from "./cine-helpers.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const VOCAB = JSON.parse(readFileSync(join(HERE, "../../../../schema/cue-vocab.json"), "utf8")) as {
  sfx: { canonical: string[]; aliases: Record<string, string>; director_emits_today: string[] };
  emotion: { canonical: string[]; aliases: Record<string, string>; director_emits_today: string[]; face_states: Record<string, string> };
};

describe("the vendored cue vocabulary", () => {
  it("is what the generated constants say (a stale generated file fails check:director too)", () => {
    expect([...SFX_CANONICAL]).toEqual(VOCAB.sfx.canonical);
    expect([...EMOTION_CANONICAL]).toEqual(VOCAB.emotion.canonical);
  });

  it("resolves names the way the client does: case, spaces and hyphens, aliases, face states", () => {
    expect(normaliseCueName("  Crowd-Murmur ")).toBe("crowd_murmur");
    expect(canonicalSfx("murmur")).toBe("crowd_murmur");
    expect(canonicalSfx("Door")).toBe("door_open");
    expect(canonicalSfx("whoosh")).toBe("transition_whoosh");
    expect(canonicalSfx("explosion")).toBeUndefined();
    expect(canonicalEmotion("anger")).toBe("angry");
    expect(canonicalEmotion("tense")).toBe("afraid");
    expect(canonicalEmotion("worried")).toBe("afraid");
    expect(canonicalEmotion("Heartbroken")).toBe("sad");
    expect(canonicalEmotion("it is complicated")).toBeUndefined();
  });

  it("reports aliases and out-of-range fades as violations and fixes them in canonicalize", () => {
    expect(cueViolations({ k: "sfx", cue: "murmur" })).toEqual(['sfx.cue "murmur" is not canonical (use "crowd_murmur")']);
    expect(cueViolations({ k: "sfx", cue: "crowd_murmur" })).toEqual([]);
    expect(cueViolations({ k: "cue", id: 1, emotion: "tense", ms: 1000 })).toHaveLength(1);
    expect(cueViolations({ k: "hud", fade: { to: 1.5, ms: 100 } })).toHaveLength(1);
    expect(cueViolations({ k: "hud", fade: { to: 0, ms: 100 } })).toEqual([]);
    expect(canonicalize({ k: "sfx", cue: "whoosh", gain: 0.5 })).toEqual({ k: "sfx", cue: "transition_whoosh", gain: 0.5 });
    expect(canonicalize({ k: "sfx", cue: "bang" })).toBeUndefined();
    expect(canonicalize({ k: "hud", fade: { to: 7, ms: 10 } })).toEqual({ k: "hud", fade: { to: 1, ms: 10 } });
    expect(clampFade(-2)).toBe(0);
    expect(clampFade(Number.NaN)).toBe(0);
  });
});

describe("what the Director can emit", () => {
  it("the planner source names only canonical sfx cues", () => {
    const src = readFileSync(join(HERE, "../planner.ts"), "utf8");
    const named = [...src.matchAll(/cue: "([^"]+)"/g)].map((m) => m[1] as string);
    expect(named.length).toBeGreaterThan(5);
    for (const name of named) expect(isCanonicalSfx(name), name).toBe(true);
    const stings = [...src.matchAll(/return "(sting_[a-z]+)"/g)].map((m) => m[1] as string);
    for (const name of stings) expect(isCanonicalSfx(name), name).toBe(true);
  });

  it("emotionLabel only returns canonical icons, across the whole mood plane", () => {
    const seen = new Set<string>();
    for (let v = -1; v <= 1; v += 0.25) {
      for (let a = 0; a <= 1; a += 0.25) {
        for (const aff of [undefined, 0.7]) {
          const label = emotionLabel({ valence: v, arousal: a, ...(aff !== undefined ? { affection: aff } : {}) });
          expect(canonicalEmotion(label)).toBe(label);
          seen.add(label);
        }
      }
    }
    expect([...seen].sort()).toEqual(["afraid", "angry", "joy", "love", "sad"]);
  });

  it("every cue of a film with walks, a door, a kiss, laughs, moods, stings and a murmur is in the vocabulary", async () => {
    const r = rig({ stingGapMs: 0, emotionCueGapMs: 0 });
    r.world.moods.set("duda", { valence: -0.8, arousal: 0.3 });
    r.world.moods.set("rafa", { valence: -0.6, arousal: 0.9 });
    r.world.moods.set("gabi", { valence: 0.7, arousal: 0.5, affection: 0.9 });
    r.world.moods.set("leo", { valence: 0.1, arousal: 0.2 });
    r.director.start();
    const beat = async (fn: () => void, ms = 12_000): Promise<void> => {
      fn();
      await r.clock.advance(ms);
    };
    await r.clock.advance(5000);
    await beat(() => r.say("duda", "Será que ele vai voltar algum dia?", "say", "rafa"));
    await beat(() => r.say("rafa", "NÃO ACREDITO NISSO!!", "shout", "duda"));
    await beat(() => r.say("leo", "Alguém aí na cozinha, ou só eu?", "say", "gabi"));
    await beat(() => {
      r.exec.send([{ agentId: "gabi", cmd: "gesture", a: "laugh" }]);
      r.exec.send([{ agentId: "gabi", cmd: "gesture", a: "laugh" }]);
    });
    await beat(() => r.exec.sendThought("duda", "Eu não devia ter vindo."));
    await beat(() => r.exec.send([{ agentId: "gabi", cmd: "pair", kind: "kiss", with: "leo", pair: "k1" }]));
    await beat(() => r.exec.send([{ agentId: "gabi", cmd: "pair", kind: "hug", with: "leo", pair: "k2" }]));
    await beat(() => {
      r.exec.send([{ agentId: "duda", cmd: "move_room", to: "13" }]);
      r.world.move("duda", 13);
    });
    await beat(() => r.say("duda", "Cheguei na cozinha.", "say", "leo"));
    await beat(() => r.director.noteObject({ room: 13, tile: [3, 3], label: "Um copo cai", sfx: "slide whistle" }));
    await beat(() => r.director.noteObject({ room: 13, tile: [2, 2], sfx: "kaboom" }));
    await Promise.all([r.director.stop("completed", true), r.clock.advance(60_000)]);

    const ui = r.frames().map((f) => f.ui);
    expect(ui.length).toBeGreaterThan(20);
    const bad = ui.flatMap((u: PerfectmanUi) => cueViolations(u).map((v) => `${u.k}: ${v}`));
    expect(bad).toEqual([]);
    const sfx = new Set(ui.flatMap((u) => (u.k === "sfx" ? [u.cue] : [])));
    for (const expected of ["crowd_murmur", "transition_whoosh", "laugh", "kiss", "door_open", "sting_comedy"]) expect(sfx.has(expected), expected).toBe(true);
    // the object's free-text sfx was mapped; the unknown one was dropped, not sent
    expect(ui.some((u) => u.k === "sfx" && u.cue === "kaboom")).toBe(false);
    const emotions = new Set(ui.flatMap((u) => (u.k === "cue" ? [u.emotion] : [])));
    for (const e of emotions) expect(canonicalEmotion(e)).toBe(e);
    // fades are 0..1 numbers
    const fades = ui.flatMap((u) => (u.k === "hud" && u.fade ? [u.fade.to] : []));
    expect(fades.length).toBeGreaterThan(0);
    for (const to of fades) expect(to === 0 || to === 1 || (to > 0 && to < 1)).toBe(true);
  });

  it("the Director's own lists in the vendored JSON all resolve (guards a vocabulary bump)", () => {
    for (const name of VOCAB.sfx.director_emits_today) expect(isCanonicalSfx(canonicalSfx(name) ?? ""), name).toBe(true);
    for (const name of VOCAB.emotion.director_emits_today) expect(isCanonicalEmotion(canonicalEmotion(name) ?? ""), name).toBe(true);
  });
});
