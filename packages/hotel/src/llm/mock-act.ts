import type { ActVerb, AgentRuntimeInput, BlockedReason, BodyPerception, BodyPersonLine, RelationalState, SocialEmotions } from "@perfectman/shared";
import { LADDER_VERBS } from "@perfectman/shared";

/**
 * The mock model's body acts for a run with drama on (act-contract.md 11.5, verb-bible.md 4): deterministic, read from the
 * actor's own emotion state and from what the scenario's `drama` block lets it do, so the offline stack plays the same
 * telenovela twice. Hostility climbs the ladder one step at a time (glare, insult, shove, slap, punch, and a kill when the
 * scenario lets the victim die), warmth hugs and kisses, shame cries and humiliation faints, a body on the floor is tended,
 * and whoever killed holds a picture. The director still approves or vetoes every proposal; a veto the planner reported
 * (`body.blocked`) tells the next consult to try again or to hold, never to climb past it.
 *
 * Only for a view that carries `drama`; a run without it never reaches this file (the mock then behaves as it always did).
 */

/** What the mock needs of the scenario: its ladder ceiling, who may die (agent refs) and the quirks the tests switch on. */
export type MockDrama = {
  maxRung: number;
  mayDie: readonly string[];
  /** Consults of one actor between two steps of one ladder; default 3. */
  gap?: number;
  /** Every Nth consult proposes a malformed `act` (dropped, the speech kept); absent or 0: never. */
  malformedEvery?: number;
  /** After glare, jump to slap: the director's ladder veto is what a test wants to see. */
  skip?: boolean;
};

type Pair = { rung: number; prev: number; atN: number; held: boolean; jumped: boolean };

/** What one run's mock remembers between consults: each ordered pair's ladder, who it has seen fall, who it has killed. */
export class MockActMemory {
  readonly pairs = new Map<string, Pair>();
  readonly lastAffection = new Map<string, number>();
  readonly seenFallen = new Set<string>();
  readonly killed = new Set<string>();
  readonly done = new Set<string>();
}

const HOT = 0.45;
const WARM = 0.55;
const KISS = 0.75;
const DEFAULT_GAP = 3;

/** Reasons a veto is only about timing or reach: try the same step again. */
const RETRY = new Set<string>(["budget", "cooldown", "too_far", "rate_limit"]);
/** Reasons the pair is not to climb now: wait out a gap and try the same step again, or give up when the scene says no. */
const STOP = new Set<string>(["no_scenario_gate", "consent_off", "calm_room", "kill_switch", "dead_target"]);

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
const round2 = (n: number): number => Math.round(n * 100) / 100;

type Rel = Pick<RelationalState, "resentment" | "envy" | "suspicion" | "affection" | "attraction" | "comfort" | "threat">;

const hostility = (r: Rel | undefined): number => (r ? Math.max(r.resentment, r.envy, r.suspicion * 0.8) : 0);

function lastActBlock(body: BodyPerception): BlockedReason | undefined {
  return body.blocked.find((b) => b.part === "act");
}

/** `act` bodies a careful reader must drop and keep the speech of: unknown verb, a stray key, a missing target, a target that is not a person. */
export function malformedAct(n: number, body: BodyPerception): Record<string, unknown> {
  const person = body.people[0]?.handle ?? "p1";
  const place = body.places[0]?.handle ?? "z1";
  const samples: Array<Record<string, unknown>> = [
    { verb: "shout", target: person },
    { verb: "slap", target: person, force: 1 },
    { verb: "slap" },
    { verb: "hug", target: place },
    { verb: "cry", target: person, intensity: 3 },
  ];
  return { act: samples[n % samples.length] };
}

type Picked = { verb: ActVerb; target?: string; intensity: number };

const body = (p: Picked): Record<string, unknown> => ({ act: { verb: p.verb, ...(p.target ? { target: p.target } : {}), intensity: p.intensity } });

/**
 * One consult's body block, or undefined when the mock proposes nothing this time. `n` is this actor's consult count
 * (1 on its first). Pure given `memory`, which it updates.
 */
