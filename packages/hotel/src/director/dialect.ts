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
 * NEG-3, NEG-4, NEG-7. The sidecar always offers the drama dialect (the owner's order of 2026-11-09, errata P4-10): the answer is
 * `proto` 2 with `caps` and `sidecar.verb_vocab` whenever the hello offers `proto_max` of at least 2 and `drama.v1`, and the hotel's
 * verb vocab has the same `version` as the vendored one. Anything else (an older hotel) is a plain PROTO 1 answer, which the hotel reads as dialect 1. A different
 * `rev` or `sha256` with an equal `version` is a warning only. `own.vocab` stands in for the vendored triple (tests, to play a sidecar built
 * against another revision of the table).
 */
export function negotiate(hello: Hello, own: { vocab?: VerbVocabRef } = {}): Negotiation {
  const vocab = own.vocab ?? OWN_VOCAB;
  const offered = Math.min(PROTO_MAX, hello.proto_max ?? hello.proto);
  const drama = hello.drama;
  // `drama.enabled` is the hotel's runtime switch (SAFE-2) and is not a condition (NEG-3): the session stays open while it is off,
  // so an admin turning it on later needs no reconnect. The sidecar reads it from the session.
  if (offered < 2 || !hello.caps?.includes(DRAMA_CAP) || !drama) return { ...PLAIN, warnings: [] };
  if (drama.verb_vocab.version !== vocab.version) {
    return { ...PLAIN, warnings: [`verb vocab version mismatch (hotel ${drama.verb_vocab.version}, sidecar ${vocab.version}): drama is off for this session`] };
  }
  const warnings =
    drama.verb_vocab.rev !== vocab.rev || drama.verb_vocab.sha256 !== vocab.sha256
      ? [`verb vocab differs from the hotel's (rev ${drama.verb_vocab.rev} vs ${vocab.rev}, sha256 ${drama.verb_vocab.sha256.slice(0, 8)} vs ${vocab.sha256.slice(0, 8)}): same version, going on`]
      : [];
  return {
    dialect: 2,
    ackProto: 2,
    caps: [DRAMA_CAP],
    verbVocab: vocab,
    session: { enabled: drama.enabled, chipTtlMs: drama.chip_ttl_ms, harmMax: drama.harm_max, harmWindowS: drama.harm_window_s, dead: [...(drama.dead ?? [])] },
    warnings,
  };
}
