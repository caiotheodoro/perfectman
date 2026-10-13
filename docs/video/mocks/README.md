# Video mocks

Five interactive mocks for the director-driven video mechanism, all built on one real run of `cat-on-the-roof` (seed 9 of the final round, `run_mv6ppixa_os9rtq`: 24 pulses, 4 characters). Nothing is invented: messages, clock, mood, relational state and private motives come from the run's `replay.json` and `config.json`.

Serve the folder and open any file:

```
cd docs/video/mocks && python3 -m http.server 4400
```

| Mock | What it settles |
|---|---|
| `01-phone-as-stage.html` | The chat is the set: typing indicators at each persona's measured cadence, tapbacks, side-chats peeling off the group as small second phones, optional babble sound. |
| `02-mask-gap.html` | The one bold move. In the omniscient lens a character's private motive and drivers slide out from behind their bubble, the avatar ring breathes with arousal and takes its colour from valence, and a circumplex tracks everyone. "Fiction only" removes all of it. |
| `03-relationship-web.html` | Who talks to whom. Messages fly along the web, the web bends as suspicion, trust, resentment or threat move, with the biggest movers listed. Dashed flights are inferred addressees. |
| `04-directors-timeline.html` | The cut itself: story-clock ruler, chapters, a lane per person, held silences, dot size as length, and video length against story time. |
| `05-share-frames.html` | The vertical export: cold open, a quotable mid shot, and an end ledger computed from first versus last pulse. |

`common.js` derives each persona's signature from the run: colour from a hash of the id, typing speed from their average message length, babble pitch from the hash. The same derivation is what the persona signature module will do from persona files.

## What the real data says about the design

- **Most talk is private.** 33 of 43 messages are in side-chats, so side-chats are the main stage, not an accessory.
- **Video length needs a director.** Playing every message at reading speed runs 9:18 for a 1h 36m story, so cuts, speed and held silences are not optional.
- **Mood sits in a narrow band** (valence roughly -0.2 to 0.15), so any mood visual must widen it; the mocks scale it for display.
- **Silence is visible.** The timeline shows long quiet stretches for the antagonist that come from the engine, not the model; the video should show them as held beats rather than hide them.
- **Addressees are inferred here.** `reply_sent` carries no target today; flights and "to" labels are marked as inferred until the engine records `addresseeIds`.
- **Shown mood is not recorded.** Only true mood is in the replay, so the mocks show true mood against what was said, not a computed face-versus-feeling gap.

Fonts load from Google Fonts when online and fall back to system sans offline.
