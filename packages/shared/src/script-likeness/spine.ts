import { BEAT_CRAFT_MAX_CHARS } from "../kb/slim-render.js";

/**
 * A scene's spine, for a hotel run whose scenario carries no authored beats: four steps of an arc (pressure, first reveal or demand, turn,
 * decision), worked out once when the run starts from what the scenario already says (each person's private objective and what it costs
 * to say it, who contends with whom for the same thing, the situation), with no model call. Each step is a short steering note for one actor, in
 * the scene's language, that names the objective, the obstacle and one tactic verb of the KB's controlled list, and asks for ONE move that
 * changes the other person's position. The notes ride the same feed as the KB's beat craft and show only while their step is current.
 *
 * The arc is gated on what happens, not on the clock alone: a step starts no earlier than its nominal second, and not before the step
 * before it saw its progress event (a new fact for the first, a promise, accusation, reveal, act or reversal for the next two), unless
 * {@link SPINE_HOLD_MS} has passed since its nominal second (or since the step before began, if that was later). Pure and deterministic.
 */

export type SpineLang = "pt-BR" | "en";

export type SpineObjective = {
  description: string;
  scarceResourceId: string;
  constraint?: string | undefined;
  costOfExposure?: string | undefined;
  breakingPoint?: string | undefined;
};
export type SpineActor = { id: string; name: string; objective?: SpineObjective | undefined };
export type SpineInput = { language: SpineLang; situation?: string | undefined; cast: readonly SpineActor[] };

export type SpineKey = "pressure" | "reveal" | "turn" | "decision";
/** What the step before must have seen: any new fact, a move that changes the scene, or nothing (the last step). */
export type SpineNeeds = "any" | "major" | "none";

/** Nominal second of each step, and the progress its successor waits for. */
export const SPINE_STEPS: ReadonlyArray<{ key: SpineKey; atMs: number; needs: SpineNeeds }> = [
  { key: "pressure", atMs: 0, needs: "any" },
  { key: "reveal", atMs: 45_000, needs: "major" },
  { key: "turn", atMs: 90_000, needs: "major" },
  { key: "decision", atMs: 150_000, needs: "none" },
];
/** How long past its nominal second a step waits for the progress event before it starts anyway. */
export const SPINE_HOLD_MS = 40_000;

/**
 * The tactic of each role at each step: verbs of the KB's controlled list (`TACTIC_VERBS`, a kb test pins every one). A holder has what
 * the others want, a challenger wants it, a free actor (no private objective) stirs the scene.
 */
export const SPINE_TACTICS: Readonly<Record<"holder" | "challenger" | "free", readonly [string, string, string, string]>> = {
  challenger: ["to press", "to demand", "to accuse", "to propose"],
  holder: ["to stall", "to deflect", "to confess", "to bargain"],
  free: ["to provoke", "to reveal", "to confront", "to propose"],
};

const VERB_PT: Readonly<Record<string, string>> = {
  "to press": "pressionar",
  "to demand": "exigir de",
  "to accuse": "acusar",
  "to propose": "propor um acordo a",
  "to stall": "enrolar",
  "to deflect": "desviar o assunto de",
  "to confess": "confessar a",
  "to bargain": "negociar com",
  "to provoke": "provocar",
  "to reveal": "revelar algo a",
  "to confront": "confrontar",
};

const verbIn = (verb: string, lang: SpineLang): string => (lang === "pt-BR" ? (VERB_PT[verb] ?? verb.replace(/^to /, "")) : verb.replace(/^to /, ""));

const clip = (text: string, max: number): string => {
  const t = text.replace(/\s+/gu, " ").trim();
  if (Array.from(t).length <= max) return t.replace(/[.;:,\s]+$/u, "");
  const cut = Array.from(t).slice(0, max).join("");
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.5 ? cut.slice(0, at) : cut).replace(/[\s,;:.]+$/u, "")}…`;
};

const HEADS: Record<SpineLang, Record<SpineKey, string>> = {
  "pt-BR": {
    pressure: "A cena, agora: pressão. Ninguém precisa ganhar ainda, mas todo mundo quer algo.",
    reveal: "A cena, agora: o primeiro lance. Uma exigência ou uma revelação que não dá para ignorar.",
    turn: "A cena, agora: a virada. Quem pergunta e quem responde pode trocar de lado; algo que se escondia muda de dono.",
    decision: "A cena, agora: a decisão. Algo precisa ser decidido, aceito ou pago.",
  },
  en: {
    pressure: "The scene, now: pressure. Nobody has to win yet, but everyone wants something.",
    reveal: "The scene, now: the first move. A demand or a revelation that cannot be ignored.",
    turn: "The scene, now: the turn. Who asks and who answers may swap; something that was hidden changes hands.",
    decision: "The scene, now: the decision. Something has to be decided, accepted or paid for.",
  },
};

const LABELS: Record<SpineLang, { objective: string; obstacle: string; tactic: string; move: (target: string) => string }> = {
  "pt-BR": {
    objective: "Objetivo",
    obstacle: "Obstáculo",
    tactic: "Jogada",
    move: (t) => `Faça UMA jogada que mude a posição de ${t}, e só uma.`,
  },
  en: {
    objective: "Aim",
    obstacle: "Obstacle",
    tactic: "Move",
    move: (t) => `Make ONE move that changes ${t}'s position, and only one.`,
  },
};

