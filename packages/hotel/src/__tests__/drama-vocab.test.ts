import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import {
  ACT_HIT_STOP_MS,
  ACT_INTENSITY,
  ACT_ORIGINS,
  ACT_TARGET_MODE,
  ACT_VERBS,
  KNOWN_ACT_VERBS,
  BLOCKED_REASON_CODES,
  BodyActSchema,
  LADDER_VERBS,
  PHYSICAL_VERBS,
  impactClassOf,
  ladderRung,
} from "@perfectman/shared";
import { SFX_CANONICAL, SFX_ALIASES } from "../director/cue-vocab.generated.js";
import { VERB_IDS, VERB_VOCAB_REV, VERB_VOCAB_SHA256, VERB_VOCAB_VERSION, VOCAB_CONSTANTS, VOCAB_ENUMS } from "../director/verb-vocab.generated.js";
import { canonicalSfx } from "../director/cine/cue-vocab.js";
import { schemaEnum } from "../testing/frame-schema.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = join(HERE, "../../schema");
const bytes = readFileSync(join(SCHEMA_DIR, "verb-vocab.json"));
type Step = { t: { a: string; ms: number; hs?: boolean; stagger?: boolean }; p: string; face?: string; on?: string; anchor?: string; action?: string; cue?: string };
type Roles = Record<string, Step[]>;
type Verb = { id: string; gates: unknown; rung: number | null; target: "required" | "none"; timeline: { contact_at_ms: number }; roles: Roles; intensity: { default: number; class: { min: string; max: string } | null } };
type Profile = { timeout: string; hold: Roles; dodge: Roles; push_back: Roles };
type Vocab = {
  version: number;
  rev: number;
  enums: Record<string, string[]>;
  constants: Record<string, unknown>;
  table_schema: { $defs: Record<string, unknown> };
  verbs: Record<string, Verb>;
  consent_profiles: Record<string, Profile>;
};
const vocab = JSON.parse(bytes.toString("utf8")) as Vocab & Record<string, unknown>;

/** The members of `expected` that `actual` lacks and the other way round, as readable strings; empty when equal as ordered lists. */
function diffIds(expected: readonly string[], actual: readonly string[]): string[] {
  if (JSON.stringify(expected) === JSON.stringify(actual)) return [];
  return [...expected.filter((x) => !actual.includes(x)).map((x) => `-${x}`), ...actual.filter((x) => !expected.includes(x)).map((x) => `+${x}`), "order or count differs"];
}

const subject = (role: string, s: Step): string | undefined => (s.p === "cue" ? s.on : s.p === "overlay" ? s.anchor : role);
const isCompanion = (s: Step): boolean => ["cue", "posture", "effect", "overlay"].includes(s.p) || (s.p === "gesture" && s.action === "sign");

/** TBL-14: a non-neutral expression needs a face-free companion on the same subject, at the same instant within 100 ms (T0 is `Tc - contact_at_ms`). */
function faceArtDependents(roles: Roles, contactAtMs: number): string[] {
  const at = (s: Step): { anchor: string; ms: number } => {
    const base = s.t.a === "T0" ? -contactAtMs : s.t.a === "Tc" ? 0 : undefined;
    return base === undefined ? { anchor: s.t.a, ms: s.t.ms } : { anchor: "Tc", ms: base + s.t.ms };
  };
  const all = Object.entries(roles).flatMap(([role, steps]) => steps.map((s) => ({ role, s })));
  return all
    .filter(({ s }) => s.p === "expression" && s.face !== "neutral")
    .filter(({ role, s }) => !all.some((c) => isCompanion(c.s) && subject(c.role, c.s) === subject(role, s) && at(c.s).anchor === at(s).anchor && Math.abs(at(c.s).ms - at(s).ms) <= 100))
    .map(({ role, s }) => `${role}:${s.face}@${s.t.a}${s.t.ms}`);
}

describe("verb-vocab: the vendored table", () => {
  it("[VV-1] sits beside cue-vocab.json and carries an integer version and rev", () => {
    expect(Number.isInteger(vocab.version) && Number.isInteger(vocab.rev)).toBe(true);
    expect(Object.keys(vocab.verbs)).toHaveLength(18);
    expect(VERB_VOCAB_VERSION).toBe(vocab.version);
    expect(VERB_VOCAB_REV).toBe(vocab.rev);
  });

  it("verb-vocab: sha is pinned [VV-4] [VV-3]", () => {
    const sha = createHash("sha256").update(bytes).digest("hex");
    const source = readFileSync(join(SCHEMA_DIR, "SOURCE.md"), "utf8");
    const pinned = /Pinned sha256 of the bytes of `verb-vocab\.json`: `([0-9a-f]{64})`/.exec(source)?.[1];
    expect(pinned).toBe(sha);
    expect(VERB_VOCAB_SHA256).toBe(sha);
  });
});

