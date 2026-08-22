# stagnation_echo_chamber — root-cause analysis

## Symptom

In the round-2 sweep this scenario scored the suite's worst
(`in_character: 2`, `motive_authenticity: 1`) while every other
stagnation scenario stayed in the normal range.

## Transcript evidence (offline mock run, before the fix)

```
[p5]  leo (reaction_sent): 😂     ← from p5 to p18:
[p6]  leo (reaction_sent): 😂     leo posts NOTHING but identical 😂
...                                reactions (12+ consecutive turns)
[p18] leo (reaction_sent): 🙃
[p2]  mariana (reply_sent): boa mesmo.
[p6]  mariana (reply_sent): entendo a intenção.      ← conflict-flavored
[p8]  mariana (reply_sent): não me parece certo.     ← non-sequiturs in a
[p9]  mariana (reply_sent): curioso. curioso mesmo.  ← zero-conflict room
```

## Root cause (mock provider, not engine)

1. **React attractor.** `PersonaAwareMockProvider`'s charged-react branch is
   gated on `affection >= 0.5 || admiration >= 0.5`. The echo-chamber seeds
   exactly those emotions high for everyone — so once charged, Leo's react
   branch fired every pulse, and the emoji digest was keyed on agent only,
   yielding the same emoji forever. A persona who posts nothing but 😂 for
   fifteen pulses is genuinely out-of-character; the low judge scores were
   *correct feedback about the mock*.
2. **Tone-mismatched reply pool.** Mariana's replies come from her pack's
   style examples, which skew conflict-flavored; in an agreement-only room
   they read as non-sequiturs. That is persona-pack *content*, tracked in
   the style-examples refresh work — not fixed here.

## Fix (this change)

- React saturation cap: after two identical consecutive emoji reacts, the
  provider falls through to the message paths; any non-react turn resets
  the streak.
- Emoji digest now includes the pulse salt, so choices vary within a scene.

## After

Leo's reaction sequence alternates emojis and interleaves with message
turns; rule-judge `motive_authenticity` went 1 → 5 and `in_character`
2 → 3 on the same offline transcript; expected signals still pass at 100%.
`packages/eval/src/test/echo-chamber-stability.test.ts` pins the cap so the
attractor cannot silently return.
