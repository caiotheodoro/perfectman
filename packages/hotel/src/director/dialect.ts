import type { HotelFrame, VerbVocabRef } from "./index.js";
import { VERB_VOCAB_REV, VERB_VOCAB_SHA256, VERB_VOCAB_VERSION } from "./verb-vocab.generated.js";

/** The highest Director proto this sidecar speaks (act-contract.md NEG-1). `hello.proto` stays 1; the offer rides in `proto_max`. */
export const PROTO_MAX = 2;
export const DRAMA_CAP = "drama.v1";

/** 1: the Phase 1 dialect (every connection starts here). 2: `proto` 2 with the `drama.v1` capability (NEG-4). */
export type Dialect = 1 | 2;

/** This sidecar's own `{version, rev, sha256}` of the vendored `verb-vocab.json` (VV-3). */
export const OWN_VOCAB: VerbVocabRef = { version: VERB_VOCAB_VERSION, rev: VERB_VOCAB_REV, sha256: VERB_VOCAB_SHA256 };

/** What a dialect 2 `hello` tells the sidecar about the hotel's drama state. `dead` is a full replacement set, not a delta (NEG-8). */
export type DramaSession = { enabled: boolean; chipTtlMs: number; harmMax: number; harmWindowS: number; dead: readonly number[] };

export type Negotiation = {
  dialect: Dialect;
  /** `hello_ack.proto`. */
  ackProto: 1 | 2;
  /** `hello_ack.caps`: set only when the sidecar accepts the offer. */
  caps?: string[];
  /** `hello_ack.sidecar.verb_vocab`: set only with `caps`. */
  verbVocab?: VerbVocabRef;
  session: DramaSession | null;
  warnings: string[];
};

type Hello = Extract<HotelFrame, { t: "hello" }>;

const PLAIN: Omit<Negotiation, "warnings"> = { dialect: 1, ackProto: 1, session: null };

/**
 * NEG-3, NEG-4, NEG-7. The answer is `proto` 2 with `caps` and `sidecar.verb_vocab` only when this sidecar's own drama
 * switch is on, the hello offers `proto_max` of at least 2 and `drama.v1`, and the hotel's verb vocab has the same
 * `version` as the vendored one. Anything else is a plain PROTO 1 answer, which the hotel reads as dialect 1. A different
 * `rev` or `sha256` with an equal `version` is a warning only.
 */
export function negotiate(hello: Hello, own: { enabled: boolean }): Negotiation {
  if (!own.enabled) return { ...PLAIN, warnings: [] };
  const offered = Math.min(PROTO_MAX, hello.proto_max ?? hello.proto);
  const drama = hello.drama;
  if (offered < 2 || !hello.caps?.includes(DRAMA_CAP) || !drama || drama.enabled === false) return { ...PLAIN, warnings: [] };
  if (drama.verb_vocab.version !== OWN_VOCAB.version) {
    return { ...PLAIN, warnings: [`verb vocab version mismatch (hotel ${drama.verb_vocab.version}, sidecar ${OWN_VOCAB.version}): drama is off for this session`] };
  }
  const warnings =
    drama.verb_vocab.rev !== OWN_VOCAB.rev || drama.verb_vocab.sha256 !== OWN_VOCAB.sha256
      ? [`verb vocab differs from the hotel's (rev ${drama.verb_vocab.rev} vs ${OWN_VOCAB.rev}, sha256 ${drama.verb_vocab.sha256.slice(0, 8)} vs ${OWN_VOCAB.sha256.slice(0, 8)}): same version, going on`]
      : [];
  return {
    dialect: 2,
    ackProto: 2,
    caps: [DRAMA_CAP],
    verbVocab: OWN_VOCAB,
    session: { enabled: drama.enabled, chipTtlMs: drama.chip_ttl_ms, harmMax: drama.harm_max, harmWindowS: drama.harm_window_s, dead: [...drama.dead] },
    warnings,
  };
}

/**
 * SAFE-1: `on`, `1`, `true`, `yes` (any case, trimmed) are on; `off`, `0`, `false`, `no`, unset and empty are off; anything
 * else is off too, with a warning (fail-closed, so a typo can never switch the feature on).
 */
export function parseDramaEnv(raw: string | undefined): { on: boolean; warning?: string } {
  const value = (raw ?? "").trim().toLowerCase();
  if (["on", "1", "true", "yes"].includes(value)) return { on: true };
  if (["", "off", "0", "false", "no"].includes(value)) return { on: false };
  return { on: false, warning: `PERFECTMAN_DRAMA="${raw}" is not recognised: drama stays off` };
}
