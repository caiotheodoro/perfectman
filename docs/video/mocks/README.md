# Video mocks: characters in a place

Five interactive mocks for the director-driven video, all on one real run of `cat-on-the-roof` (seed 9 of the final round, 24 pulses, four characters). Characters are the app's own hand-drawn silhouettes and face poses (`packages/web/src/stage/Figure.tsx`, `packages/shared/src/stage/emotion-face.ts`), now with whole-body acting and standing in a drawn place. Messages, clock, mood, social emotions, relational state and private motives come from the run's `replay.json` and `config.json`.

```
cd docs/video/mocks && python3 -m http.server 4400
```

| Mock | What it settles |
|---|---|
| `01-the-place.html` | The rooftop with the four at rest, each carrying a habit of standing derived from archetype (ledger and folded arms, lit phone and slouch, clipboard, glasses and hands behind the back). A clock slider relights the plate from dusk to first grey; a toggle shows the rig holding 8 characters. |
| `02-the-acting-sheet.html` | The body language set, driven by recorded `socialEmotions` and `coreMood.arousal`: anger, shame, fear, warmth, pride, suspicion, worn out, at rest. A live dial per character, and one real card per posture. |
| `03-a-real-moment.html` | The run played in the world: lettered speech, listeners reacting, side-chat pairs walking to the stairwell door while the others watch. Speed, scrub, omniscient or fiction-only lens, optional animalese voices. |
| `04-the-mask-gap.html` | The bold move. The same moment drawn twice: the composed pose the words imply, and the body the recorded emotions imply. Slip between them; omniscient mode adds the private thought and its drivers. |
| `05-library-and-cut.html` | Eight drawn places (rooftop, stairwell, elevator, kitchen, living room, lobby, street, office) lit by the story clock, the proposed `setting:` and `props:` frontmatter, and three frames from one cut: 16:9 cold open, 9:16 mid shot, end card. |

`world.js` holds the rig (`makeActor`, `actFrom`), the places (`placeSVG`) and the light (`light`). `data/cat-run.js` is the run projected to a compact shape (`node` can load it).

## What the real data says about the design

- **Side-chats are the main stage.** 33 of 43 messages are private, so the walk to a corner is a regular event, not a special effect.
- **Mood sits in a narrow band** (valence about -0.2 to 0.15). The posture picker works on the strongest social emotion and uses arousal only for breath and tremor, because arousal is the part of the mood that moves.
- **Fear of exclusion is high for everyone all night** (0.4 to 0.8) and dominates the picker, so postures need weights per emotion rather than a plain maximum.
- **Several emotions never fire in this run** (contempt, shame, admiration, social anxiety); the acting sheet marks those postures as dialled-in, not observed.
- **Addressees are inferred.** `reply_sent` records no target, so gaze and "to" labels come from name mentions and turn order.
- **Shown mood is not recorded.** The mask in mock 4 is derived from the register of the line and labelled as a reading, not a recorded fact.

Fonts load from Google Fonts when online and fall back to system serif and sans offline.
