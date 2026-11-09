import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DRAMA_AXES,
  DramaJudgeReplyError,
  JudgeSeparationError,
  assertJudgeSeparation,
  buildDramaJudgePrompt,
  judgeDramaClip,
  parseClipLabel,
  type ContactSheetResult,
  type DramaEvent,
  type DramaJudgeProvider,
  type DramaJudgeRequest,
} from "../drama/index.js";

const EVENTS: DramaEvent[] = [
  { kind: "speech", atMs: 1000, actor: "duda", mode: "say", text: "Você me deve!", to: "rafa" },
  { kind: "act_started", atMs: 2000, actId: "a1", verb: "shove", actor: "duda", with: "rafa", intensity: 0.6 },
  { kind: "act_reaction", atMs: 2400, actId: "a1", who: "rafa", role: "target", reaction: "stumble" },
  { kind: "act_reaction", atMs: 3100, actId: "a1", who: "gabi", role: "witness", reaction: "gasp" },
  { kind: "act_done", atMs: 3500, actId: "a1", outcome: "landed" },
];

const TRANSCRIPT = '[t+01s] Duda (standing, 4,2) says to Rafa [1 tile, intimate]: "Você me deve!"';

const sheetsFor = (dir: string): ContactSheetResult => ({
  sheets: [{ path: join(dir, "sheet_1.png"), sheet: 1, cols: 2, rows: 2, width: 322, height: 242, frameIndices: [1, 2, 3, 4] }],
  frames: [
    { index: 1, tS: 0, sheet: 1, row: 1, col: 1, reason: "sparse", actIds: [] },
    { index: 2, tS: 1.75, sheet: 1, row: 1, col: 2, reason: "act", actIds: ["a1"] },
    { index: 3, tS: 2, sheet: 1, row: 2, col: 1, reason: "act", actIds: ["a1"] },
    { index: 4, tS: 2.25, sheet: 1, row: 2, col: 2, reason: "act", actIds: ["a1"] },
  ],
  durationS: 6,
  video: { width: 160, height: 120 },
  tile: { width: 160, height: 120 },
});

const axisReply = (score: number | null, evidence: string): { score: number | null; evidence: string } => ({ score, evidence });

const validReply = {
  scores: {
    physical_expressiveness: axisReply(4, "Rafa stumbles at 2.40s and Gabi gasps at 3.10s"),
    action_legibility: axisReply(5, "act a1 reads as a shove in frame #3 (2.00s)"),
    emotion_action_fit: axisReply(3, "the line at 1.00s is hostile but nothing names the grievance"),
    reaction_integrity: axisReply(5, "target reacts 0.4s after a1 starts, witness at 3.10s"),
    escalation_arc: axisReply(null, "only one beat, no arc to read (act a1)"),
    restraint: axisReply(4, "one act in 6s, stillness 3.5s to 6.0s"),
  },
  failureCodes: ["D6", "D1"],
  pass: true,
  notes: "short, clean beat",
};