export function mockAct(input: AgentRuntimeInput, n: number, drama: MockDrama, memory: MockActMemory): Record<string, unknown> | undefined {
  const view = input.perceptionPacket.body;
  if (!view || view.drama !== true) return undefined;
  const me = input.agentId;
  const handles = input.perceptionPacket.bodyHandles ?? {};
  const social: SocialEmotions = input.emotionalState.socialEmotions;
  const rels = input.emotionalState.relationalStates;
  const gap = drama.gap ?? DEFAULT_GAP;

  if (drama.malformedEvery && n % drama.malformedEvery === 0) return malformedAct(Math.floor(n / drama.malformedEvery), view);

  const people = view.people.flatMap((p: BodyPersonLine) => {
    const t = handles[p.handle];
    return t?.kind === "person" ? [{ line: p, ref: t.ref, rel: rels.get(t.ref) }] : [];
  });

  // What the planner reported about the last proposal moves the ladder back, or holds it.
  const veto = lastActBlock(view);
  if (veto) {
    for (const [key, pair] of memory.pairs) {
      if (!key.startsWith(`${me}>`) || pair.atN !== n - 1) continue;
      if (RETRY.has(veto.code) || veto.code === "ladder") {
        pair.rung = pair.prev;
        pair.atN = n - gap + (veto.code === "ladder" ? 0 : 1);
      } else if (STOP.has(veto.code)) {
        pair.rung = pair.prev;
        pair.held = true;
      }
    }
  }

  // 1. Someone on the floor: tend them if there is love in it, otherwise stand frozen; whoever struck the blow holds a picture.
  for (const { line, ref, rel } of people) {
    if (line.activity !== "fallen") continue;
    const key = `${me}~${ref}`;
    if (memory.done.has(key)) continue;
    memory.done.add(key);
    memory.seenFallen.add(ref);
    if (memory.killed.has(ref)) return body({ verb: "tableau", intensity: 0.6 });
    if (rel && Math.max(rel.affection, rel.comfort) >= 0.25) return body({ verb: "tend_fallen", target: line.handle, intensity: 0.5 });
    return body({ verb: "freeze_gasp", intensity: 0.6 });
  }

  // 2. Hostility toward the person who holds it most, one step up the ladder every `gap` consults.
  const foe = [...people].filter((p) => hostility(p.rel) >= HOT && p.line.activity !== "fallen").sort((a, b) => hostility(b.rel) - hostility(a.rel) || a.ref.localeCompare(b.ref))[0];
  if (foe) {
    const key = `${me}>${foe.ref}`;
    const pair = memory.pairs.get(key) ?? { rung: 0, prev: 0, atN: -gap, held: false, jumped: false };
    memory.pairs.set(key, pair);
    if (!pair.held && n - pair.atN >= gap) {
      const jump = drama.skip === true && !pair.jumped && pair.rung === 1;
      const next = jump ? 4 : pair.rung + 1;
      const allowed = next <= drama.maxRung && (next < 6 || (drama.mayDie.includes(foe.ref) && hostility(foe.rel) >= 0.85));
      if (allowed) {
        const verb = LADDER_VERBS[next - 1] as ActVerb;
        pair.prev = pair.rung;
        pair.rung = next;
        pair.atN = n;
        pair.jumped ||= jump;
        if (verb === "kill") memory.killed.add(foe.ref);
        return body({ verb, target: foe.line.handle, intensity: round2(clamp01(0.3 + 0.12 * next)) });
      }
    }
  }

  // 3. Shame and humiliation: a collapse, then tears.
  if (social.humiliation >= 0.8 && !memory.done.has(`${me}:faint`)) {
    memory.done.add(`${me}:faint`);
    return body({ verb: "faint", intensity: 0.8 });
  }
  if (social.shame >= 0.6 && !memory.done.has(`${me}:cry`)) {
    memory.done.add(`${me}:cry`);
    return body({ verb: "cry", intensity: 0.7 });
  }

  // 4. Warmth: a hug toward the person it feels most for, a kiss when there is attraction too, never twice in a row.
  const dear = [...people].filter((p) => (p.rel?.affection ?? 0) >= WARM && hostility(p.rel) < HOT && p.line.activity !== "fallen").sort((a, b) => (b.rel?.affection ?? 0) - (a.rel?.affection ?? 0) || a.ref.localeCompare(b.ref))[0];
  if (dear) {
    const key = `${me}+${dear.ref}`;
    const last = memory.lastAffection.get(key);
    if (last === undefined || n - last >= gap * 2) {
      memory.lastAffection.set(key, n);
      const kiss = (dear.rel?.attraction ?? 0) >= KISS && (dear.rel?.affection ?? 0) >= 0.7;
      return body({ verb: kiss ? "kiss" : "hug", target: dear.line.handle, intensity: 0.6 });
    }
  }
  return undefined;
}
