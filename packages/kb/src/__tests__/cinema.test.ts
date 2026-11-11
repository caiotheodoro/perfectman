import { describe, expect, it } from "vitest";
import { buildNorms } from "../cinema/aggregate.js";
import { countReversals, measureScene, smooth, turnIntensity, directionIntensity, estimateSceneSec } from "../cinema/features.js";
import { parseMovieSum } from "../cinema/parsers/moviesum.js";
import { parseSummScreen } from "../cinema/parsers/summscreen.js";
import { cuesToScenes, parseOpusXml, subtitleQuality } from "../cinema/parsers/subtitles.js";
import { playToScenes } from "../cinema/plays.js";
import { auc } from "../cinema/validate.js";
import { genreBucket } from "../cinema/imdb.js";
import type { CineEvent, CineScene, SourceInfo } from "../cinema/types.js";

const info = (over: Partial<SourceInfo> = {}): SourceInfo => ({ id: "t/x", title: "x", lang: "en", medium: "film", genre: "drama", era: "modern", form: "screenplay", timeSource: "estimated", ...over });
const sp = (text: string, who = "A"): CineEvent => ({ kind: "speech", speaker: who, text });
const dir = (text: string): CineEvent => ({ kind: "direction", text });
const scene = (events: CineEvent[]): CineScene => ({ sourceId: "t/x", index: 0, events });

/** An invented scene that heats up and breaks: calm talk, a quarrel, a blow, then quiet. */
function rising(): CineScene {
  const ev: CineEvent[] = [];
  for (let i = 0; i < 6; i++) ev.push(sp(i % 2 ? "Maybe tomorrow, if the weather holds." : "We could walk to the harbour later.", i % 2 ? "B" : "A"));
  for (let i = 0; i < 6; i++) ev.push(sp(i % 2 ? "You liar! Get out of my sight, you coward!" : "Shut up! I hate you, you bastard!", i % 2 ? "B" : "A"));
  ev.push(dir("He slaps her hard and she falls against the door."));
  ev.push(sp("Damn you!!", "B"));
  for (let i = 0; i < 8; i++) ev.push(sp(i % 2 ? "Fine, the tea is on the shelf." : "I know, thank you for the tea.", i % 2 ? "B" : "A"));
  return scene(ev);
}

describe("intensity proxy", () => {
  it("scores hostile shouting above calm talk, in both languages", () => {
    expect(turnIntensity("You liar! Get out, you coward!", "en")).toBeGreaterThan(turnIntensity("We could walk to the harbour later.", "en") + 0.3);
    expect(turnIntensity("Cala a boca, seu covarde! Eu te odeio!", "pt")).toBeGreaterThan(turnIntensity("Vamos tomar um café mais tarde.", "pt") + 0.3);
  });
  it("reads a hard physical act in a direction", () => {
    expect(directionIntensity("He slaps her hard.", "en").hard).toBeGreaterThan(0);
    expect(directionIntensity("Ela senta e acende um cigarro.", "pt").hard).toBe(0);
    expect(directionIntensity("Ela senta e acende um cigarro.", "pt").soft).toBeGreaterThan(0);
  });
});

