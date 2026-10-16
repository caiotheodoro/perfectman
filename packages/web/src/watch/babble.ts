/**
 * Voices: one short formant blip per syllable, pitch from the speaker, the way
 * a character in a game mumbles. Synthesised, so there is nothing to license
 * and nothing to download; off until the viewer turns it on.
 */
import { babblePitch, type Cue } from "@perfectman/shared";

type Ctx = AudioContext;

export class Babble {
  on = false;
  private out: GainNode | null = null;

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

  /** One shared output, softly limited, so a burst of blips never clips and every voice sits at a steady level. */
  private bus(ctx: Ctx): AudioNode {
    if (this.out && this.out.context === ctx) return this.out;
    const gain = ctx.createGain();
    gain.gain.value = VOICE_GAIN;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.knee.value = 12;
    limiter.ratio.value = 6;
    gain.connect(limiter).connect(ctx.destination);
    this.out = gain;
    return gain;
  }

  private blip(c: Cue): void {
    const ctx = this.context();
    if (!ctx) return;
    const out = this.bus(ctx);
    const pitch = babblePitch(this.indexOf(c.actor));
    let t = ctx.currentTime + 0.02;
    [...c.text.toLowerCase()].filter((ch) => /\p{L}/u.test(ch)).slice(0, 26).forEach((ch, k) => {
      if (k % 2) return;
      const code = ch.charCodeAt(0), formants = VOWELS[ch];
      const o = ctx.createOscillator(), g = ctx.createGain(), soft = ctx.createBiquadFilter();
      // A buzzy source, shaped by two resonances the way a vowel is; a consonant is a brighter, shorter puff.
      o.type = "sawtooth";
      o.frequency.value = (180 + (code % 13) * 16) * pitch * (formants ? 1 : 1.12);
      soft.type = "lowpass";
      soft.frequency.value = 3600;
      const level = c.whisper ? 0.28 : 0.6;
      const length = formants ? 0.085 : 0.045;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(level, t + 0.007);
      g.gain.exponentialRampToValueAtTime(0.001, t + length);
      for (const [hz, q, share] of formants ?? [[1500, 3, 1]] as Array<[number, number, number]>) {
        const f = ctx.createBiquadFilter(), s = ctx.createGain();
        f.type = "bandpass";
        f.frequency.value = hz * (0.94 + 0.06 * pitch);
        f.Q.value = q;
        s.gain.value = share;
        o.connect(f).connect(s).connect(soft);
      }
      soft.connect(g).connect(out);
      o.start(t);
      o.stop(t + length + 0.02);
      t += 0.056 / Math.max(0.7, pitch * 0.8);
    });
  }
}

/** Overall level of the voices before the limiter; the beds sit near -28 LUFS under them. */
const VOICE_GAIN = 0.55;

/** First two resonances of each vowel (Hz, Q, share), which is most of what makes a mumble sound like speech. */
const VOWELS: Record<string, Array<[number, number, number]>> = {
  a: [[800, 5, 1], [1250, 6, 0.6]],
  e: [[520, 5, 1], [1900, 7, 0.55]],
  i: [[320, 5, 1], [2300, 8, 0.5]],
  o: [[520, 5, 1], [900, 6, 0.8]],
  u: [[350, 5, 1], [750, 6, 0.8]],
};