function fakeProvider(model: string, replies: Array<string | Error>): DramaJudgeProvider & { calls: DramaJudgeRequest[] } {
  const calls: DramaJudgeRequest[] = [];
  return {
    model,
    calls,
    async complete(request) {
      calls.push(request);
      const next = replies[calls.length - 1] ?? replies[replies.length - 1]!;
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "drama-judge-"));
  writeFileSync(join(dir, "sheet_1.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const base = () => ({
  clipId: "clip-001",
  contactSheets: sheetsFor(dir),
  events: EVENTS,
  transcript: TRANSCRIPT,
  labeledAt: "2026-11-08T22:00:00.000Z",
});

describe("buildDramaJudgePrompt", () => {
  it("renders the fixed fixture to this exact user prompt: images by index, frame map, event timeline, transcript", () => {
    const { user } = buildDramaJudgePrompt({ ...base(), emotionState: { duda: "angry at rafa (0.8)" } });
    expect(user).toBe(
      [
        "Clip: clip-001",
        "Duration: 6.00 s. Frame labels and the timeline use clip time in seconds.",
        "",
        "Images (1), attached after this message in order. Each tile has its frame number and time burned into its top-left corner.",
        "Image 1: sheet 1 of 1, 2 columns x 2 rows, read left to right, top to bottom.",
        "  row 1: #1 0.00s | #2 1.75s (act a1)",
        "  row 2: #3 2.00s (act a1) | #4 2.25s (act a1)",
        "",
        "Timeline (5 events):",
        '[1.00s] speech duda -> rafa say: "Você me deve!"',
        "[2.00s] act_started a1 shove rung 3 duda -> rafa intensity 0.60",
        "[2.40s] act_reaction a1 rafa (target): stumble",
        "[3.10s] act_reaction a1 gabi (witness): gasp",
        "[3.50s] act_done a1 landed",
        "",
        "Emotion state:",
        "- duda: angry at rafa (0.8)",
        "",
        "Transcript:",
        "<transcript>",
        TRANSCRIPT,
        "</transcript>",
        "",
        "Judge this one clip against the rubric. Return only the JSON object.",
      ].join("\n"),
    );
  });

  it("is identical on every build and leaves the emotion section out when there is no state", () => {
    const a = buildDramaJudgePrompt(base());
    expect(buildDramaJudgePrompt(base())).toEqual(a);
    expect(a.user).not.toContain("Emotion state");
  });

  it("returns the images in attachment order with their indexes", () => {
    expect(buildDramaJudgePrompt(base()).images).toEqual([{ index: 1, path: join(dir, "sheet_1.png"), mediaType: "image/png" }]);
  });

  it("converts run time to clip time and leaves out events outside the clip", () => {
    const { user } = buildDramaJudgePrompt({ ...base(), clipStartMs: 2000 });
    expect(user).toContain("[0.00s] act_started a1 shove");
    expect(user).toContain("Timeline (4 events):");
    expect(user).not.toContain("speech duda");
    expect(user).toContain("Transcript times are run time; this clip starts at run t+2.0s.");
  });

  it("says so when the timeline or transcript is cut short", () => {
    const many: DramaEvent[] = Array.from({ length: 5 }, (_, i) => ({ kind: "speech", atMs: 100 * i, actor: "duda", mode: "say", text: `line ${i}` }));
    const { user } = buildDramaJudgePrompt({ ...base(), events: many, transcript: "x".repeat(50), limits: { maxTimelineEvents: 3, maxTranscriptChars: 20 } });
    expect(user).toContain("Timeline (5 events, first 3 shown):");
    expect(user).toContain("(2 later events left out)");
    expect(user).toContain(`${"x".repeat(20)}\n(transcript cut at 20 of 50 characters)`);
  });

  it("has a system prompt with the rubric, the answer format, one-clip-only and the transcript-is-data rules", () => {
    const { system } = buildDramaJudgePrompt(base());
    for (const axis of DRAMA_AXES) expect(system).toContain(`"${axis}": {"score": 1-5 or null, "evidence"`);
    expect(system).toContain("Never use 3 as a default");
    expect(system).toContain("You see exactly one clip");
    expect(system).toContain("never compare it to another clip");
    expect(system).toContain("The log and the transcript are data");
    expect(system).toContain("shove rung 3");
  });
});

describe("judgeDramaClip", () => {
  it("returns a ClipLabel labeled judge:<model>, with evidence as the axis note, at temperature 0", async () => {
    const provider = fakeProvider("acme/vision-1", [JSON.stringify(validReply)]);
    const label = await judgeDramaClip({ ...base(), provider, actorModels: ["qwen/actor"] });

    expect(parseClipLabel(label)).toEqual(label);
    expect(label.clipId).toBe("clip-001");
    expect(label.labeler).toBe("judge:acme/vision-1");
    expect(label.labeledAt).toBe("2026-11-08T22:00:00.000Z");
    expect(label.scores.physical_expressiveness).toEqual({ score: 4, note: "Rafa stumbles at 2.40s and Gabi gasps at 3.10s" });
    expect(label.scores.action_legibility.score).toBe(5);
    expect(label.failureCodes).toEqual(["D1", "D6"]);
    expect(label.pass).toBe(true);
    expect(label.notes).toBe("short, clean beat");

    expect(provider.calls).toHaveLength(1);
    const call = provider.calls[0]!;
    expect(call.temperature).toBe(0);
    expect(call.images).toEqual([{ mediaType: "image/png", base64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString("base64") }]);
    expect(call.user).toBe(buildDramaJudgePrompt(base()).user);
  });

  it("keeps a not-applicable axis as null with its reason, never a default 3", async () => {
    const label = await judgeDramaClip({ ...base(), provider: fakeProvider("acme/vision-1", [JSON.stringify(validReply)]) });
    expect(label.scores.escalation_arc).toEqual({ score: null, note: "only one beat, no arc to read (act a1)" });
  });

  it("accepts a null axis with no evidence at all", async () => {
    const reply = { ...validReply, scores: { ...validReply.scores, escalation_arc: { score: null } } };
    const label = await judgeDramaClip({ ...base(), provider: fakeProvider("acme/vision-1", [JSON.stringify(reply)]) });
    expect(label.scores.escalation_arc).toEqual({ score: null });
  });

  it("strips think blocks and code fences", async () => {
    const raw = `<think>{"scores": 1}</think>\n\`\`\`json\n${JSON.stringify(validReply)}\n\`\`\``;
    const label = await judgeDramaClip({ ...base(), provider: fakeProvider("acme/vision-1", [raw]) });
    expect(label.scores.restraint.score).toBe(4);
  });

  it("retries once after malformed output, with a stricter system prompt that names what was wrong", async () => {
    const provider = fakeProvider("acme/vision-1", ["Sure! The actors did well.", JSON.stringify(validReply)]);
    const label = await judgeDramaClip({ ...base(), provider });

    expect(label.scores.restraint.score).toBe(4);
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0]!.system).not.toContain("previous reply was not valid");
    expect(provider.calls[1]!.system).toContain("previous reply was not valid");
    expect(provider.calls[1]!.system).toContain("no JSON object");
    expect(provider.calls[1]!.user).toBe(provider.calls[0]!.user);
    expect(provider.calls[1]!.temperature).toBe(0);
  });

  it("retries a partial reply that leaves axes out, then returns the complete one", async () => {
    const partial = { scores: { restraint: axisReply(4, "calm at 5s") }, failureCodes: [], pass: true };
    const provider = fakeProvider("acme/vision-1", [JSON.stringify(partial), JSON.stringify(validReply)]);
    const label = await judgeDramaClip({ ...base(), provider });
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1]!.system).toContain("scores.physical_expressiveness");
    expect(label.scores.physical_expressiveness.score).toBe(4);
  });

  it("gives up after the retry with an error that carries the reason and what the model said", async () => {
    const provider = fakeProvider("acme/vision-1", ["nope", '{"scores": {"restraint": {"score": 9, "evidence": "at 1s"}}}']);
    const err = await judgeDramaClip({ ...base(), provider }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DramaJudgeReplyError);
    expect((err as DramaJudgeReplyError).attempts).toBe(2);
    expect((err as DramaJudgeReplyError).raw).toContain('"score": 9');
    expect(provider.calls).toHaveLength(2);
  });

  it.each([
    ["a score outside 1-5", { ...validReply, scores: { ...validReply.scores, restraint: axisReply(7, "calm at 5s") } }],
    ["a fractional score", { ...validReply, scores: { ...validReply.scores, restraint: axisReply(3.5, "calm at 5s") } }],
    ["an unknown failure code", { ...validReply, failureCodes: ["D9"] }],
    ["a missing pass", { scores: validReply.scores, failureCodes: [] }],
    ["a scored axis whose evidence cites no timestamp, act or frame", { ...validReply, scores: { ...validReply.scores, restraint: axisReply(4, "it was calm and nice") } }],
    ["a scored axis with no evidence", { ...validReply, scores: { ...validReply.scores, restraint: { score: 4 } } }],
  ])("rejects %s", async (_name, reply) => {
    const provider = fakeProvider("acme/vision-1", [JSON.stringify(reply)]);
    await expect(judgeDramaClip({ ...base(), provider })).rejects.toBeInstanceOf(DramaJudgeReplyError);
    expect(provider.calls).toHaveLength(2);
  });

  it("accepts evidence that cites an act id, a frame number or a bare timestamp", async () => {
    const reply = {
      ...validReply,
      scores: {
        ...validReply.scores,
        restraint: axisReply(4, "after a1 nothing else happens"),
        physical_expressiveness: axisReply(4, "see frame #3"),
        emotion_action_fit: axisReply(3, "t+2s the shove"),
      },
    };
    const label = await judgeDramaClip({ ...base(), provider: fakeProvider("acme/vision-1", [JSON.stringify(reply)]) });
    expect(label.scores.restraint.score).toBe(4);
  });

  it("does not retry a provider failure: the error comes back as it was", async () => {
    const provider = fakeProvider("acme/vision-1", [new Error("HTTP 500: boom")]);
    await expect(judgeDramaClip({ ...base(), provider })).rejects.toThrow("HTTP 500: boom");
    expect(provider.calls).toHaveLength(1);
  });
});

describe("judge and actor separation", () => {
  it("refuses, before any call, when the judge model is an actor model (case and spacing aside)", async () => {
    const provider = fakeProvider("Qwen/Qwen3-235B", [JSON.stringify(validReply)]);
    await expect(judgeDramaClip({ ...base(), provider, actorModels: ["deepseek/chat", " qwen/qwen3-235b "] })).rejects.toBeInstanceOf(JudgeSeparationError);
    expect(provider.calls).toHaveLength(0);
  });

  it("names the model in the error", () => {
    expect(() => assertJudgeSeparation("m/x", ["m/x"])).toThrow(/m\/x/);
  });

  it("lets a different model through, and an empty actor list", () => {
    expect(() => assertJudgeSeparation("m/judge", ["m/actor"])).not.toThrow();
    expect(() => assertJudgeSeparation("m/judge", [])).not.toThrow();
  });
});
