import { BEAT_CRAFT_MAX_CHARS } from "@perfectman/shared";
import type { BeatSheet, Phase, SheetBeat } from "@perfectman/shared";

/**
 * What the beat sheet tells each actor, as one steering note at a time: the sheet's `note` and `reveal` beats (the planted information reaches the
 * person as a private note), the moment's `gist`, the stage directions its blocking and props imply, and the authored silence. It rides the same
 * feed as the spine's notes and the KB's style lines (`ScopedMirror.setCraft`, at most {@link BEAT_CRAFT_MAX_CHARS} characters), so a scene with a sheet
 * replaces the spine's four generic steps with the director's own. Pure: the same sheet and the same second give the same text. The sheet never writes dialogue
 * and neither does this: every line is direction, in the scene's language.
 */

export type SheetLang = "pt-BR" | "en";

/** How long a reveal stays in the actor's note, a stage direction in everyone's, and a gist when no later beat has one. */
export const REVEAL_HOLD_MS = 45_000;
export const DIRECTION_HOLD_MS = 12_000;
export const GIST_HOLD_MS = 30_000;
/** A note with no `until_ms` ends at the next note for the same actor, or this long after it began. */
export const NOTE_HOLD_MS = 60_000;

const PHASE_LABEL: Record<SheetLang, Record<Phase, string>> = {
  "pt-BR": { setup: "preparação", inciting: "o estopim", escalation: "a tensão sobe", reversal: "a virada", climax: "o ápice", aftermath: "o rescaldo" },
  en: { setup: "setup", inciting: "the spark", escalation: "rising tension", reversal: "the turn", climax: "the peak", aftermath: "the aftermath" },
};

const PROP_OP: Record<SheetLang, Record<string, (who: string, prop: string, to?: string) => string>> = {
  "pt-BR": {
    take: (w, p) => `${w} pega ${p}.`,
    hand: (w, p, to) => `${w} entrega ${p}${to ? ` a ${to}` : ""}.`,
    place: (w, p) => `${w} deixa ${p} ali.`,
    show: (w, p, to) => `${w} mostra ${p}${to ? ` a ${to}` : ""}.`,
    break: (w, p) => `${w} quebra ${p}.`,
    read: (w, p) => `${w} lê ${p}.`,
  },
  en: {
    take: (w, p) => `${w} picks up ${p}.`,
    hand: (w, p, to) => `${w} hands over ${p}${to ? ` to ${to}` : ""}.`,
    place: (w, p) => `${w} sets ${p} down.`,
    show: (w, p, to) => `${w} shows ${p}${to ? ` to ${to}` : ""}.`,
    break: (w, p) => `${w} breaks ${p}.`,
    read: (w, p) => `${w} reads ${p}.`,
  },
};

const VIA: Record<SheetLang, Record<string, string>> = {
  "pt-BR": { say: "Só você sabe; use quando fizer sentido.", show: "Está diante de você agora.", overhear: "Você ouviu por acaso; ninguém sabe que você sabe." },
  en: { say: "Only you know it; use it when it fits.", show: "It is in front of you now.", overhear: "You overheard it; nobody knows you know." },
};

const HEAD: Record<SheetLang, { now: string; aim: string; move: string; sub: string; learned: string; silence: string; scene: string; stakes: string; peak: string }> = {
  "pt-BR": {
    now: "Cena, agora",
    aim: "Seu objetivo",
    move: "Jogada",
    sub: "Por baixo",
    learned: "Você acaba de saber",
    silence: "Silêncio agora: ninguém fala por alguns segundos, só olhares e gestos.",
    scene: "A cena",
    stakes: "Em jogo",
    peak: "O ápice está perto: se for hora de agir com o corpo, aja; não explique.",
  },
  en: {
    now: "Scene, now",
    aim: "Your aim",
    move: "Move",
    sub: "Underneath",
    learned: "You have just learned",
    silence: "Silence now: nobody speaks for a few seconds, only looks and gestures.",
    scene: "The scene",
    stakes: "At stake",
    peak: "The peak is near: if it is time to act with the body, act; do not explain.",
  },
};

type Frame = { actor: string | "*"; from: number; to: number; priority: number; text: string };

