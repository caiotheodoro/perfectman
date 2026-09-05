# Saved run to video

Build a local `pnpm video --input <file> --out <file.mp4>` command. It reads
an artifact, creates an ordered storyboard, and renders an MP4 with HyperFrames.
It does not run the simulation or call a model.

Inputs: existing evidence JSON, transcript arrays, committed-event run JSON,
replay JSON or snapshot HTML, and an explicit `perfectman-video-v1` script.
Generated narratives use the matching saved transcript and retain the original
recap. A missing transcript is an error; summaries cannot recover all events.

Keep array order, including seeded pulses before runtime pulse zero. Keep every
recorded event, private motive, pulse, emotional snapshot, and authored phase.
Label private and operator material. Do not turn fallback errors into feelings
or use final states as earlier emotions. Paginate long text without truncation.
Save source pointers and raw records in the storyboard for review.

Reuse the demo's expressive agents, white/violet palette, moving message cards,
and camera-driven transitions. Duration follows content. Recorded emotion data
drives expression; no recorded emotion means no invented reaction.

Implement in the eval package: source adapters, timing, composition assets, and
one CLI. Add a small authored example and usage docs. Keep render outputs out
of git. Validate source fidelity, hostile text escaping, pagination, argument
errors, typecheck, the repo gates, and a real render from an existing artifact.
