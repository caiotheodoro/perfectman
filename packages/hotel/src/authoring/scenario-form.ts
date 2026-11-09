import { ROLES } from "@perfectman/shared";
import type { RoomDraft } from "@perfectman/shared";
import type { ScenarioFormBeat } from "./scenario-beats.js";
import type { ScenarioFormDrama } from "./scenario-drama.js";

/**
 * The hotel builder's form as it crosses the wire (`source` of validate/compile, and what a saved
 * version stores). The sidecar turns it into the persona and scenario files with `roomFiles`, so the
 * builder never writes markdown. A `source` string that parses to an object with a `cast` array is
 * a form; anything else is a markdown bundle.
 */
export type ScenarioForm = {
  title: string;
  situation: string;
  language?: "en" | "pt-BR";
  mode?: "default" | "cinematic";
  /** `spite` compiles a scene of contained hatred over one object (pt-BR only); anything else is the default tone. */
  tone?: string;
  cast: Array<{
    name: string;
    /** Free text ("bartender") or one of the temperaments; anything else is assigned in turn. */
    role?: string;
    goal?: string;
    voice?: string;
    /** One of the three temperaments (`connector`, `skeptic`, `performer`); wins over a `role` that is free text. */
    temperament?: string;
    /** Who they are: looks, history, manner. Goes into the persona's `## Identity`. */
    identity?: string;
    /** What sets them off and what they do about it (`## Triggers`); at most 6. */
    triggers?: Array<{ trigger?: string; behavior?: string }>;
    /** How fast they answer; maps to the persona's `presence.responseDelayMs`. */
    delay?: "quick" | "normal" | "slow";
    /** The pool persona this person was copied from (informational: the edits live in the fields above). */
    persona?: string;
    /** Sample lines in this person's own voice (array, or one per line); a model copies them, so they set the register. At most 6. */
    lines?: string[] | string;
    /** `{figure, effect?}` from the look editor; absent or `auto` means the hotel's own pick. */
    look?: { figure?: string; effect?: string } | "auto" | null;
    /** `start`, `after <n>s` or `on cue`; `after <n>s` becomes the scenario body's `arrivals`, the others take the run's default stagger. */
    start?: string;
  }>;
  /** The OpenRouter model picked in the builder (informational here: the run carries it, D54). */
  model?: string;
  /**
   * What the scene may do to people (act-contract.md section 7): the ladder ceiling, who may be hit or killed, permadeath. Refs are cast
   * names, `@human` is any human who opted in. Absent is free play; `{}` is free play plus authored skips. Compiled into the body's `drama`.
   */
  drama?: ScenarioFormDrama;
  /**
   * The scene's script (errata P1-05, P4-01): authored acts and scene cuts at a second of the run, refs by cast name. Compiled into the body's
   * `beats`. A cut here is what SCN-6 asks of a scene that can kill.
   */
  beats?: ScenarioFormBeat[];
  stage?: {
    room?: number | null;
    places?: unknown[];
    /** The "may visit other rooms" switch. */
    travel?: boolean;
    /** Legacy free text (`kitchen: 12`); the builder no longer writes it and the run ignores it. */
    hotelRooms?: string;
    /** The rooms actors may walk into besides the stage room (the builder's room chips). Absent means no limit. */
    visit?: Array<{ id?: number; name?: string } | number>;
  };
};

/** Where a run's actors may go: `rooms` is the whole list (the stage room is always allowed too). */
export type ScenarioStage = { travel: boolean; rooms: Array<{ id: number; name?: string }> };

/** Most rooms a scenario may list; the hotel's room menu is capped at 500 and a cast has no use for more. */
export const MAX_VISIT_ROOMS = 200;

/**
 * The form's travel rule as the compiled body carries it. `travel` off means the actors stay put. `travel` on with
 * a `visit` list means exactly those rooms. A form that predates the list (no `visit`) keeps the old behaviour of
 * every room the hotel names, so nothing already saved changes; that case, and a form with no `stage`, return undefined.
 */
export function formStage(form: ScenarioForm): ScenarioStage | undefined {
  const s = form.stage;
  if (!s || typeof s !== "object") return undefined;
  if (s.travel !== true) return { travel: false, rooms: [] };
  if (!Array.isArray(s.visit)) return undefined;
  return { travel: true, rooms: cleanVisit(s.visit) };
}

/** Positive whole room numbers, once each, with a name when one rides along (it is text from the hotel's list: kept short, never markup). */
export function cleanVisit(raw: unknown[]): Array<{ id: number; name?: string }> {
  const seen = new Set<number>();
  const out: Array<{ id: number; name?: string }> = [];
  for (const v of raw) {
    const id = typeof v === "number" ? v : v && typeof v === "object" ? (v as { id?: unknown }).id : undefined;
    if (typeof id !== "number" || !Number.isInteger(id) || id < 1 || seen.has(id)) continue;
    seen.add(id);
    const name = v && typeof v === "object" ? text((v as { name?: unknown }).name).slice(0, 40) : "";
    out.push(name ? { id, name } : { id });
    if (out.length >= MAX_VISIT_ROOMS) break;
  }
  return out;
}