const clip = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1)).replace(/[\s,;:.]+$/u, "")}…`);

export class SheetNotes {
  private readonly frames: Frame[] = [];

  constructor(
    private readonly sheet: BeatSheet,
    /** Agent id to the name the scene calls them (for the stage directions). */
    private readonly names: ReadonlyMap<string, string>,
    private readonly lang: SheetLang,
  ) {
    this.build();
  }

  private nameOf(ref: string): string {
    return this.names.get(ref) ?? ref;
  }

  private build(): void {
    const h = HEAD[this.lang];
    const beats = this.sheet.beats;
    const phaseOf = PHASE_LABEL[this.lang];
    // The premise and the stakes open the scene, for everyone, until the inciting incident.
    this.frames.push({ actor: "*", from: 0, to: this.sheet.arc.inciting_at_ms + 15_000, priority: 1, text: `${h.scene}: ${clip(this.sheet.premise, 140)} ${h.stakes}: ${clip(this.sheet.stakes, 120)}` });

    const notesByActor = new Map<string, Extract<SheetBeat, { kind: "note" }>[]>();
    for (const b of beats) if (b.kind === "note") notesByActor.set(b.actor, [...(notesByActor.get(b.actor) ?? []), b]);

    beats.forEach((b, i) => {
      const after = beats.slice(i + 1);
      switch (b.kind) {
        case "note": {
          const next = (notesByActor.get(b.actor) ?? []).find((n) => n.at_ms > b.at_ms);
          const to = b.until_ms ?? Math.min(next?.at_ms ?? Infinity, b.at_ms + NOTE_HOLD_MS);
          const parts = [`${h.aim}: ${clip(b.objective, 150)}`, b.tactic ? `${h.move}: ${clip(b.tactic.replace(/^to /, ""), 40)}` : "", b.subtext ? `${h.sub}: ${clip(b.subtext, 110)}` : ""].filter(Boolean);
          this.frames.push({ actor: b.actor, from: b.at_ms, to, priority: 5, text: `${parts.join(". ")}.` });
          break;
        }
        case "reveal":
          for (const who of b.to) {
            const via = VIA[this.lang][b.via] ?? "";
            this.frames.push({ actor: who, from: b.at_ms, to: b.at_ms + REVEAL_HOLD_MS, priority: 6, text: `${h.learned}: ${clip(b.fact, 170)} ${via}` });
          }
          break;
        case "pause":
          this.frames.push({ actor: "*", from: b.at_ms, to: b.at_ms + b.ms, priority: 9, text: h.silence });
          break;
        case "block":
          this.frames.push({ actor: "*", from: b.at_ms, to: b.at_ms + DIRECTION_HOLD_MS, priority: 2, text: this.lang === "pt-BR" ? `${this.nameOf(b.actor)} ${b.how === "exit" ? "sai" : b.how === "storm" ? "sai furioso" : "se aproxima"}${b.to.near ? ` de ${this.nameOf(b.to.near)}` : b.to.zone ? ` (${b.to.zone})` : ""}.` : `${this.nameOf(b.actor)} ${b.how === "exit" ? "leaves" : b.how === "storm" ? "storms off" : "moves in"}${b.to.near ? ` by ${this.nameOf(b.to.near)}` : b.to.zone ? ` (${b.to.zone})` : ""}.` });
          break;
        case "prop":
          this.frames.push({ actor: "*", from: b.at_ms, to: b.at_ms + DIRECTION_HOLD_MS, priority: 3, text: PROP_OP[this.lang][b.op]?.(this.nameOf(b.actor), b.prop, b.to ? this.nameOf(b.to) : undefined) ?? "" });
          break;
        default:
          break;
      }
      // The moment's purpose, shown to everyone until the next beat that has one (or a while).
      if (b.gist && b.kind !== "pause") {
        const next = after.find((n) => n.gist !== undefined);
        this.frames.push({ actor: "*", from: b.at_ms, to: Math.min(next?.at_ms ?? Infinity, b.at_ms + GIST_HOLD_MS), priority: 4, text: `${h.now} (${phaseOf[b.phase]}): ${clip(b.gist, 150)}` });
      }
    });
    // The climax is announced to its two people a few seconds ahead, so the talk builds to it and the body does the rest.
    const climax = beats.find((b): b is Extract<SheetBeat, { kind: "act" }> => b.kind === "act" && b.climax === true);
    if (climax) for (const who of [climax.actor, ...(climax.with ? [climax.with] : [])]) this.frames.push({ actor: who, from: climax.at_ms - 15_000, to: climax.at_ms + 6_000, priority: 8, text: h.peak });
    this.frames.sort((a, b) => a.from - b.from || a.priority - b.priority);
  }

  /** The note for `actor` at `runMs` into the run, or undefined when the sheet has nothing for them now. Highest priority first, as many whole lines as fit. */
  textFor(actor: string, runMs: number): string | undefined {
    const live = this.frames.filter((f) => (f.actor === "*" || f.actor === actor) && runMs >= f.from && runMs < f.to && f.text !== "");
    if (live.length === 0) return undefined;
    const ordered = [...live].sort((a, b) => b.priority - a.priority || b.from - a.from);
    let text = "";
    const seen = new Set<string>();
    for (const f of ordered) {
      if (seen.has(f.text)) continue;
      seen.add(f.text);
      const next = text === "" ? f.text : `${text} ${f.text}`;
      if (next.length > BEAT_CRAFT_MAX_CHARS) {
        if (text === "") text = clip(f.text, BEAT_CRAFT_MAX_CHARS);
        continue;
      }
      text = next;
    }
    return text === "" ? undefined : text;
  }

  /** Whether any frame is live for anyone at this second (for tests and logs). */
  activeAt(runMs: number): number {
    return this.frames.filter((f) => runMs >= f.from && runMs < f.to).length;
  }
}
