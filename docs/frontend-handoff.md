# Frontend handoff — the web runner interface

A React SPA that turns a live simulation into a scene: characters as drawn
figures whose faces move with recorded emotion, speech on paper, private motive
in handwriting.

Written against `main` @ `477f62a`. Everything below was read off the repo or
measured in a browser; the gaps are stated as found, not as planned.

| | |
|---|---|
| Path | `packages/web` |
| Stack | Vite 5 · React 18 · TypeScript |
| Tests | 28 passing (`pnpm --filter @perfectman/web test`) |
| Bundle | ~340 kB, ~100 kB gzipped |
| Interface | https://web-rli81upwa-caiotheodoros-projects.vercel.app |
| Run server | https://perfectman-server-46159542194.us-central1.run.app |

---

## The one idea to preserve

Three typefaces carry three kinds of knowledge. That mapping is the design, not
decoration on it.

| Face | Carries |
|---|---|
| Fraunces | What was said out loud — dialogue, headings |
| Instrument Sans | The interface talking about itself — labels, controls, counts |
| Caveat | What only the viewer can see — private motive, character name tags |

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
7. **Stage** places figures in slots and hangs one balloon off the speaker's
   head.
   `stage/Stage.tsx`, `stage/Bubble.tsx`

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
| `onboarding/Intro.tsx` | Plays a scene instead of explaining one. Shown once; flag in `localStorage`. |
| `onboarding/intro-script.ts` | Six hand-written beats. No server involved — safe to edit freely. |

### The stage — where the work is

| File | What it does |
|---|---|
| `stage/Stage.tsx` | Slot placement, room kind, who is excluded. The busiest file. |
| `stage/Figure.tsx` | The drawn character. Face is a pose lookup; every change is a CSS transition. |
| `stage/useBubbleAnchor.ts` | Measures the balloon and clamps it inside the room. The pure function is tested. |
| `stage/useStageClock.ts` | Live queue and replay seeking, one machine. |
| `stage/room-label.ts` | Names a private room by its members, because the engine names it with an id. |

### Run controls and the debug drawer

| File | What it does |
|---|---|
| `run/RunScreen.tsx` | Warm-up gate, stage, transport, drawer. |
| `run/known-routes.ts` | One-click provider prefills. Never holds a key. |
| `run/useSoundtrack.ts` | Mood beds with an 8 s hold, plus SFX. See gaps — unverified by ear. |
| `run/DetailsDrawer.tsx` | Compiled config, diagnostics, raw frame log. Kept, just demoted. |

### Shared contract — outside `packages/web`

| File | What it does |
|---|---|
| `shared/src/stage/live-to-beats.ts` | Pulse → beats. The event allowlist lives here. |
| `shared/src/stage/emotion-face.ts` | Recorded emotion → face. Shared with the MP4 renderer so both agree. |
| `shared/src/stage/slots.ts` | Where figures stand, as fractions. Also the figure-height constant the CSS mirrors. |

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

**`FIGURE_HEIGHT_FRACTION` mirrors the CSS.**
Balloon anchoring derives from it. Change the figure's width or the room's
aspect ratio and you must change both, or balloons detach from heads.

---

## What is missing

Ranked by how likely it is to matter. Nothing here is secretly done.

**Eight files have no test coverage.**
`App`, `Stage`, `Figure`, `RunScreen`, `useSoundtrack`, `useStageClock`,
`PickStep`, `preview.ts`. The 28 passing tests cover pure logic only — the
fold, the balloon clamp, room naming. There is no DOM testing setup at all;
adding jsdom and Testing Library is step one. `useStageClock` is the
highest-value target: it is pure-ish and its queue behaviour is load-bearing.

**The soundtrack has never been heard.**
Mood selection, the 8-second hold and the LUFS levelling are ported and
typechecked, and the mute toggle works. Nobody has confirmed a bed actually
plays or that the crossfade sounds like anything. Assume it is broken until you
listen.

**One breakpoint in the whole app.**
940 px, and only in `intro.css`. Everything else leans on `auto-fill` grids and
`clamp()`. Measured at 390 px: no horizontal scroll and balloons stay inside the
room, but the stage compresses to 153 px tall and the transport wraps to three
rows. Functional, not designed.

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
