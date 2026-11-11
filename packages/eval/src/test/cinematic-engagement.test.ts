import { describe, expect, it } from "vitest";
import { SpendMeter } from "../hotel/hotel-judge.js";
import { JudgeSeparationError } from "../drama/drama-judge.js";
import type { DramaJudgeProvider } from "../drama/drama-judge.js";
import { createChatCompletionProvider } from "../drama/judge-provider.js";
import {
  ENGAGEMENT_AXES,
  EngagementReplyError,
  buildDigest,
  buildEngagementSystem,
  createMockEngagementProvider,
  engagementGroup,
  judgeEngagement,
  loadEngagementJudgeConfig,
  loadRunBundle,
  parseEngagementReply,
  scoreBundle,
} from "../cinematic/index.js";
import { goodScene, writeRun } from "./cinematic-fixtures.js";

const bundle = () => loadRunBundle(writeRun(goodScene()));
const reply = (score: number, evidence = "at 1:40 she slaps him") => JSON.stringify({ scores: Object.fromEntries(ENGAGEMENT_AXES.map((a) => [a, { score, evidence }])), notes: "ok" });
const scripted = (replies: string[], model = "judge/strong"): DramaJudgeProvider & { calls: number; systems: string[] } => {
  const p = {
    model,
    calls: 0,
    systems: [] as string[],
    async complete(req: { system: string }) {
      p.systems.push(req.system);
      return replies[Math.min(p.calls++, replies.length - 1)]!;
    },
  };
  return p;
};

describe("engagement: the digest", () => {
  it("is a script a model can read: cast, timestamps, speech, acts with outcome, exits, non-neutral faces", () => {
    const d = buildDigest(bundle());
    expect(d).toContain("Cast: Ana, Bruno, Carla");
    expect(d).toContain("[0:04] ANA: You forged her signature");
    expect(d).toContain("ACT SLAP: Ana -> Bruno (landed");
    expect(d).toContain("EXIT: Bruno leaves");
    expect(d).toMatch(/Ana looks angry/);
    expect(d).not.toMatch(/looks neutral/);
  });

  it("carries none of the scorer's own numbers, so the judge cannot echo them", () => {
    const d = buildDigest(bundle());
    expect(d).not.toMatch(/cinematic|score|climax|deterministic/i);
  });

  it("stays inside the cap by dropping faces first, then thinning plain lines, never acts", () => {
    const b = bundle();
    const full = buildDigest(b);
    const cap = Math.floor(full.length * 0.7);
    const small = buildDigest(b, { maxChars: cap });
    expect(small.length).toBeLessThanOrEqual(cap);
    expect(small).not.toMatch(/looks/);
    expect(small).toContain("ACT SLAP");
    const tiny = buildDigest(b, { maxChars: 1400 });
    expect(tiny.length).toBeLessThanOrEqual(1400 + 60);
    expect(tiny).toContain("ACT SHOVE");
    expect(tiny).toContain("lines omitted");
  });

  it("can be cut to a window of the run (a graded clip)", () => {
    const d = buildDigest(bundle(), { fromS: 140, toS: 200 });
    expect(d).toContain("window 2:20-3:20");
    expect(d).toContain("ACT SLAP");
    expect(d).not.toContain("You forged her signature");
  });
});

describe("engagement: the prompt and the reply", () => {
  it("states the rubric, the data-not-instructions rule and the timestamp rule", () => {
    const s = buildEngagementSystem();
    for (const a of ENGAGEMENT_AXES) expect(s).toContain(`${a}:`);
    expect(s).toMatch(/DATA/);
    expect(s).toMatch(/\[m:ss\]/);
    expect(s).toMatch(/stingy with 5/);
  });

  it("parses a valid reply, with fences and a think block around it", () => {
    const p = parseEngagementReply(`<think>hmm</think>\n\`\`\`json\n${reply(4)}\n\`\`\``);
    expect(p.scores.tension.score).toBe(4);
    expect(p.notes).toBe("ok");
  });

  it("rejects: no object, bad json, a score out of range, a fractional score, a missing axis, evidence with no timestamp", () => {
    expect(() => parseEngagementReply("no json here")).toThrow(/no JSON/);
    expect(() => parseEngagementReply("{ not json }")).toThrow(/valid JSON/);
    expect(() => parseEngagementReply(reply(6))).toThrow();
    expect(() => parseEngagementReply(reply(3.5))).toThrow();
    expect(() => parseEngagementReply(JSON.stringify({ scores: { tension: { score: 3, evidence: "at 0:10 x" } } }))).toThrow();
    expect(() => parseEngagementReply(reply(3, "she slaps him"))).toThrow(/timestamp/);
  });
});

