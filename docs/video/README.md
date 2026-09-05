# Turn saved runs into video

The video command reads an existing file and renders a local MP4. It does not
run the simulation or call a model. The output uses the Perfectman demo's
agents, message board, moving cards, and recorded emotion cues.

Install Node.js 22 or later, pnpm, and FFmpeg. Then run from the repository root:

```sh
pnpm install
pnpm build
pnpm video --input docs/eval/evidence/deepseek/scenarios/v1_exclusion_inferred.json --out out/exclusion.mp4
```

The first render can download Chrome. The renderer and assets are pinned local
dependencies. No HeyGen account or model key is required.

For a generated narrative, select its scenario. Keep its matching transcript
beside it in the original evidence directory:

```sh
pnpm video --input docs/eval/evidence/deepseek/narrations.json --scenario motive_conflict --out out/conflict.mp4
```

The command renders the saved events first, then the exact narrator recap and
hidden shift. A summary cannot recover missing events. If its transcript is
absent, the command fails with the path that is needed.

## Inputs

| File | What the video retains |
|---|---|
| Evidence JSON with `transcript` | Every row, source order, private motives, and final states. |
| Transcript JSON array | Every row and its available content and privacy fields. |
| Run JSON with `events`, or an event array | Every committed event, motive, visibility, and recorded emotion driver. |
| Replay JSON or snapshot HTML with `REPLAY_DATA` | Pulses, events, operator phases, recorded emotional snapshots, and ending. HTML scripts are never executed. |
| `narrations-v1` JSON with matching evidence | The selected run, original title, recap, and hidden shift. Use `--scenario` when there is more than one entry. |
| `perfectman-video-v1` script | Explicit phases, dialogue, visibility, and authored emotion cues. |

Files must use UTF-8 and be at most 32 MiB. Source language and text are kept.
The command rejects unsupported or invalid input; it does not guess a schema.

## Write a script

Use [peacemaker.json](../../examples/video/peacemaker.json) as a complete example:

```sh
pnpm video --input examples/video/peacemaker.json --out out/peacemaker.mp4
```

Each step has `phase`, `kind`, and `text`. An `actorId` must match an entry in
`agents`. Kinds are `message`, `private`, `event`, `state`, and `narration`.
Optional fields are `channel`, `visibility`, `emotion`, and `duration`.
`visibility` is `public`, `private`, or `operator`. A private step defaults to
private visibility. Emotion cues use a `label`, `drivers`, or numeric `values`.
Authored cues are identified as authored in the video.

An optional `duration` sets a minimum hold for the step. Reading time can extend
it. Long text is split into pages without truncation. A full run can produce a
long video; the converter does not cut events to fit a short demo.

## Inspect the result

For `out/exclusion.mp4`, the command also creates `out/exclusion.hyperframes/`.
It contains the editable composition, local assets, and `storyboard.json`.
The storyboard records each source step, page time, raw record, source pointer,
and input hash. Narrated runs include both source files and their hashes.

Use `--prepare-only` to create that project without rendering:

```sh
pnpm video --input examples/video/peacemaker.json --out out/preview.mp4 --prepare-only
pnpm --filter @perfectman/eval exec hyperframes preview "$PWD/out/preview.hyperframes" --background
```

Existing output files and project directories are never replaced. Choose a new
`--out` path for a new conversion. A failed render leaves its project available
for inspection. Video output is H.264, 1920 × 1080, 30 fps, with quiet message
cues. HyperFrames checks run first and errors stop rendering. Long generated
compositions can emit an advisory about HTML length; this does not cut the run.
Rendering streams frames to the encoder to limit temporary disk use on long runs.

## Source limits

Array order is authoritative. Some saved files contain seed pulses `0, 1, 2`
followed by runtime pulse `0`. Sorting by pulse would change their story.

Faces illustrate the most recent recorded emotion; they are neutral until a
state or cue exists. Final states appear only at the end. Engine fallback
messages are operator records, not character feelings. Private messages,
thoughts, and operator records remain visibly distinct.

Existing replay files do not save every internal attention, interpretation,
pressure, or inhibition stage. The video shows recorded pulses, events, states,
and explicit script phases. It cannot recover stages that were not recorded.
Replay event and operator arrays have no shared ordering; each keeps its own
order and is shown in a separate phase. Repeated `agentThinking` data stays in
raw context; only fresh, same-pulse operator intents become new thought steps.