describe("lessons from the hand-check", () => {
  it("does not read a kiss or an embrace as conflict, but counts it as a physical beat", () => {
    const k = directionIntensity("She kisses him on the cheek.", "en");
    expect(k.hard).toBeGreaterThan(0);
    expect(k.v).toBeLessThan(0.5);
    expect(directionIntensity("He punches the wall.", "en").v).toBeGreaterThan(0.8);
  });
  it("does not read a name in capitals as shouting", () => {
    expect(turnIntensity("ERLYNNE. Oh, why do you doubt me", "en")).toBeLessThan(0.1);
    expect(turnIntensity("GET OUT OF HERE NOW!", "en")).toBeGreaterThan(0.25);
  });
  it("puts a title cut at its full stop back with the name", () => {
    const out = playToScenes([{ sourceId: "p", act: "1", scene: "1", heading: "", items: [{ kind: "speech", speaker: "MRS", text: "ERLYNNE. Oh! why do you doubt me?" }, { kind: "speech", speaker: "LADY WINDERMERE", text: "I do not." }] }], "p");
    expect(out[0]!.events[0]).toMatchObject({ speaker: "MRS ERLYNNE", text: "Oh! why do you doubt me?" });
  });
  it("splits a lower-case stage direction off the front of a line", () => {
    const out = playToScenes([{ sourceId: "p", act: "1", scene: "1", heading: "", items: [{ kind: "speech", speaker: "PEGEEN", text: "angrily, to Sara.—What is it you want?" }] }], "p");
    expect(out[0]!.events.map((e) => e.kind)).toEqual(["direction", "speech"]);
    expect(out[0]!.events[1]).toMatchObject({ text: "What is it you want?" });
  });
  it("drops a MovieSum scene whose cues are scene numbers, and page furniture", () => {
    const bad = `<script><scene><character>151 INT. HOUSE</character><dialogue>Hello there friend</dialogue><character>152 OMIT</character><dialogue>Another line here</dialogue></scene><scene><scene_description>(CONTINUED)</scene_description><scene_description>©2017 STUDIO PRIVILEGED AND CONFIDENTIAL</scene_description><character>ANNA</character><dialogue>Fine .</dialogue></scene></script>`;
    const r = parseMovieSum(bad, "m/2");
    expect(r.garbled).toBe(1);
    expect(r.scenes).toHaveLength(1);
    expect(r.scenes[0]!.events).toHaveLength(1);
  });
  it("cuts a transcript at an INT./EXT. heading and ignores theme-music lines", () => {
    const lines = ["INT. SQUAD ROOM - DAY".replace(/^/, "("), "GIBBS: Where is he?", "TONY: Late.", "(THEME MUSIC UP OVER OPENING TITLE)", "(INT. AUTOPSY - LATER)", "DUCKY: Sit down.", "JIMMY: Yes sir."];
    const lines2 = lines.map((l) => (l.startsWith("(") && !l.endsWith(")") ? `${l})` : l));
    const scenes = parseSummScreen(lines2, "t/ep2");
    expect(scenes).toHaveLength(2);
    expect(scenes.every((s) => s.events.every((e) => !(e.kind === "direction" && /music/i.test(e.text))))).toBe(true);
  });
  it("strips speaker labels and music glyphs from subtitle lines", () => {
    const xml = `<document><s id="1"><time id="T1S" value="00:00:01,000" />\nDAVID: Have you seen that paralegal?\n<time id="T1E" value="00:00:03,000" /></s><s id="2"><time id="T2S" value="00:00:03,500" />\nâ™ª la la\n<time id="T2E" value="00:00:04,000" /></s></document>`;
    const sc = cuesToScenes(parseOpusXml(xml), "o/2");
    expect(sc[0]!.events[0]).toMatchObject({ text: "Have you seen that paralegal?" });
  });
});

describe("reversals", () => {
  it("counts direction changes with a swing, not wobble", () => {
    expect(countReversals([0, 0.3, 0.6, 0.3, 0, 0.3, 0.6])).toBe(2);
    expect(countReversals([0, 0.5, 1])).toBe(0);
    expect(countReversals([0.5, 0.52, 0.5, 0.51, 0.5, 0.52])).toBe(0);
    expect(countReversals([0, 0.4, 0, 0.4, 0, 0.4])).toBe(4);
  });
  it("smooths without moving the mean much", () => {
    const s = smooth([0, 0, 1, 0, 0]);
    expect(Math.max(...s)).toBeLessThan(1);
    expect(s.reduce((a, b) => a + b, 0)).toBeGreaterThan(0.8);
  });
});