describe("engagement: judging", () => {
  it("turns six 1-5 scores into a 0-100 group, (mean - 1) / 4", async () => {
    const j = await judgeEngagement({ bundle: bundle(), provider: scripted([reply(4)]) });
    expect(j.mean).toBe(4);
    expect(j.score).toBe(75);
    const g = engagementGroup(j);
    expect(g.score).toBe(75);
    expect(g.readings).toHaveLength(6);
    const low = engagementGroup(await judgeEngagement({ bundle: bundle(), provider: scripted([reply(1)]) }));
    expect(low.score).toBe(0);
  });

  it("is deterministic in what it asks: same digest, same hash, temperature 0, one scene per call", async () => {
    const seen: Array<{ temperature: number; user: string; images: readonly unknown[] }> = [];
    const p: DramaJudgeProvider = { model: "judge/strong", async complete(req) { seen.push(req); return reply(3); } };
    const a = await judgeEngagement({ bundle: bundle(), provider: p });
    const b = await judgeEngagement({ bundle: bundle(), provider: p });
    expect(a.digestSha256).toBe(b.digestSha256);
    expect(seen.every((s) => s.temperature === 0 && s.images.length === 0)).toBe(true);
    expect(seen[0]!.user).toBe(seen[1]!.user);
  });

  it("retries once with a stricter system message, then throws instead of inventing a score", async () => {
    const recovers = scripted(["garbage", reply(3)]);
    const ok = await judgeEngagement({ bundle: bundle(), provider: recovers });
    expect(ok.mean).toBe(3);
    expect(recovers.calls).toBe(2);
    expect(recovers.systems[1]).toMatch(/previous reply was not valid/);
    const broken = scripted(["garbage"]);
    await expect(judgeEngagement({ bundle: bundle(), provider: broken })).rejects.toBeInstanceOf(EngagementReplyError);
    expect(broken.calls).toBe(2);
  });

  it("refuses a judge that is one of the actor models, from the run's replay.json or the caller, before any call", async () => {
    const b = bundle();
    expect(b.actorModels).toEqual(["actor-model/a1"]);
    const p = scripted([reply(3)], "Actor-Model/A1 ");
    await expect(judgeEngagement({ bundle: b, provider: p })).rejects.toBeInstanceOf(JudgeSeparationError);
    expect(p.calls).toBe(0);
    await expect(judgeEngagement({ bundle: b, provider: scripted([reply(3)], "x/y"), actorModels: ["x/y"] })).rejects.toBeInstanceOf(JudgeSeparationError);
  });

  it("the mock is deterministic, offline, labelled, and fixed at 3 unless told otherwise", async () => {
    const j = await judgeEngagement({ bundle: bundle(), provider: createMockEngagementProvider(), mock: true });
    expect(j).toMatchObject({ mock: true, mean: 3, score: 50, judge: "mock-judge" });
    const custom = await judgeEngagement({ bundle: bundle(), provider: createMockEngagementProvider({ entertaining: 5, tension: 1 }) });
    expect(custom.scores.entertaining.score).toBe(5);
    expect(custom.scores.tension.score).toBe(1);
    expect(custom.scores.payoff.score).toBe(3);
  });

  it("a group with no judgment is null, so the overall is partial", async () => {
    expect(engagementGroup(null).score).toBeNull();
    const s = await scoreBundle(bundle());
    expect(s.partial).toBe(true);
    expect(s.missing).toEqual(["engagement"]);
    expect(s.weights.engagement).toBeUndefined();
  });
});

describe("engagement: cost cap and config", () => {
  it("defaults the cap to $0.30 a scene and reads CINE_JUDGE_* before DRAMA_JUDGE_*", () => {
    const c = loadEngagementJudgeConfig({ CINE_JUDGE_MODEL: "strong/model", DRAMA_JUDGE_MODEL: "other/model", CINE_JUDGE_API_KEY: "k", CINE_JUDGE_SESSION_HEADER: "x-opencode-session", CINE_JUDGE_BASE_URL: "https://opencode.ai/zen/go/v1" });
    expect(c).toMatchObject({ model: "strong/model", maxUsd: 0.3, apiKey: "k", sessionHeader: "x-opencode-session", baseUrl: "https://opencode.ai/zen/go/v1" });
    expect(loadEngagementJudgeConfig({ DRAMA_JUDGE_MODEL: "m", CINE_JUDGE_MAX_USD: "0.1" }).maxUsd).toBe(0.1);
    expect(loadEngagementJudgeConfig({ CINE_JUDGE_MODEL: "m" }, { maxUsd: 0.05 }).maxUsd).toBe(0.05);
    expect(() => loadEngagementJudgeConfig({})).toThrow(/no judge model/);
  });

  it("the spend meter refuses a call that could cross the cap, before the transport is touched", async () => {
    const config = loadEngagementJudgeConfig({ CINE_JUDGE_MODEL: "unknown/pricey", CINE_JUDGE_API_KEY: "k", CINE_JUDGE_MAX_USD: "0.0001" });
    let transport = 0;
    const provider = createChatCompletionProvider(config, { meter: new SpendMeter(config.maxUsd), complete: async () => (transport++, reply(3)) });
    await expect(judgeEngagement({ bundle: bundle(), provider })).rejects.toThrow(/spend cap reached/);
    expect(transport).toBe(0);
  });

  it("one scene fits well inside the default cap: the worst case of the default digest and reply is under $0.30 at the unknown-model price", async () => {
    const config = loadEngagementJudgeConfig({ CINE_JUDGE_MODEL: "unknown/pricey", CINE_JUDGE_API_KEY: "k" });
    const meter = new SpendMeter(config.maxUsd);
    let sent = 0;
    const provider = createChatCompletionProvider(config, { meter, complete: async () => (sent++, reply(4)) });
    const j = await judgeEngagement({ bundle: bundle(), provider });
    expect(sent).toBe(1);
    expect(j.mean).toBe(4);
    expect(meter.spentUsd).toBeLessThan(0.3);
  });
});
