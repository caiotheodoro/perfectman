import { ROLES } from "@perfectman/shared";
import type { RoomDraft } from "@perfectman/shared";

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
  cast: Array<{
    name: string;
    /** Free text ("bartender") or one of the temperaments; anything else is assigned in turn. */
    role?: string;
    goal?: string;
    voice?: string;
    /** `{figure, effect?}` from the look editor; absent or `auto` means the hotel's own pick. */
    look?: { figure?: string; effect?: string } | "auto" | null;
    /** `start` or `after <n>s`; carried for the run, the compiler ignores it. */
    start?: string;
  }>;
  stage?: { room?: number | null; places?: unknown[]; travel?: boolean; hotelRooms?: string };
};

export type FormLooks = Record<string, { figure: string; effect?: string }>;

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
    const temperament = (TEMPERAMENTS as string[]).includes(key) ? (key as keyof typeof ROLES) : TEMPERAMENTS[i % TEMPERAMENTS.length]!;
    const goal = text(c?.goal) || (role ? `Play the part of ${role}.` : "Get what they came here for.");
    const look = c?.look;
    if (look && typeof look === "object" && text(look.figure)) {
      looks[`person-${i + 1}`] = { figure: text(look.figure), ...(text(look.effect) ? { effect: text(look.effect) } : {}) };
    }
    return { name, role: temperament, goal, voice: text(c?.voice) };
  });
  return {
    draft: { title: text(form.title), situation: text(form.situation), people, language: form.language === "en" ? "en" : "pt-BR" },
    looks,
  };
}
