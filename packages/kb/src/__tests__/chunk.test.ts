import { describe, expect, it } from "vitest";
import { actionHint, chunkScene } from "../chunk.js";
import type { Item, Scene } from "../types.js";

const meta = { title: "T", author: "A", language: "en", medium: "THEATRE" as const, license_class: "public-domain-us" };
const sp = (speaker: string, text: string): Item => ({ kind: "speech", speaker, text });
const dir = (text: string): Item => ({ kind: "direction", text });
const scene = (items: Item[]): Scene => ({ sourceId: "s", act: "1", scene: "1", heading: "", items });

describe("actionHint", () => {
  it("finds the strongest physical action in English and Portuguese", () => {
    expect(actionHint("Stabs himself.")).toBe("KILLING");
    expect(actionHint("She faints.")).toBe("FAINTING");
    expect(actionHint("They kiss.")).toBe("KISSING");
    expect(actionHint("Beija-a.")).toBe("KISSING");
    expect(actionHint("Embraces her.")).toBe("HUGGING");
    expect(actionHint("Weeps.")).toBe("CRYING");
    expect(actionHint("Pushes him away.")).toBe("VIOLENT_PUSH");
    expect(actionHint("Slaps her.")).toBe("VIOLENT_STRIKE");
    expect(actionHint("A shot is heard offstage.")).toBe("DIALOGUE_ONLY");
    expect(actionHint("Aside.")).toBe("DIALOGUE_ONLY");
  });
});

