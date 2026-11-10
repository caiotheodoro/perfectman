import { describe, expect, it } from "vitest";
import { SCRIPT_NORMS } from "@perfectman/shared";
import { SceneRecorder } from "../run/scene-recorder.js";

describe("scene recorder: what a body does", () => {
  it("records a walk, a sit or a gesture as a move: an event for the spine's 'any', never a major one", () => {
    const rec = new SceneRecorder(["ana", "bia"]);
    rec.say("ana", "Eu vi o barco na doca.", 1_000);
    rec.act("bia", 2_000);
    rec.act("bia", 3_000, false);
    expect(rec.turns.filter((t) => t.kind === "act").map((t) => t.actKind)).toEqual(["move", "move"]);
    expect(rec.events.any.length).toBeGreaterThanOrEqual(2);
    expect(rec.events.major).toEqual([]);
  });

  it("records an act of the drama director as a major event", () => {
    const rec = new SceneRecorder(["ana", "bia"]);
    rec.act("bia", 2_000, true);
    expect(rec.turns[0]?.actKind).toBe("verb");
    expect(rec.events.major).toEqual([2_000]);
  });

  it("keeps the verb acts in the run's score and replaces the moves with the frame log's", () => {
    const rec = new SceneRecorder(["ana", "bia"]);
    rec.say("ana", "Eu vi o barco na doca.", 1_000);
    rec.act("bia", 2_000);
    rec.act("bia", 3_000, true);
    rec.say("bia", "O barco já saiu faz tempo.", 4_000);
    const s = rec.score({ norms: SCRIPT_NORMS, language: "pt", medium: "THEATRE", frames: [], startedAt: 0 });
    expect(s.stats.actTurns).toBe(1);
    expect(s.stats.progress.events.some((e) => e.kind === "act")).toBe(true);
    expect(s.stats.progress.moves).toBe(0);
  });
});