export type SpineStepPlan = {
  key: SpineKey;
  atMs: number;
  needs: SpineNeeds;
  /** Actor id to the note shown to that actor while this step is current. */
  notes: Record<string, string>;
  /** Actor id to the controlled tactic verb the note names. */
  tactics: Record<string, string>;
};

export type Spine = {
  steps: SpineStepPlan[];
  /** Actor id to the actor id its moves are aimed at. */
  targets: Record<string, string>;
  roles: Record<string, "holder" | "challenger" | "free">;
};

/**
 * The spine of a scene, or undefined when it cannot have one (fewer than two people). Who is aimed at whom: people who share a scarce
 * resource are in structural conflict, so each is aimed at the next one who shares it (the first in cast order is the holder, the rest
 * challengers); a person with an objective nobody shares is aimed at the next person in the cast; a person with no objective is free.
 */
export function buildSpine(input: SpineInput): Spine | undefined {
  const cast = input.cast;
  if (cast.length < 2) return undefined;
  const lang = input.language;
  const byResource = new Map<string, string[]>();
  for (const a of cast) {
    const r = a.objective?.scarceResourceId;
    if (r !== undefined && r !== "") byResource.set(r, [...(byResource.get(r) ?? []), a.id]);
  }
  const roles: Spine["roles"] = {};
  const targets: Spine["targets"] = {};
  cast.forEach((a, i) => {
    const r = a.objective?.scarceResourceId;
    const group = r !== undefined && r !== "" ? (byResource.get(r) ?? []) : [];
    const next = cast[(i + 1) % cast.length]!.id;
    if (a.objective === undefined) {
      roles[a.id] = "free";
      targets[a.id] = next;
    } else if (group.length > 1) {
      const at = group.indexOf(a.id);
      roles[a.id] = at === 0 ? "holder" : "challenger";
      targets[a.id] = group[(at + 1) % group.length]!;
    } else {
      roles[a.id] = "challenger";
      targets[a.id] = next;
    }
  });
  const nameOf = new Map(cast.map((a) => [a.id, a.name]));
  const labels = LABELS[lang];
  const steps: SpineStepPlan[] = SPINE_STEPS.map((step, k) => {
    const notes: Record<string, string> = {};
    const tactics: Record<string, string> = {};
    for (const a of cast) {
      const role = roles[a.id]!;
      const verb = SPINE_TACTICS[role][k]!;
      const target = nameOf.get(targets[a.id]!) ?? targets[a.id]!;
      const aim = a.objective?.description ?? input.situation;
      const obstacle = a.objective?.constraint ?? a.objective?.costOfExposure ?? a.objective?.breakingPoint;
      const lines = [HEADS[lang][step.key]];
      if (aim) lines.push(`${labels.objective}: ${clip(aim, 110)}.`);
      if (obstacle) lines.push(`${labels.obstacle}: ${clip(obstacle, 90)}.`);
      lines.push(`${labels.tactic}: ${verbIn(verb, lang)} ${target}. ${labels.move(target)}`);
      const text = lines.join(" ");
      notes[a.id] = Array.from(text).length <= BEAT_CRAFT_MAX_CHARS ? text : clip(text, BEAT_CRAFT_MAX_CHARS);
      tactics[a.id] = verb;
    }
    return { key: step.key, atMs: step.atMs, needs: step.needs, notes, tactics };
  });
  return { steps, targets, roles };
}

/** Times (ms on the run clock) of the progress events seen so far: any new fact or move, and the ones that change the scene. */
export type SpineEvents = { any: readonly number[]; major: readonly number[] };

export type SpineAdvance = { step: number; atMs: number; /** `progress`: the step before saw its event; `released`: the hold ran out first. */ via: "progress" | "released" };

/** Which step is current, and when each started. */
export class SpineClock {
  private current = 0;
  private readonly started: number[] = [0];
  readonly advances: SpineAdvance[] = [];

  constructor(
    private readonly spine: Spine,
    private readonly holdMs: number = SPINE_HOLD_MS,
  ) {}

  get step(): number {
    return this.current;
  }

  /** Moves on as far as the rules allow at `nowMs`: not before the next step's nominal second, and only once the current step saw its event or the hold ran out. */
  advance(nowMs: number, events: SpineEvents): number {
    const steps = this.spine.steps;
    while (this.current < steps.length - 1) {
      const next = steps[this.current + 1]!;
      if (nowMs < next.atMs) break;
      const need = steps[this.current]!.needs;
      const began = this.started[this.current] ?? 0;
      const seen = need === "none" || events[need].some((t) => t >= began);
      if (!seen && nowMs < Math.max(next.atMs, began) + this.holdMs) break;
      this.current++;
      this.started[this.current] = nowMs;
      this.advances.push({ step: this.current, atMs: nowMs, via: seen ? "progress" : "released" });
    }
    return this.current;
  }

  /** The note for this actor now, or undefined for an actor the spine does not know. */
  textFor(actorId: string, nowMs: number, events: SpineEvents): string | undefined {
    return this.spine.steps[this.advance(nowMs, events)]?.notes[actorId];
  }
}