export type FormLooks = Record<string, { figure: string; effect?: string }>;

/** The longest an entrance may be put off: ten minutes. */
export const MAX_ARRIVAL_MS = 600_000;

/**
 * "after 12s" / "after 1.5 s" / "depois de 8 s" is a fixed entrance time in ms. "start", "at start", "on cue"
 * and nothing at all return undefined: the run walks those people in one after another with a small natural gap.
 */
export function parseStart(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const m = /^\s*(?:after|depois\s+de)\s*(\d+(?:[.,]\d+)?)\s*s(?:ec(?:onds?)?|egundos?)?\s*$/i.exec(value);
  if (!m?.[1]) return undefined;
  const ms = Math.round(Number(m[1].replace(",", ".")) * 1000);
  return Number.isFinite(ms) ? Math.min(MAX_ARRIVAL_MS, Math.max(0, ms)) : undefined;
}

/** Fixed entrance times by the agent ids `roomFiles` gives (`person-N`); people without one are not listed. */
export function formArrivals(form: ScenarioForm): Record<string, number> {
  const out: Record<string, number> = {};
  (Array.isArray(form.cast) ? form.cast : []).forEach((c, i) => {
    const ms = parseStart(c?.start);
    if (ms !== undefined) out[`person-${i + 1}`] = ms;
  });
  return out;
}

const TEMPERAMENTS = Object.keys(ROLES) as Array<keyof typeof ROLES>;

/** The parsed form, or undefined when `source` is not one. */
export function parseForm(source: string): ScenarioForm | undefined {
  const text = source.trimStart();
  if (!text.startsWith("{")) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (value === null || typeof value !== "object") return undefined;
  const o = value as Record<string, unknown>;
  return Array.isArray(o["cast"]) && typeof o["title"] === "string" ? (o as unknown as ScenarioForm) : undefined;
}

const text = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/** The form as `roomFiles` input, plus the outfits keyed by the agent ids `roomFiles` gives (`person-N`). */
export function formToDraft(form: ScenarioForm): { draft: RoomDraft; looks: FormLooks } {
  const looks: FormLooks = {};
  const cast = Array.isArray(form.cast) ? form.cast : [];
  const people = cast.map((c, i) => {
    const name = text(c?.name);
    const role = text(c?.role);
    const key = role.toLowerCase();
    const chosen = text(c?.temperament).toLowerCase();
    const named = (TEMPERAMENTS as string[]).includes(key);
    const temperament = (TEMPERAMENTS as string[]).includes(chosen) ? (chosen as keyof typeof ROLES) : named ? (key as keyof typeof ROLES) : TEMPERAMENTS[i % TEMPERAMENTS.length]!;
    const pt = form.language !== "en";
    const goal = text(c?.goal) || (role ? (pt ? `Fazer o papel de ${role}.` : `Play the part of ${role}.`) : pt ? "Conseguir o que veio buscar aqui." : "Get what they came here for.");
    const look = c?.look;
    if (look && typeof look === "object" && text(look.figure)) {
      looks[`person-${i + 1}`] = { figure: text(look.figure), ...(text(look.effect) ? { effect: text(look.effect) } : {}) };
    }
    const raw = Array.isArray(c?.lines) ? c.lines : typeof c?.lines === "string" ? c.lines.split(/\r?\n/) : [];
    const lines = raw.map((l) => text(l).slice(0, 140)).filter(Boolean).slice(0, 6);
    // A role in the admin's own words ("o boca grande da turma") is part of who the person is.
    const identity = [named ? "" : role.replace(/[.!?]+$/, ""), text(c?.identity)].filter(Boolean).join(". ").slice(0, 700);
    const triggers = (Array.isArray(c?.triggers) ? c.triggers : [])
      .map((t) => ({ trigger: text(t?.trigger).slice(0, 160), behavior: text(t?.behavior).slice(0, 240) }))
      .filter((t) => t.trigger && t.behavior)
      .slice(0, 6);
    const speed = c?.delay === "quick" || c?.delay === "slow" || c?.delay === "normal" ? c.delay : undefined;
    return {
      name, role: temperament, goal, voice: text(c?.voice),
      ...(lines.length ? { lines } : {}), ...(identity ? { identity } : {}), ...(triggers.length ? { triggers } : {}), ...(speed ? { speed } : {}),
    };
  });
  const tone = form.tone === "spite" ? "spite" : undefined;
  return {
    draft: {
      title: text(form.title),
      situation: text(form.situation),
      people,
      language: form.language === "en" ? "en" : "pt-BR",
      ...(tone ? { tone } : {}),
    },
    looks,
  };
}