describe("measureScene", () => {
  it("puts the climax late and the aftermath after it for a rising scene", () => {
    const f = measureScene(rising(), info(), { durSec: estimateSceneSec(rising().events) })!;
    expect(f.turns).toBe(21);
    expect(f.hardActs).toBe(1);
    expect(f.tClimax!).toBeGreaterThan(0.45);
    expect(f.tClimax!).toBeLessThan(0.85);
    expect(f.tInciting!).toBeLessThan(f.tClimax!);
    expect(f.aftermathShare!).toBeGreaterThan(0.1);
    expect(f.peak).toBeGreaterThan(f.baseline);
    expect(f.curve).toHaveLength(10);
    expect(f.curve[0]!).toBeLessThan(Math.max(...f.curve));
    expect(f.timeSource).toBe("estimated");
    expect(f.overlapShare).toBeNull();
    expect(f.dialogueShare).toBeGreaterThan(0.8);
  });
  it("refuses a scene with too few turns, and gives no arc to a flat one", () => {
    expect(measureScene(scene([sp("Hi."), sp("Hello.")]), info(), { durSec: 10 })).toBeNull();
    const flat = scene(Array.from({ length: 14 }, (_, i) => sp(i % 2 ? "Pass the bread, please." : "Here you are.", i % 2 ? "B" : "A")));
    const f = measureScene(flat, info(), { durSec: 60 })!;
    expect(f.tClimax).toBeNull();
    expect(f.reversals).toBe(0);
  });
  it("counts interrupted lines, trailing off and written silences", () => {
    const ev: CineEvent[] = [sp("I was only trying to—"), sp("No."), sp("..."), sp("Well, I thought..."), dir("(a long pause)"), sp("Go on."), sp("Never mind.")];
    const f = measureScene(scene(ev), info(), { durSec: 30 })!;
    expect(f.interruptShare).toBeCloseTo(1 / 6, 2);
    expect(f.ellipsisShare).toBeCloseTo(1 / 6, 2);
    expect(f.silentTurnShare).toBeCloseTo(1 / 6, 2);
    expect(f.pauseMarkersPer100).toBeGreaterThan(0);
  });
  it("uses real cue times for subtitle scenes: silence, overlap, back-to-back turns", () => {
    const ev: CineEvent[] = [
      { kind: "speech", speaker: null, text: "Você mentiu para mim!", t0: 0, t1: 2 },
      { kind: "speech", speaker: null, text: "Não, eu juro.", t0: 2.05, t1: 3.5 },
      { kind: "speech", speaker: null, text: "Cala a boca.", t0: 3.4, t1: 4.5 },
      { kind: "speech", speaker: null, text: "Por quê?", t0: 9, t1: 10 },
    ];
    const f = measureScene({ sourceId: "s", index: 0, events: ev }, info({ lang: "pt", timeSource: "subtitle", form: "subtitle" }), { durSec: 0 })!;
    expect(f.hasDirections).toBe(false);
    expect(f.dirPerMin).toBeNull();
    expect(f.overlapShare).toBeCloseTo(1 / 3, 2);
    expect(f.rapidShare).toBeCloseTo(2 / 3, 2);
    expect(f.silenceShare!).toBeGreaterThan(0.3);
    expect(f.gapsOver2sPerMin!).toBeGreaterThan(0);
    expect(f.durSec).toBeCloseTo(10, 0);
  });
});

