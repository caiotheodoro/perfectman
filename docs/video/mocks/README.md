# Video mocks: characters in a place

Five interactive mocks for the director-driven video, all on one real run of `cat-on-the-roof` (seed 9 of the final round, 24 pulses, four characters). Characters are the app's own hand-drawn silhouettes and face poses (`packages/web/src/stage/Figure.tsx`, `packages/shared/src/stage/emotion-face.ts`), now with whole-body acting and standing in a drawn place. Messages, clock, mood, social emotions, relational state and private motives come from the run's `replay.json` and `config.json`.

```
cd docs/video/mocks && python3 -m http.server 4400
```

| Mock | What it settles |
|---|---|
| `01-the-place.html` | The rooftop with the four at rest and a habit of standing per archetype; a clock slider relights the plate; a toggle shows the rig holding 8 characters. |
| `02-the-acting-sheet.html` | Whole-body postures driven by recorded `socialEmotions` and `coreMood.arousal`, a live dial, and one real card per posture. |
| `03-a-real-moment.html` | **The timeline player.** The run as one continuous clock: overlapping speech, anticipation and reaction easing, a camera push-in when two slip away with the others blurred at the edge, time-lapse over quiet pulses, cartoon balloons and thought clouds, and a timeline strip (clock, camera, a lane per person) you can drag. |
| `04-the-mask-gap.html` | The same moment drawn as the composed pose the words imply and the body the recorded emotions imply, with the private thought as a cloud and its drivers as tags; a fiction-only toggle drops the thought. |
| `05-library-and-cut.html` | Eight drawn places lit by the story clock, the proposed `setting:` / `props:` frontmatter, and three frames sampled from the same timeline: 16:9 cold open, 9:16 vertical cut with a caption card, end card. |
| `06-balloon-lab.html` | The balloon system on its own: six kinds, persona lettering, volume, long-line paging, a crowded-frame placement test (reports overlaps), Portuguese, Spanish, Japanese and emoji. |
| `07-private-conversations.html` | The same private moment staged three ways side by side: push-in (recommended), through the door into a second place, and staying wide. |

`world.js` holds the rig (`makeActor`, `actFrom`, vector poses via `toVec` and `lerpVec`), the places (`placeSVG`) and the light. `director.js` is the prototype of the director: `buildTimeline()` turns the run into continuous tracks (pose keyframes per character, camera, balloons, marks, captions, light) and `sample(T, t)` is a pure function of the clock. `balloons.js` measures and shapes balloons, plans stable placement, pages long lines and draws reaction marks. `stage.js` renders a sample to DOM. `data/cat-run.js` is the run projected to a compact shape.

## What the real data says about the design

- **Side-chats are the main stage.** 33 of 43 messages are private, so the huddle shot happens four times in a five-minute cut and has to be good, not a special effect.
- **Reading speed sets the runtime.** Human reading pace for these lines gives 5:20 for a 1h 36m story before compression; overlap, time-lapse and the 2x/4x multipliers are how it shortens.
- **Mood sits in a narrow band** (valence about -0.2 to 0.15). The posture picker works on the strongest social emotion and uses arousal only for breath and tremor, because arousal is the part of the mood that moves.
- **Fear of exclusion is high for everyone all night** (0.4 to 0.8) and dominates the picker, so postures need weights per emotion rather than a plain maximum.
- **Several emotions never fire in this run** (contempt, shame, admiration, social anxiety); the acting sheet marks those postures as dialled-in, not observed.
- **Addressees are inferred.** `reply_sent` records no target, so gaze and "to" labels come from name mentions and turn order.
- **Shown mood is not recorded.** The mask in mock 4 is derived from the register of the line and labelled as a reading, not a recorded fact.

Fonts load from Google Fonts when online and fall back to system serif and sans offline.
