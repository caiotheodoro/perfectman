# Frontend handoff — the web runner interface

A React SPA that turns a live simulation into a scene: characters as drawn
figures whose faces move with recorded emotion, speech on paper, private motive
in handwriting.

Written against `main` @ `477f62a`, revised for the flipbook stage. Everything below was read off the repo or
measured in a browser; the gaps are stated as found, not as planned.

| | |
|---|---|
| Path | `packages/web` |
| Stack | Vite 5 · React 18 · TypeScript |
| Tests | 64 passing (`pnpm --filter @perfectman/web test`) |
| Bundle | ~340 kB, ~100 kB gzipped |
| Interface | https://web-rli81upwa-caiotheodoros-projects.vercel.app |
| Run server | https://perfectman-server-46159542194.us-central1.run.app |

---

## The one idea to preserve

Two typefaces carry three kinds of knowledge. That mapping is the design, not
decoration on it.

| Face | Carries |
|---|---|
| Fraunces | What was said out loud — dialogue, headings |
| Instrument Sans | The interface talking about itself — labels, controls, counts |
| Fraunces italic | What only the viewer can see — private motive, character name tags |

The engine's whole claim is that there is a gap between what an agent says and
what it wants. Setting both in one face throws that away.

Character colours are six highlighter chips (`#C4E2FB`, `#F5D188`, `#C2C2FB`,
`#F9B28C`, `#B1D9A3`, `#F3C0D4`), assigned by **sorted agent id** — see the
decisions below for why sorting matters.

---

## How a run reaches the screen

Follow this path when a beat renders wrong. The bug is almost always at one
specific hop.

1. **Pick a cast and a scene** — markdown files, from `GET /api/presets` or
   written inline.
   `pick/PickStep.tsx`, `pick/usePresets.ts`
2. **Compile** on every change, debounced 300 ms. Side-effect free, returns
   diagnostics.
   `POST /api/compile` via `api/client.ts`
3. **Start** the run; the server returns a run id.
   `POST /api/runs` from `run/ProviderForm.tsx`
4. **Stream** SSE frames, folded into one growing `ViewerReplay`.
   `api/useRunStream.ts`
5. **Turn pulses into beats** — one thing on screen at a time: speech, aside,
   silence, event.
   `packages/shared/src/stage/live-to-beats.ts`
6. **Clock** holds each beat for its reading time, then yields. A queue, not a
   timeline.
   `stage/useStageClock.ts`
7. **Place** every beat's seating in one pass, sticky per room.
   `packages/shared/src/stage/placement.ts`
8. **Stage** draws the placement and hangs one balloon off the speaker's
   measured head; `Panel` turns the page when the room changes; the
   `ContactSheet` under it is the run as a strip of pictures.
   `stage/Panel.tsx`, `stage/Stage.tsx`, `stage/Bubble.tsx`, `stage/ContactSheet.tsx`

---

## File map

Forty files. These are the ones that carry weight.

### Shell and flow

| File | What it does |
|---|---|
| `App.tsx` | Step machine: intro → cast → scene → run. Owns the compile debounce and the scene-pulls-its-cast rule. |
| `design/Shell.tsx` | Header and the named step rail. Steps are named, not numbered, on purpose. |
| `design/tokens.css` | The whole palette, radius scale, motion timings. Start here for any visual change. |
| `main.tsx` | Mounts the app and imports every stylesheet, in cascade order. |

### Onboarding — first run only

| File | What it does |
|---|---|
| `onboarding/Intro.tsx` | Plays a scene instead of explaining one, through the run's own `Panel` and caption. Shown once; flag in `localStorage`. |
| `onboarding/intro-script.ts` | Six hand-written beats, and `introRun()` turning them into `StageBeat`s. No server involved — safe to edit freely. |

### The stage — where the work is

