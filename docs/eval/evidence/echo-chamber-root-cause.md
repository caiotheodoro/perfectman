# stagnation_echo_chamber — root-cause analysis

## Symptom

In the round-2 sweep this scenario scored the suite's worst
(`in_character: 2`, `motive_authenticity: 1`, LLM-judged on real-model
transcripts) while every other stagnation scenario stayed in range.

## Transcript evidence

On main, Leo — seeded with affection 0.9 / admiration 0.8 — commits
`reaction_sent` on every eligible pulse and the emoji digest is keyed on
agent id alone, so the sequence is one emoji repeated for the entire
scene (20× the same reaction). Meanwhile Mariana's reply pool skews
conflict-flavored ("não me parece certo.", "curioso. curioso mesmo."),
reading as non-sequiturs in an agreement-only room.

A persona who posts nothing but 😂 for twenty pulses is genuinely
out-of-character, and that is what this change fixes.

**It is not what produced the round-2 scores.** The transcript behind
issue #33's 2/1 is a qwen3:1.7b local-model run — the persona-aware mock
was not in the generation path — and it contains zero reaction events;
it is dominated by schema fallbacks and repetition no-ops. The mock
attractor documented here and the low judged scores in #33 are two
separate defects that happen to share a scenario id. **#33 stays open**:
nothing in this change addresses it.

## Root cause (mock provider, not engine)

1. **React attractor.** `PersonaAwareMockProvider`'s charged-react branch
   fires whenever affection/admiration ≥ 0.5 and the pack samples hot
   (temperature ≥ 0.9 — Leo's pack qualifies). This scenario seeds exactly
   those emotions high, so once charged, Leo reacted every pulse.
2. **Constant emoji.** The emoji choice digested only the agent id:
   one agent, one emoji, forever.
3. **Tone-mismatched replies** are persona-pack content and belong to the
   style-examples refresh work — deliberately not addressed here.

## Fix (this change)

- **Pulse-salted emoji digest** — the whole of the behavioral fix. Choices
  now cycle within a scene: `stagnation_echo_chamber` Leo goes from
  `😂` ×20 (longest identical run 20) to `🤨 🔥 😂 🙃 …` (longest identical
  run 1), with react count, message count, event count and signal results
  unchanged.
- **Saturation cap as defense in depth.** When the digest would hand an
  agent a third identical consecutive react, the provider rotates to the
  next emoji instead. It rotates rather than suppresses because the react
  rate is a measured benchmark axis and the cap must not be able to move
  it. The streak is owned by `personaAwareProviderFactory` — one map per
  run — because `AgentRuntime` builds a fresh provider per agent per
  pulse, so per-instance streak state can never survive to be read.
- With the salted digest and the four-emoji impulse palette the longest
  observed run is 2, so the rotation branch is not reached today. It is
  reachable: the two-emoji palette used by packs with no impulse
  behaviors repeats far more often.

## Measured effect — honestly scoped

The rule judge cannot see reaction content or identity (`motive_authenticity`
derives from silence meaningfulness; `in_character` from text tells), so
rule-judge axes are **unchanged** by this fix. Head-to-head on the eight
golden gate scenarios, the whole bench is unchanged: signal pass 100.0%,
probe pass 86.5%, `content-repetition` 0.2314 / 12% passing, both before
and after — only emoji identity moves.

What this change verifiably does: eliminates the identical-reaction loop
from every mock transcript
(`packages/eval/src/test/echo-chamber-stability.test.ts` fails on main's
behavior and passes here). Whether judged authenticity improves needs
live-model runs — maintainer follow-up, tracked in #33.

Committed evidence under `docs/eval/evidence/` (`novela-run.json`,
`evidence-report.md`, `scenarios/*.json`) was generated from the pre-fix
mock and still shows the constant-emoji transcripts; it needs a
regeneration pass.