describe("verb-vocab: matches the generated ids", () => {
  it("[VV-4] [ACT-6] the verb ids are the same list in the table, the generated ids, the TypeScript union, the wire enum and BodyIntentSchema", () => {
    expect(diffIds(vocab.enums["verbs"] ?? [], VERB_IDS)).toEqual([]);
    expect(diffIds(vocab.enums["verbs"] ?? [], ACT_VERBS)).toEqual([]);
    expect(diffIds(vocab.enums["verbs"] ?? [], schemaEnum("Verb"))).toEqual([]);
    // BodyIntentSchema takes exactly the table's verbs: one the table lacks (a KNOWN verb the next table adds) is refused until it is generated in.
    for (const id of KNOWN_ACT_VERBS) expect(BodyActSchema.safeParse({ verb: id }).success, id).toBe((vocab.enums["verbs"] ?? []).includes(id));
    expect(diffIds(vocab.enums["verbs"] ?? [], Object.keys(vocab.verbs))).toEqual([]);
  });

  it("[VV-2] a verb id that differs between the table and the TypeScript union is reported", () => {
    expect(diffIds(["slap", "kill"], ["slap", "murder"])).toEqual(["-kill", "+murder", "order or count differs"]);
    expect(diffIds(ACT_VERBS, [...ACT_VERBS].reverse())).toEqual(["order or count differs"]);
    expect(diffIds(ACT_VERBS, ACT_VERBS.slice(1))).toContain("-glare");
  });

  it("[VV-4] the enums of the contract are the same in the table, the wire schema and the TypeScript constants", () => {
    expect(diffIds(VOCAB_ENUMS.blocked_reasons, schemaEnum("BlockedReason"))).toEqual([]);
    // The hotel's `act_done.reason` is one enum, `ActReason`: the blocked reasons, then the abort reasons the blocked ones do not already name.
    const abortOnly = VOCAB_ENUMS.abort_reasons.filter((r) => !(VOCAB_ENUMS.blocked_reasons as readonly string[]).includes(r));
    expect(diffIds([...VOCAB_ENUMS.blocked_reasons, ...abortOnly], schemaEnum("ActReason"))).toEqual([]);
    expect(diffIds(VOCAB_ENUMS.outcomes, schemaEnum("Outcome2"))).toEqual([]);
    expect(diffIds(VOCAB_ENUMS.chip_answers, schemaEnum("ChipAnswer"))).toEqual([]);
    expect(diffIds(VOCAB_ENUMS.origins, schemaEnum("Origin"))).toEqual([]);
    expect(diffIds(VOCAB_ENUMS.origins, ACT_ORIGINS)).toEqual([]);
    expect(diffIds(VOCAB_ENUMS.impact_classes, schemaEnum("ImpactClass"))).toEqual([]);
    expect(diffIds(VOCAB_ENUMS.ladder, LADDER_VERBS)).toEqual([]);
    expect(diffIds(VOCAB_ENUMS.physical, PHYSICAL_VERBS)).toEqual([]);
    for (const reason of VOCAB_ENUMS.blocked_reasons) expect(BLOCKED_REASON_CODES, reason).toContain(reason);
    for (const code of VOCAB_ENUMS.new_act_error_codes) expect(schemaEnum("ActorErrorCode"), code).toContain(code);
    for (const code of VOCAB_ENUMS.act_error_codes) expect(schemaEnum("ActorErrorCode"), code).toContain(code);
  });

  it("[VV-4] the target mode, rung and intensity of every verb are the same in the table and the TypeScript tables", () => {
    for (const [id, v] of Object.entries(vocab.verbs)) {
      const verb = id as (typeof ACT_VERBS)[number];
      expect(ACT_TARGET_MODE[verb], id).toBe(v.target);
      expect(ladderRung(verb) ?? null, id).toBe(v.rung);
      expect(ACT_INTENSITY[verb], id).toEqual(v.intensity);
    }
  });

  it("[VV-4] the generated constants are the table's, and the ones the sidecar leans on are the contract's section 0.3 numbers", () => {
    expect(VOCAB_CONSTANTS).toEqual(vocab.constants);
    expect(VOCAB_CONSTANTS).toMatchObject({
      chip_ttl_ms: 4000,
      chip_windup_ms: 150,
      chip_cooldown_ms: 60000,
      target_deadline_ms: 1500,
      witness_deadline_ms: 3000,
      earshot_tiles: 6,
      physical_spacing_ms: 20000,
      kills_per_scene: 1,
      same_verb_target_cooldown_ms: 60000,
      scene_min_age_ms: 20000,
      act_id_pattern: "^[A-Za-z0-9_.:-]{1,32}$",
      text_max_chars: 200,
    });
  });
});

