# Live streaming and playback

This note records the streaming investigation for PR #214 on 2026-09-07. The
viewer should receive committed dialogue as it happens, while giving each line
time to be read. Those are separate clocks: model generation and reader playback.

## Failures found

- The SSE gateway only published after every agent in a pulse finished. An early
  agent's committed message waited behind later model calls.
- The viewer then held everything until it had four beats. A sparse run could
  remain in preparation despite already having dialogue.
- Hiding the app's route paused its stage, but hiding the browser tab did not.
  A real Chrome probe advanced from beat 1 to beat 3 while the tab was hidden.
- A bounded backlog could evict `hello` and channel metadata. A late subscriber
  then received pulses it could not turn into a scene.
- A slow socket could lose queued content and the terminal event during shutdown.
  Error paths without a saved replay could also finish without a terminal event.
- The server exposed a final status before awaited teardown finished. A new run
  could then overlap the old run's cleanup and stream shutdown.

## Delivery contract

`SseDeliveryGateway` publishes cumulative pulse revisions when committed event
visibility and recorded state arrive. It never awaits a browser socket. The
resolver and repository remain the authority for dialogue; an uncommitted model
intent is not a spoken line. This is committed-event streaming, not token streaming.

An in-progress frame has `complete: false` and an increasing `revision` within
its pulse. `commitPulse` seals the frame and supplies final counters. Missing
metadata keeps older, sealed replay frames compatible. The browser upserts by
pulse index and ignores older revisions received during reconnect.

A speaker's recorded motive follows their message. Standalone silent thoughts
wait for the pulse to finish: staging them earlier could falsely call a future
speaker silent or insert beats before the reader's current position. Successive
live revisions must extend the existing beat sequence; they must not reorder or
remove earlier beats. Emotion updates may enrich an existing beat without
changing its identity. Audience restrictions remain attached to committed events.

The hub retains bootstrap metadata separately from its bounded history and
replaces cumulative revisions of the same pulse. Different pulses are not
coalesced together. Slow clients can reconnect; truncation of retained history
must be disclosed instead of implying a complete replay. A terminal event is
sent even if artifact creation failed; its replay URL exists only when saved.

The run remains in `stopping` until artifact attempts and handle cleanup finish.
Only then may another run start. A stream URL for a different run returns 404;
the browser distinguishes a permanently closed stream from a retrying connection
and offers recovery instead of displaying an endless reconnect message.

## Playback contract

The first available beat opens the stage immediately. An empty queue holds its
last line. If that line has already had its reading time, the next arrival can
advance immediately. A backlog plays in source order and reports the remaining
beats; it does not silently jump to the newest line.

Pause, seek and reduced-motion preferences remain reader choices. A hidden route
or browser tab suspends stage playback and audio while the stream stays connected.
Returning preserves the current beat and gives it a full reading interval.

## Verification and limits

Use Node 22, matching CI. The focused gateway/hub, stream-fold, beat-adapter and
viewer tests own their respective invariants. `scripts/check-web-viewer.mjs`
exercises the actual React app with an authored local HTTP/SSE fixture, including
the first partial pulse before any later turn. It does not prove provider latency.

```sh
pnpm -r build
pnpm lint
pnpm test:all
node scripts/check-web-viewer.mjs
```

The investigation also drove the actual HTTP server, markdown compiler,
controller, scheduler and engine with a controlled local OpenAI-compatible
provider. A committed private line reached HTTP SSE while the next provider
request remained unresolved. After release, the final frame kept the existing
beat-ID prefix and the private channel audience. A separate real Chrome probe
verified that hidden-tab playback and audio stop while incoming SSE continues.
These are controlled runtime checks; no paid provider was used.

The hub retains 256 historical messages, with bootstrap metadata separate and
only the latest revision of each pulse retained. A queue exceeding 64 pending
messages disconnects rather than silently dropping distinct pulse content;
final draining is bounded at 30 seconds. Long disconnections can exceed retained
history; reopening or hydrating a complete stored replay is a separate viewer
capability. Latest channel membership is still used when rendering historical
beats. Reading time and genuine model latency remain visible waits.

## Review record

The maintainer requested two rounds of two independent reviewers before merge.
Each round checks Standards and Spec separately against a pinned PR head. Review
findings, their disposition and the final tested head are recorded here when the
two rounds complete.

## Sources / Related decisions

- [Application architecture](../architecture/application.md)
- [Testing guidelines](../testing-strategy.md)
- [Frontend gauntlet review](../frontend-gauntlet-review.md)
- [Merge rules](../../AGENTS.md)
