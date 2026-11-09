import { afterEach, describe, expect, it } from "vitest";
import { HashEmbedder } from "../embed.js";
import { createReferenceQuery, queryReferenceBeats, toPlanRefs } from "../query.js";
import { Store } from "../store.js";
import type { Beat, TaggedBeat } from "../types.js";

const emb = new HashEmbedder();
let store: Store;
afterEach(() => store?.close());

function mk(id: string, text: string, tactic: string, action: TaggedBeat["tag"]["action_type"], castSize: number, extra: Partial<TaggedBeat> = {}): TaggedBeat {
  const base: Beat = { id, sourceId: "s", title: "Play", author: "Anon", language: "en", medium: "THEATRE", act: "5", scene: "2", index: 1, speakers: ["A", "B"], castSize, text, directions: [], actionHint: action, license_class: "public-domain-us" };
  return { ...base, ...extra, tag: { id, tactic_verb: tactic, status_delta: "HIGH_TO_LOW", action_type: action, emotion: "anger", driver: "A", target: "B", confidence: 0.9, boundary_ok: true, tagged_by: "t" } };
}

async function fill(beats: TaggedBeat[]) {
  store = new Store(":memory:");
  const vecs = await emb.embedDocuments(beats.map((b) => `${b.tag.tactic_verb}; ${b.tag.action_type}. ${b.text}`));
  store.upsert(beats.map((beat, i) => ({ beat, vec: vecs[i]!, embedModel: emb.id })));
}

describe("queryReferenceBeats", () => {
  it("filters by action tag, accepts the plan's NONE, and ranks the exact tactic first", async () => {
    await fill([
      mk("k1", "He draws and ends her. She falls dead and he weeps.", "to punish", "KILLING", 3),
      mk("k2", "A threat in the dark. He kills the guard.", "to threaten", "KILLING", 3),
      mk("d1", "A quiet talk about money.", "to negotiate", "DIALOGUE_ONLY", 3),
      mk("s1", "She kisses him once.", "to seduce", "KISSING", 3),
    ]);
    const r = await queryReferenceBeats(store, emb, "to threaten", "KILLING", 3);
    expect(r.map((x) => x.id)).toEqual(["k2", "k1"]);
    const none = await queryReferenceBeats(store, emb, "to negotiate", "NONE", 3);
    expect(none.map((x) => x.id)).toEqual(["d1"]);
  });
  it("prefers the nearer cast size", async () => {
    await fill([mk("near", "he kills", "to kill", "KILLING", 3), mk("far", "he kills", "to kill", "KILLING", 5), mk("out", "he kills", "to kill", "KILLING", 9)]);
    const r = await queryReferenceBeats(store, emb, "to kill", "KILLING", 3);
    expect(r.map((x) => x.id)).toEqual(["near", "far", "out"]);
    expect((await queryReferenceBeats(store, emb, "to kill", "KILLING", 3, { limit: 2 })).map((x) => x.id)).toEqual(["near", "far"]);
  });
  it("widens the cast window when the first one holds too few beats", async () => {
    await fill([mk("a", "he kills", "to kill", "KILLING", 3), mk("b", "he kills", "to kill", "KILLING", 8), mk("c", "he kills", "to kill", "KILLING", 12)]);
    const r = await queryReferenceBeats(store, emb, "to kill", "KILLING", 3, { limit: 3 });
    expect(r.map((x) => x.id)).toEqual(["a", "b", "c"]);
    const narrow = await queryReferenceBeats(store, emb, "to kill", "KILLING", 3, { limit: 1 });
    expect(narrow.map((x) => x.id)).toEqual(["a"]);
  });
  it("returns the text only when asked, and plan refs never carry it", async () => {
    await fill([mk("k1", "He kills her. ".repeat(200), "to kill", "KILLING", 3)]);
    const bare = await queryReferenceBeats(store, emb, "to kill", "KILLING", 3);
    expect(bare[0]).not.toHaveProperty("excerpt");
    const withText = await queryReferenceBeats(store, emb, "to kill", "KILLING", 3, { includeText: true, maxChars: 100 });
    expect(withText[0]!.excerpt!.length).toBeLessThan(120);
    expect(JSON.stringify(toPlanRefs(withText))).not.toContain("excerpt");
    expect(toPlanRefs(withText)[0]).toMatchObject({ id: "k1", action_type: "KILLING", license_class: "public-domain-us" });
  });
  it("filters by language and medium, ignores vectors from another embedder, and rejects an unknown tag", async () => {
    await fill([mk("en", "he kills", "to kill", "KILLING", 3), mk("pt", "ele mata", "to kill", "KILLING", 3, { language: "pt" })]);
    expect((await queryReferenceBeats(store, emb, "to kill", "KILLING", 3, { language: "pt" })).map((x) => x.id)).toEqual(["pt"]);
    expect(await queryReferenceBeats(store, emb, "to kill", "KILLING", 3, { medium: "CINEMA" })).toEqual([]);
    const other = Object.create(emb, { id: { value: "other-model" } }) as HashEmbedder;
    expect(await queryReferenceBeats(store, other, "to kill", "KILLING", 3)).toEqual([]);
    await expect(queryReferenceBeats(store, emb, "to kill", "STABBING", 3)).rejects.toThrow(/unknown action tag/);
  });
  it("binds to the three-argument shape from the spec", async () => {
    await fill([mk("k1", "he kills", "to kill", "KILLING", 3)]);
    const q = createReferenceQuery(store, emb);
    expect((await q("to kill", "KILLING", 3)).length).toBe(1);
  });
  it("reports stats", async () => {
    await fill([mk("k1", "he kills", "to kill", "KILLING", 3), mk("d1", "talk", "to explain", "DIALOGUE_ONLY", 3)]);
    expect(store.stats()).toMatchObject({ total: 2, by_action: { KILLING: 1, DIALOGUE_ONLY: 1 }, embed_models: ["hash-256-v1"] });
  });
});