| File | What it does |
|---|---|
| `stage/Panel.tsx` | The page. Keeps the leaving room mounted for the turn, with direction; instant under reduced motion. |
| `stage/Stage.tsx` | Draws a `Placement`: figures on their marks, the excluded named, one balloon. Room only. |
| `stage/Attribution.tsx` | The caption under the room. Separate so the turn rotates the picture, not the text. |
| `stage/ContactSheet.tsx`, `stage/Frame.tsx` | The scrubber: one SVG frame per beat, no words, `aria-label` per frame, arrow keys. |
| `stage/Figure.tsx` | The drawn character: a face and a name, no body. Pose is a lookup; the head tilts, the cheeks colour, the mouth moves while speaking. All CSS transitions. |
| `stage/useBubbleAnchor.ts` | Measures the speaker's drawn head and the balloon, clamps inside the room, moves beside the head when it cannot fit above. The pure functions are tested. |
| `stage/useStageClock.ts` | Live queue and replay seeking, one machine. `reached` is the high-water mark the sheet draws up to. |
| `stage/room-label.ts` | Names a private room by its members, because the engine names it with an id. |

### Run controls and the debug drawer

| File | What it does |
|---|---|
| `run/RunScreen.tsx` | Warm-up gate, stage, transport, drawer. |
| `run/known-routes.ts` | One-click provider prefills. Never holds a key. |
| `run/useSoundtrack.ts` | Mood beds with an 8 s hold, plus cues. `unlock()` runs in the Run click; a refusal flips the control but is not saved. |
| `run/sfx-cue.ts` | Which cue a beat makes: once per line, none for a thought, none while paused. |
| `run/DetailsDrawer.tsx` | Compiled config, diagnostics, raw frame log. Kept, just demoted. |

### Shared contract — outside `packages/web`

| File | What it does |
|---|---|
| `shared/src/stage/live-to-beats.ts` | Pulse → beats. The event allowlist lives here. Fills `reactions` so listeners wear what was recorded about them. |
| `shared/src/stage/emotion-face.ts` | Recorded emotion → face. Shared with the MP4 renderer so both agree. |
| `shared/src/stage/slots.ts` | Where figures stand, as fractions. The figure-height constant is only the first-paint guess. |
| `shared/src/stage/placement.ts` | `placeBeats`: seating for the whole run in one pass, memory keyed by room, not channel. |

---

## Decisions that will bite if reversed

Each of these was a bug first. The comment in the file says so too.

**One balloon per beat, never two stacked.**
A speech-plus-thought stack reached ~270 px against ~147 px of headroom at a
back-row slot. That is why a thought is its own beat kind.

**Event staging is an allowlist.**
Unknown event types are hidden, not spoken. As a passthrough, a 16-turn run
staged 73 events for 3 real lines — every recorded motive and blocked
repetition arrived as dialogue.

**Empty `visibleToAgents` means everyone.**
Not nobody. Normalising it anywhere inverts the exclusion story the whole
product exists to show.

**Chips come from sorted agent ids, not list position.**
The preset card lists persona files alphabetically; the stage lists them in cast
order. Sorting first is what makes a character the same colour in both.

**Slots are re-checked against the new room.**
Public seats six, private five. Carrying a slot index across without checking
crashed on the first private channel a real run opened.

**A room is `kind/channel`, not the channel.**
A silence renders the same channel as a one-seat thought room. Keying seating
memory by channel let that overwrite the public room's seats, and the next
spoken line moved everyone. `placeBeats` keys by room and walks the whole
list, so seeking back also shows the seating a beat had the first time.

**Balloon anchoring is measured; the constant is a guess.**
`FIGURE_HEIGHT_FRACTION` knows the drawn figure and not the name tag under it,
so a balloon placed from it sat 6–14px onto the head on every beat, and on a
phone — where the mark's old 78px minimum made figures taller than the room —
the balloon was clipped out of the frame. The hook measures the speaker's
`.figure__body` against the room and re-measures on resize. When it still
cannot fit above the head it goes beside it, never over the face.

**One scrubber, and it has no words in it.**
The contact sheet is the run as pictures: ground per room kind, a dot per
person where they stood, a ring on the speaker. It replaced the range input.
Anything readable in it would make it a transcript, which is what the details
drawer is for. `reached` is not `behind`: seeking back does not un-draw.

**The landing is the product, not a picture of it.**
The intro renders through `Panel` and `Attribution` with beats from
`introRun()`. A separate intro layout drifted from the stage the moment the
stage changed; now it cannot. The provenance reading in the caption is hidden
there by CSS, because on the landing everything is authored. Nothing else was
added to the landing or the pick steps on purpose: the direction is to sharpen
what is there, not to add to it.

**A character is a face.**
The body never carried information and, at the sizes the stage and the cards
draw, only made the face smaller. Marks are 18% of the room; the rows sit at
`.92 / .66 / .46` so five faces fill a page. `FIGURE_HEIGHT_FRACTION` is the
face's height and still only the first-paint guess.

