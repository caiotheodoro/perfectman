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
out-of-character: the low judged scores were correct feedback about the
mock provider, not about the engine or the scenario definition.

## Root cause (mock provider, not engine)

1. **React attractor.** `PersonaAwareMockProvider`'s charged-react branch
   fires whenever affection/admiration ≥ 0.5 — exactly what this scenario
   seeds for everyone — so once charged, it fired every pulse.
2. **Constant emoji.** The emoji choice digested only the agent id:
   one agent, one emoji, forever.
3. **Tone-mismatched replies** are persona-pack content and belong to the
   style-examples refresh work — deliberately not addressed here.

## Fix (this change)

- Pulse-salted emoji digest: choices now cycle within a scene
  (verified head-to-head: `🤨 🔥 😂 🙃 …` vs main's single repeated emoji).
- Saturation cap as defense in depth: if any future change makes
  consecutive identical reacts possible again, the provider falls through
  to message paths after two. With the salted digest the cap stays dormant
  (the streak never reaches two) — it exists so the failure mode cannot
  silently return, which the regression test pins.

## Measured effect — honestly scoped

The rule judge cannot see reactions at all (`motive_authenticity` derives
from silence meaningfulfulness; `in_character` from text tells), so
rule-judge axes are **unchanged** by this fix, and the historical 2/1
scores came from an LLM judge that cannot be rerun offline. What this
change verifiably does: eliminates the identical-reaction loop from every
mock transcript (`packages/eval/src/test/echo-chamber-stability.test.ts`
fails on main's behavior and passes here), keeping expected signals at
100%. Whether judged authenticity improves needs live-model runs —
maintainer follow-up.
