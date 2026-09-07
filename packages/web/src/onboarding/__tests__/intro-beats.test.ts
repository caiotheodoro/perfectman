/**
 * The intro is six hand-written beats played through the same stage a run
 * uses, so it must produce the same shape a run produces.
 */
import { describe, expect, it } from "vitest";
import { INTRO_BEATS, INTRO_CAST, introRun } from "../intro-script.js";

describe("introRun", () => {
  const run = introRun();

  it("has one beat per scripted moment, in order", () => {
    expect(run.beats).toHaveLength(6);
    expect(run.beats.map((b) => b.actorId)).toEqual(INTRO_BEATS.map((b) => INTRO_CAST[b.actor]));
  });

  it("keeps canonical cast IDs consistent with presets while preserving authored names", () => {
    expect(run.agents).toEqual([
      { id: "iris", displayName: "íris" },
      { id: "bruno", displayName: "bruno" },
      { id: "marcela", displayName: "marcela" },
    ]);
  });

  it("stages a line as speech and a private thought as silence", () => {
    expect(run.beats[0]?.kind).toBe("message");
    expect(run.beats[0]?.text).toBe(INTRO_BEATS[0]!.line);
    const quiet = run.beats.find((b) => b.kind === "silence");
    expect(quiet?.thought?.text).toBe(INTRO_BEATS.find((b) => b.thought)!.thought);
    expect(quiet?.text).toBe("");
  });

  it("holds each beat for the scripted time, in seconds", () => {
    expect(run.beats[2]?.duration).toBeCloseTo(INTRO_BEATS[2]!.hold / 1000);
  });

  it("puts the whole cast in one public room with the rest of the room reacting", () => {
    expect(run.channels).toHaveLength(1);
    expect(run.channels[0]?.memberAgentIds).toEqual(run.agents.map((a) => a.id));
    const b = run.beats[1]!;
    const others = run.agents.filter((a) => a.id !== b.actorId).map((a) => a.id);
    expect(Object.keys(b.reactions ?? {}).sort()).toEqual(others.sort());
  });
});
