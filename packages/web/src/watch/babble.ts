/**
 * Voices: one short formant blip per syllable, pitch from the speaker, the way
 * a character in a game mumbles. Synthesised, so there is nothing to license
 * and nothing to download; off until the viewer turns it on.
 */
import { babblePitch, type Cue } from "@perfectman/shared";

type Ctx = AudioContext;

export class Babble {
  on = false;

  /** `context` is the film's one shared audio context, created on the first user gesture. */
  constructor(private readonly indexOf: (actor: string) => number, private readonly context: () => Ctx | null) {}

  enable(): void {
    if (!this.context()) return;
    this.on = true;
  }

  disable(): void {
    this.on = false;
  }

  /** Play every cue whose time has come, between the last time and this one. */
  play(cues: Cue[], from: number, to: number): void {
    if (!this.on) return;
    for (const c of cues) {
      if (c.t > to) break;
      if (c.t > from && to - c.t < 0.25) this.blip(c);
    }
  }

  private blip(c: Cue): void {
    const ctx = this.context();
    if (!ctx) return;
    const pitch = babblePitch(this.indexOf(c.actor));
    let t = ctx.currentTime + 0.02;
    [...c.text.toLowerCase()].filter((ch) => /\p{L}/u.test(ch)).slice(0, 26).forEach((ch, k) => {
      if (k % 2) return;
      const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      const code = ch.charCodeAt(0), vowel = "aeiou".includes(ch);
      o.type = "triangle";
      o.frequency.value = (200 + (code % 13) * 22) * pitch * (vowel ? 1.1 : 0.92);
      f.type = "bandpass";
      f.frequency.value = vowel ? 900 + (code % 5) * 220 : 1600;
      f.Q.value = 2.2;
      const level = c.whisper ? 0.03 : 0.06;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(level, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.07);
      o.connect(f).connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.08);
      t += 0.052 / Math.max(0.7, pitch * 0.8);
    });
  }
}
