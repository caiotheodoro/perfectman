# Saved story playback

Keep one source-to-storyboard path for the video and interactive viewer. Extend
the saved-run converter in PR 177; no simulation or model calls are needed.

## Behavior

- Default playback follows every source step in order and selects its channel.
- Public rooms, private conversations, personal thoughts, and operator records
  have distinct navigation and staging. Channel browsing pauses playback;
  Follow story restores the chronological cursor.
- Keep all declared personas in the cast roster. Stage observed speakers and
  explicit audiences or recipients. Directory membership may describe the end
  of a run, so it cannot establish earlier attendance.
- Illustrate directed speech, listening, and explicit arrivals/departures with
  small gestures. Preserve recorded presence and emotion cues.
- Use a shared room, a private alcove, and an individual thought space. These
  are visual interpretations. Authored scripts may name their place.
- Add three licensed instrumental beds for calm, tension, and warmth, with
  gentle fades and quiet action sounds. Score decisions remain inspectable.
- Produce an interactive viewer alongside the MP4 and editable composition.
  Native controls support keyboard playback, seeking, channel browsing, mute,
  and volume. Browser playback starts visually; sound follows a user gesture.

## Boundaries

Legacy transcripts omit recipients and membership. Keep these unknown. Final
emotional states still appear only at the end. No dialogue-based emotion
classifier, invented social event, extra simulation, or new frontend framework.
The interactive viewer and renderer share the same data and seekable animation.

## Changes and checks

Extend the existing adapters and types with optional channels, directed targets,
audiences, presence, and authored staging. Update the composition and finite
motion timeline. Add a small viewer controller and soundtrack planner. Reuse
the installed renderer, GSAP, font, and browser-native controls.

Test source fidelity, recipient scope, channel browsing/resume, seeking, audio
cue bounds, and safe escaping. Check desktop and narrow viewer layouts in a
browser. Render a channel-rich script with arrivals, DMs, thoughts, and emotion
changes; inspect actual frames and decode its full MP4. Recheck a saved run,
run the repo gates, and update the open PR without merging.