describe("verb-vocab: the cue vocabulary, version 2", () => {
  it("[VV-5] lists the five new sounds as canonical names and resolves their aliases", () => {
    for (const name of VOCAB_ENUMS.new_sfx) {
      expect(SFX_CANONICAL, name).toContain(name);
      expect(canonicalSfx(name), name).toBe(name);
    }
    expect(canonicalSfx("smack")).toBe("slap");
    expect(canonicalSfx("thump")).toBe("thud");
    expect(canonicalSfx("swish_short")).toBe("whoosh_short");
    expect(Object.values(SFX_ALIASES).every((c) => (SFX_CANONICAL as readonly string[]).includes(c))).toBe(true);
  });

  it("[VV-5] every sound a table step plays is canonical", () => {
    const played = Object.values(vocab.verbs)
      .flatMap((v) => Object.values(v.roles).flat())
      .filter((s) => s.p === "sfx")
      .map((s) => s.cue ?? "");
    expect(played.length).toBeGreaterThan(5);
    for (const cue of played) expect(SFX_CANONICAL as readonly string[], cue).toContain(cue);
  });
});

describe("verb-vocab: the table checks of the contract, run over the JSON", () => {
  const ajv = new Ajv({ strict: false, allErrors: true });
  const checkVerb = ajv.compile(vocab.table_schema);
  const checkProfile = ajv.compile({ $ref: "#/$defs/profile", $defs: vocab.table_schema.$defs });

  it("[TBL-1] every verb validates against the root of table_schema and every consent profile against $defs.profile", () => {
    for (const [id, v] of Object.entries(vocab.verbs)) expect(checkVerb(v), `${id}: ${ajv.errorsText(checkVerb.errors)}`).toBe(true);
    for (const [id, p] of Object.entries(vocab.consent_profiles)) expect(checkProfile(p), `${id}: ${ajv.errorsText(checkProfile.errors)}`).toBe(true);
  });

  it("[TBL-1] a verb with a damaged step, a missing gate block or an unknown primitive fails", () => {
    const slap = vocab.verbs["slap"]!;
    const damaged = structuredClone(slap);
    damaged.roles["actor"]![0]!.p = "teleport";
    expect(checkVerb(damaged)).toBe(false);
    const { gates: _g, ...noGates } = slap;
    expect(checkVerb(noGates)).toBe(false);
  });

  it("verb-vocab: every step time is valid [TBL-2]", () => {
    const check = (roles: Roles, contactAtMs: number): string[] =>
      Object.values(roles).flat().flatMap((s) => {
        if (s.t.ms >= 0) return [];
        return s.t.a === "Tc" && s.t.ms >= -contactAtMs ? [] : [`${s.p}@${s.t.a}${s.t.ms}`];
      });
    for (const [id, v] of Object.entries(vocab.verbs)) expect(check(v.roles, v.timeline.contact_at_ms), id).toEqual([]);
    for (const [id, p] of Object.entries(vocab.consent_profiles)) for (const list of [p.hold, p.dodge, p.push_back]) expect(check(list, 0), id).toEqual([]);
    expect(check({ actor: [{ t: { a: "Tc", ms: -301 }, p: "face" }] }, 300)).toEqual(["face@Tc-301"]);
    expect(check({ actor: [{ t: { a: "T0", ms: -1 }, p: "face" }] }, 300)).toEqual(["face@T0-1"]);
  });

  it("[TBL-4] the class bounds and hit-stops of the table are the TypeScript constant", () => {
    const hitStop = VOCAB_CONSTANTS.hit_stop_ms;
    expect(hitStop).toEqual(ACT_HIT_STOP_MS);
    expect(VOCAB_CONSTANTS.class_bounds).toEqual({ L_below: 0.34, M_to_inclusive: 0.67 });
    for (const [id, v] of Object.entries(vocab.verbs)) {
      const verb = id as (typeof ACT_VERBS)[number];
      expect(impactClassOf(verb, v.intensity.default), id).toBe(v.intensity.class ? impactClassOf(verb) : undefined);
    }
  });

  it("[TBL-5] the hit-stops are the contract's 50, 100, 150 and 175 ms", () => {
    expect(VOCAB_CONSTANTS.hit_stop_ms).toEqual({ L: 50, M: 100, H: 150, F: 175 });
  });

  it("verb-vocab: no verb depends on face art [TBL-14]", () => {
    for (const [id, v] of Object.entries(vocab.verbs)) expect(faceArtDependents(v.roles, v.timeline.contact_at_ms), id).toEqual([]);
    for (const [id, p] of Object.entries(vocab.consent_profiles)) for (const list of [p.hold, p.dodge, p.push_back]) expect(faceArtDependents(list, 0), id).toEqual([]);
  });

  it("[TBL-14] the check fails when a companion cue is removed", () => {
    const withoutCues = (roles: Roles): Roles => Object.fromEntries(Object.entries(roles).map(([role, steps]) => [role, steps.filter((s) => s.p !== "cue")]));
    const recoil = vocab.verbs["recoil"]!;
    expect(faceArtDependents(recoil.roles, 0)).toEqual([]);
    expect(faceArtDependents(withoutCues(recoil.roles), 0)).toEqual(["actor:surprised@Tc0"]);
    const hold = vocab.consent_profiles["violent_chip"]!.hold;
    expect(faceArtDependents(hold, 0)).toEqual([]);
    expect(faceArtDependents(withoutCues(hold), 0)).toEqual(["actor:angry@T00"]);
  });
});