describe("chunkScene", () => {
  it("ends a beat on a physical action plus the reply to it", () => {
    const s = scene([sp("A", "You lied."), sp("B", "I did not."), sp("A", "You did."), dir("Slaps him."), sp("B", "Ah!"), sp("A", "Now go."), sp("B", "Never."), sp("A", "Go.")]);
    const beats = chunkScene(s, meta);
    expect(beats[0]!.actionHint).toBe("VIOLENT_STRIKE");
    expect(beats[0]!.text).toContain("B: Ah!");
    expect(beats[0]!.text).not.toContain("Now go");
  });
  it("starts a new beat when a new speaker takes the floor after a settled pair", () => {
    const pair = Array.from({ length: 6 }, (_, i) => sp(i % 2 ? "B" : "A", `line ${i}`));
    const beats = chunkScene(scene([...pair, sp("C", "May I?"), sp("A", "No."), sp("C", "Please.")]), meta);
    expect(beats.length).toBe(2);
    expect(beats[1]!.speakers).toEqual(["C", "A"]);
  });
  it("merges fragments but keeps a short beat that carries an action", () => {
    const a = chunkScene(scene([sp("A", "x"), sp("B", "y"), sp("A", "z"), sp("B", "w"), dir("Enter C."), sp("C", "hm")]), meta);
    expect(a.length).toBe(1);
    const b = chunkScene(scene([sp("A", "x"), sp("B", "y"), sp("A", "z"), sp("B", "w"), dir("They kiss."), sp("A", "oh"), sp("B", "k"), sp("A", "ok")]), meta);
    expect(b[0]!.actionHint).toBe("KISSING");
  });
  it("gives ids, cast size and metadata", () => {
    const beats = chunkScene(scene([sp("A", "x"), sp("B", "y"), sp("C", "z")]), meta);
    expect(beats[0]!.id).toBe("s:1.1.1");
    expect(beats[0]!.castSize).toBe(3);
    expect(beats[0]!.license_class).toBe("public-domain-us");
  });

  it("ends a beat when a character who has been speaking leaves, and only then", () => {
    const talk = [sp("A", "a1"), sp("B", "b1"), sp("A", "a2"), sp("B", "b2")];
    const left = chunkScene(scene([...talk, dir("Exit A."), sp("B", "b3"), sp("C", "c1"), sp("B", "b4")]), meta);
    expect(left).toHaveLength(2);
    expect(left[0]!.text.endsWith("[Exit A.]")).toBe(true);
    expect(left[1]!.text.startsWith("B: b3")).toBe(true);
    // D never speaks in the first stretch, so sending D off is not a change of pair.
    const rest = [sp("A", "a3"), sp("B", "b3"), sp("A", "a4"), sp("B", "b4"), sp("A", "a5"), sp("B", "b5")];
    const sent = chunkScene(scene([...talk, dir("Exit D."), ...rest, sp("D", "late"), sp("A", "d1"), sp("D", "d2")]), meta);
    const first = sent[0]!.text;
    expect(first.indexOf("[Exit D.]")).toBeGreaterThan(-1);
    expect(first.indexOf("A: a5")).toBeGreaterThan(first.indexOf("[Exit D.]"));
  });
  it("reads an exit with nobody named as the last speaker leaving", () => {
    const beats = chunkScene(scene([sp("A", "a1"), sp("B", "b1"), sp("A", "a2"), sp("B", "b2"), dir("She goes out by the door."), sp("B", "b3"), sp("C", "c1"), sp("B", "b4")]), meta);
    expect(beats).toHaveLength(2);
    expect(beats[0]!.text.endsWith("[She goes out by the door.]")).toBe(true);
  });
  it("hands a trailing aside to the speech it belongs to when the cut is a seam", () => {
    const pair = [sp("A", "a1"), sp("B", "b1"), sp("A", "a2"), sp("B", "b2")];
    const beats = chunkScene(scene([...pair, dir("Aside."), sp("C", "c1"), sp("A", "a3"), sp("C", "c2")]), meta);
    expect(beats).toHaveLength(2);
    expect(beats[0]!.text).not.toContain("[Aside.]");
    expect(beats[1]!.text.startsWith("[Aside.]\nC: c1")).toBe(true);
  });
  it("keeps a closing action with the beat it ends instead of handing it on", () => {
    const beats = chunkScene(scene([sp("A", "a1"), sp("B", "b1"), sp("A", "a2"), sp("B", "b2"), dir("Slaps him."), sp("B", "ah"), sp("A", "x"), sp("B", "y"), sp("A", "z")]), meta);
    expect(beats[0]!.text).toContain("[Slaps him.]");
    expect(beats[0]!.text.endsWith("B: ah")).toBe(true);
  });
  it("gives a monologue its own beat, closed after the reply it gets", () => {
    const long = "word ".repeat(200);
    const beats = chunkScene(scene([sp("A", "a1"), sp("B", "b1"), sp("A", "a2"), sp("B", "b2"), sp("A", long), sp("B", "reply"), sp("A", "n1"), sp("B", "n2"), sp("A", "n3")]), meta);
    expect(beats).toHaveLength(3);
    expect(beats[0]!.text).not.toContain("word word");
    expect(beats[1]!.text.startsWith("A: word")).toBe(true);
    expect(beats[1]!.text.endsWith("B: reply")).toBe(true);
    expect(beats[2]!.text).toContain("A: n1");
  });
  it("closes before a fourth distinct speaker even when the recent window would not", () => {
    const beats = chunkScene(scene([sp("A", "1"), sp("B", "2"), sp("C", "3"), sp("A", "4"), sp("D", "5"), sp("A", "6"), sp("D", "7")]), meta, { recentWindow: 2 });
    expect(beats).toHaveLength(2);
    expect(beats[0]!.speakers).toEqual(["A", "B", "C"]);
    expect(beats[1]!.speakers).toEqual(["D", "A"]);
  });
  it("cuts a long exchange between the same two people at the length cap", () => {
    const line = "x".repeat(100);
    const items = Array.from({ length: 40 }, (_, i) => sp(i % 2 ? "B" : "A", line));
    const beats = chunkScene(scene(items), meta);
    expect(beats.length).toBeGreaterThan(2);
    for (const b of beats) expect(b.text.length).toBeLessThanOrEqual(1100 + 2 * 110);
  });
});