describe("parsers", () => {
  it("reads MovieSum XML into scenes, dropping slug lines from the action count", () => {
    const xml = `<script><scene><stage_direction>INT. KITCHEN - NIGHT</stage_direction><scene_description>Rain taps the glass .</scene_description><character>ANNA</character><parenthetical>( quietly )</parenthetical><dialogue>Did you eat ?</dialogue><character>BEN</character><dialogue>Not yet --</dialogue></scene><scene><character>ANNA</character><dialogue>Later .</dialogue></scene></script>`;
    const { scenes } = parseMovieSum(xml, "m/1");
    expect(scenes).toHaveLength(2);
    expect(scenes[0]!.events.map((e) => e.kind)).toEqual(["direction", "direction", "speech", "speech"]);
    const first = scenes[0]!.events[0]!;
    expect(first.kind === "direction" && first.text).toBe("Rain taps the glass.");
    expect(scenes[0]!.events[2]).toMatchObject({ kind: "speech", speaker: "ANNA", text: "Did you eat?" });
  });
  it("reads transcript lines and cuts a scene at a change of place", () => {
    const lines = ["(Mona stands at the window.)", "MONA: Where were you?", "LEO: Out. (He drops the keys.)", "(Later, at the diner, the two sit apart.)", "MONA: Say it.", "LEO: There is nothing to say."];
    const scenes = parseSummScreen(lines, "t/ep1");
    expect(scenes).toHaveLength(2);
    expect(scenes[0]!.events.filter((e) => e.kind === "speech")).toHaveLength(2);
    expect(scenes[0]!.events.some((e) => e.kind === "direction" && e.text.startsWith("He drops"))).toBe(true);
  });
  it("reads OPUS XML cues, splits dash turns and cuts a scene at a long silence", () => {
    const xml = `<?xml version="1.0"?><document id="1"><s id="1"><time id="T1S" value="00:00:01,000" />\n- Oi.\n- Tudo bem?\n<time id="T1E" value="00:00:03,000" /></s><s id="2"><time id="T2S" value="00:00:03,500" />\nTudo.\n<time id="T2E" value="00:00:04,500" /></s><s id="3"><time id="T3S" value="00:01:00,000" />\nOutra cena.\n<time id="T3E" value="00:01:02,000" /></s><s id="4"><time id="T4S" value="00:01:02,500" />\nSim.\n<time id="T4E" value="00:01:03,000" /></s></document>`;
    const cues = parseOpusXml(xml);
    expect(cues).toHaveLength(4);
    const scenes = cuesToScenes(cues, "o/1");
    expect(scenes).toHaveLength(2);
    expect(scenes[0]!.events).toHaveLength(3);
    expect(scenes[0]!.events[0]).toMatchObject({ speaker: null, text: "Oi." });
    expect(subtitleQuality(cues).ok).toBe(false);
  });
  it("cuts a long play scene into windows of about the same size", () => {
    const items = Array.from({ length: 200 }, (_, i) => ({ kind: "speech" as const, speaker: i % 2 ? "A" : "B", text: "Words here." }));
    const out = playToScenes([{ sourceId: "p", act: "1", scene: "1", heading: "", items }], "p");
    expect(out.length).toBeGreaterThanOrEqual(3);
    for (const s of out) expect(s.events.length).toBeLessThanOrEqual(100);
  });
});

describe("helpers", () => {
  it("computes AUC", () => {
    expect(auc([3, 4], [1, 2])).toBe(1);
    expect(auc([1, 2], [3, 4])).toBe(0);
    expect(auc([1, 1], [1, 1])).toBe(0.5);
  });
  it("buckets IMDb genres, thriller first", () => {
    expect(genreBucket(["Comedy", "Crime"])).toBe("thriller");
    expect(genreBucket(["Comedy", "Romance"])).toBe("comedy");
    expect(genreBucket(["Drama"])).toBe("drama");
    expect(genreBucket(["Documentary"])).toBe("other");
  });
});

describe("norms are numbers only", () => {
  it("never carries a run of five words from any scene it was built from", () => {
    const secret = "The lighthouse keeper counted seven gulls before dawn";
    const sc = rising();
    sc.events.push(sp(secret, "A"), sp("And then the crimson ferry never returned home", "B"), sp("Nobody ever found the missing violin case", "A"));
    const rows = Array.from({ length: 40 }, () => measureScene(sc, info(), { durSec: 120 })!);
    const norms = buildNorms(rows, [], { byGroup: {}, calibration: {} });
    const json = JSON.stringify(norms).toLowerCase();
    for (const t of [secret, "And then the crimson ferry never returned home", "Nobody ever found the missing violin case", "Get out of my sight"]) {
      const w = t.toLowerCase().split(/\s+/);
      for (let i = 0; i + 5 <= w.length; i++) expect(json).not.toContain(w.slice(i, i + 5).join(" "));
    }
    const b = norms.buckets["en/film/screenplay"]!;
    expect(b.n.scenes).toBe(40);
    expect(b.ladders["reversals"]!.p50).toBeGreaterThanOrEqual(0);
    expect(b.curves!.abs.p50).toHaveLength(10);
    expect(b.confidence).toBe("low");
    expect(Object.keys(norms.buckets).sort()).toEqual(["en/film/screenplay", "en/film/screenplay/drama"]);
  });
});