**The previous page lives in state, not a ref.**
React renders twice in development. A ref written during the first pass made
the second pass see no room change, and the turn was silently dropped in dev
while passing its tests. `Panel` keeps the last page in state and resets it
during render; the StrictMode test pins it.

**Mute flips, only the toggle persists.**
A refused `play()` turns the control off so it never claims sound that is not
there, but does not write to `localStorage` — a missing file today must not
mute every run tomorrow. An `AbortError` is a `play()` interrupted by
`pause()`, which `unlock()` does on purpose, and is not a refusal.

---

## What is missing

Ranked by how likely it is to matter. Nothing here is secretly done.

**Five files have no test coverage.**
`App`, `Figure`, `RunScreen`, `useSoundtrack`, `PickStep`, `preview.ts`.
`.test.tsx` files run under jsdom with Testing Library; `.test.ts` stay in
node. `Stage`, `Panel`, `ContactSheet` and the clock's high-water mark have DOM
tests; the fold, the balloon clamp, the cue rule, room naming and seating are
pure. `useSoundtrack` is the largest untested surface and needs a fake
`HTMLMediaElement`.

**iOS ignores element volume.**
The LUFS levelling and the crossfade are `HTMLMediaElement.volume` ramps, which
iPhone Safari treats as read-only. The hook detects that and keeps beds off
there rather than play one at full level over the dialogue; cues still play.
A `GainNode` is the fix, and needs its own gesture-scoped `resume()`.

**The page turn has not been seen on a real run.**
The mock never leaves the public channel, so the room never changes in a mock
run and the turn is covered by seven unit tests and a keyframe check only.
Watch the first real run with a private channel.

**Two breakpoints in the whole app.**
940 px in `intro.css`, 640 px in `stage.css` where the room goes 4:3 and the
sheet's frames shrink. Measured at 390 px: no horizontal scroll, the balloon is
inside the room, and the longest mid-row name tag touches the front figure by
1 px. The transport still wraps to rows. Functional, not designed.

**The sheet stops being scannable past a few hundred beats.**
A 40-beat run is ~2800 px of strip. Nothing paginates or groups it.

**No way to open a past run.**
`GET /api/runs` and `/api/runs/:id/replay` both exist, and the viewer already
renders a stored replay — there is simply no screen that lists them. Probably
the cheapest real feature left.

**One run at a time, globally.**
The server holds a single run in memory, so while anyone's run is going everyone
else gets `409`, and there is no control to stop someone else's. Fine locally,
wrong for the shared link.

**`"notice"` beat kind is never produced.**
Declared in `StageBeatKind`; `pulseToBeats` never emits it. Notices reach the
details drawer through a separate path. Either wire it to the stage or drop it
from the union.

**Reduced motion stops CSS, not the clock.**
`prefers-reduced-motion` kills transitions and the idle blink/breathe, but the
stage still auto-advances. Someone who asked for less motion probably wants it
paused by default.

**Preset content just landed from another session.**
PR #203 added the `the-group` cast (5 personas) and five scenes; live now serves
2 casts and 6 scenes. The new content is pt-BR while the interface chrome is
English. The language toggle follows the files so this works, but the mix is
worth a deliberate decision.

---

## Running it

Two processes. The server serves the API; Vite serves the interface and proxies
`/api` to it.

```bash
pnpm build                            # once, or after touching shared/server
pnpm web                              # run server on :4317
pnpm --filter @perfectman/web dev     # interface on :5317, hot reload
```

Pick the **Mock** provider for a run that finishes in seconds and needs no key.
For a real one, the form has a one-click prefill for OrcaRouter + Qwen3.5-27B;
you supply only the key.

Mock is a bad proxy for the real path — it skips prompt building, TLS and
response parsing, which is where the time actually goes. Check anything
performance-shaped against a real model.

### Redeploying

```bash
# interface
cd packages/web
VITE_API_BASE=<server-url> pnpm build
npx vercel deploy --prebuilt --prod

# run server — see deploying.md, the CPU and throttling flags are load-bearing
gcloud run deploy perfectman-server --source . --region=us-central1 ...
```

Presets are read off disk inside the container, so **adding a preset requires
redeploying the server**, not just the interface.
