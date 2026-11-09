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
});
