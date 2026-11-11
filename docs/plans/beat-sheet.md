# The beat sheet (Contract A of the cinematic revamp)

Run 63 (Sobremesa, 7:22) had one act, no unlock and no arc: the scene spine is four generic steps (pressure, demand, turn, decision) and nothing in it says where a scene is going. The beat sheet is the scene's whole shape, written once when the scene compiles and played on the run clock. It is hybrid on purpose: the sheet fixes the arc, the blocking, the props, the planted information, the camera intent and a **physical climax by 4:00**, and the actors still improvise every word inside it. A sheet never carries dialogue.

Code: types, validator and the deterministic sheet in `packages/shared/src/beat-sheet`; the compile, the director step and the links in `packages/hotel/src/authoring/beat-sheet*.ts`; the player in `packages/hotel/src/director/drama/sheet-{player,notes}.ts`; the run's seam in `packages/hotel/src/run/sheet-run.ts`; the offline proof in `packages/eval` (`drama:sim -- --sheet`, the `sheet_*` scenarios of the drama bench, `probes/sheet.ts`).

## Shape

A scenario carries an optional top-level `beat_sheet` next to `beats` and `drama` (form: cast names; compiled body: agent ids). `SCENARIO_BODY_VERSION` stays 1. A scene with a valid sheet does not use the generic spine; a scene without one (or whose sheet failed, timed out, or does not hold when the run reads it) plays the old spine and the run logs `beat_sheet_fallback` with the reason (and counts it in `replay.json` `counters.beat_sheet_fallback`).

```ts
BeatSheet = { version: 1, premise, stakes,
  arc: { inciting_at_ms /* <= 90 000 */, reversal_at_ms?, climax_at_ms /* <= 240 000 */, aftermath_until_ms },
  beats: SheetBeat[] /* <= 60, sorted */, generated_by?: { model, cost_usd /* <= 0.30 */, ms, input_hash?, mock?, attempts? } }
SheetBeat = { id, at_ms, phase: setup|inciting|escalation|reversal|climax|aftermath, gist? } &
  act{actor,verb,with?,authored_skip?,climax?} | cut{reason} | block{actor,to:{tile?|zone?|near?},how?} | prop{actor,prop,op,to?}
  | reveal{fact,to[],from?,via} | note{actor,objective,tactic?,subtext?,until_ms?} | pause{ms} | expression{actor,face,ms?} | camera{intent}
```

## Invariants (validator: `validateBeatSheet`, rows `{path, message}`)

1. Exactly one `climax:true` act, a physical verb (slap, punch, kill, die, shove, restrain, grab, hug, kiss), phase `climax`, at `arc.climax_at_ms <= 240 000`. Past 225 000 is a warning (too little room to force it).
2. The ladder: for an ordered pair, one rung per beat (LAD-1) unless `authored_skip`; physical beats 20 s apart (GATE-9); the same verb at the same person 60 s apart (GATE-10); one death a scene (LAD-4), a cut after it (warning `drama.no_scene_cut`) and cuts 20 s apart (SCENE-5). Against an explicit `drama` block: `max_rung`, `may_target`, `may_die` (GATE-5). Without a block an authored skip and a rung of 4 or more are errors (SCN-1, SCN-4). `@human` as a target only with `mayTargetHumans` (B2's flag).
3. A `note` or `reveal` before the first act and before the climax; at least one `aftermath` beat after the climax.
4. A scene over 2 minutes has a `reveal` or `note` with phase `reversal` before the climax.
5. At least 3 distinct `block`, `prop` or `camera` beats. A prop or place the room does not have is a warning (`beat_sheet.prop_mimed`, `beat_sheet.place_unknown`): the planner mimes it or picks the nearest place.
6. `generated_by.cost_usd <= 0.30`.
7. No dialogue: keys named `text`, `say`, `line`, `dialogue`... and quoted lines of 4 words or more are errors; `gist`, `fact`, `objective`, `subtext` are length-capped.

Readings added by the implementation (all additive): the arc is reconciled with the beats (`arc_fixed` warnings: the inciting second is the first inciting beat's, the climax second the climax act's, `reversal_at_ms` the first reversal beat's, `aftermath_until_ms` at least the last beat); phases run in time order; ids are unique; `generated_by` may carry `input_hash`, `mock`, `attempts`; verb table rev 4 carries `fear`, `disgust` and `smug` (wire `Face` styles 6..=8) and `grab`, so a sheet's `expression` is sent as itself (`wireFace`; the nearest old face is only for a hotel that offers fewer) and `grab` passes the verb check.

## Compile (the director step)

`AuthoringService.compileWithSheet` (the route `POST /authoring/v1/compile`) compiles as before, then, for a scene of two or more actors with no authored `beats`, not `drama: off` and no current sheet, asks a model for one (`generateBeatSheet`):

- the prompt carries the situation, each person's goal and hidden objective (what they want, what holds them back, what exposure costs), the room's furniture, zones and places when the hotel passes them (else ordinary names), the contract's hard numbers, what the scene's block allows, and the KB's reference scenes (`draftReferences`: public domain or share-alike, the slim file) as craft context;
- the reply is untrusted: `compileBeatSheet` decides, plus the five-word-run guard against the reference scenes shown (`referenceCopy`); a failure is told back once with the error list and the sheet it wrote; a second failure is `invalid`;
- the model: `PERFECTMAN_BEATSHEET_MODEL` (a chain link by model or name, else the first keyed link's endpoint and key with that model id, an OpenRouter-style id), `PERFECTMAN_BEATSHEET_EXTRA_BODY` (JSON, for a model that is not a chain link), `PERFECTMAN_BEATSHEET_PRICE` (`in,out` USD per million tokens when the host lists none). Unset, the chain's first link. `PERFECTMAN_BEAT_SHEET=0` turns the step off, `mock` writes the deterministic sheet, and the mock provider writes none unless asked;
- cost: $0.30 a scene, checked before every call (the prompt's estimate plus the output cap must fit what is left; the output cap shrinks to fit, under 1 800 tokens is `cost`) and after it (the provider's usage); an unpriced model is assumed to cost $3 / $15 per million so the cap is a cap;
- time: each call is cut at 25 s and the step at 55 s (one retry); the lazy path at run start allows 25 s;
- it never fails the compile: no sheet, `beat_sheet_error: "<reason>: <detail>"` in the body, old spine at run time.

The same source compiled again within 30 minutes keeps the sheet it got (one model call, not one per compile); `beat_sheet: "regenerate"` in the form asks for a new roll without changing the scenario. A sheet already in the form (`beat_sheet`) is read, not written over: one with a `generated_by.input_hash` that matches the scenario is kept, one whose hash no longer matches (the situation, a goal, a secret, the block or the room changed) is written again, one with no `generated_by` is the author's and is never touched. Hand-written errors fail the compile (422) with `beat_sheet.beats[3].actor` style paths. `beat_sheet` and `beats` are two scripts for one scene and are exclusive.

The scene's block: an author's block is never widened (the sheet is held to it); the conservative default is widened to the smallest block that covers the sheet's acts (`deriveSheetDrama`: the highest rung, every pair that aims a rung 4 or more, every victim of a kill or die), and is then no longer `drama_mode: "default"`.

## Runtime

`Run` builds a `SheetRuntime` when the body has a valid sheet (the body's strict read validates it again against the block it kept; a sheet that does not hold is dropped with `beat_sheet_error`):

- acts and cuts: the existing `BeatPlayer`, scenario-origin acts through every gate (a `block` with `how: "storm"` is a `storm_off` act);
- `block`, `prop`, `expression`: body commands through the run's executor (`drama:sheet:<id>` walks, never suppressed by a follow); `camera`: `RunDeps.sheetCamera` (B4's seam) and the frame log (`sheet_camera`); `pause`: the executor wrapper holds the actors' lines and typing for `ms` and releases them one at a time after;
- `reveal`, `note`, each beat's `gist`, the stage directions of the blocking and the props, the premise and the climax warning reach each actor as one steering note (`SheetNotes` via `ScopedMirror.setCraft`, at most 600 characters, the spine's slot);
- the sheet owns the ladder's high rungs until the climax window (LAD-11, act-contract 7.4): no improvised shove, slap or punch before `climax_at_ms` - 20 s, except an answer to an authored act; the pressure floor rises toward the sheet's climax; the sheet sim shows its climax at 169 to 174 s on every preset and nothing improvised above rung 2 before 150 s;
- the climax is forced: `BeatPlayerDeps.force` asks again where a gate only delays it (a `ladder` veto with the authored skip when the block covers the verb, a physical-spacing `budget` veto and a busy actor every second, a pair that is apart is walked together) until 4:30 (4:00 plus a 30 s grace). The scene's own refusals (`may_target`, `may_die`, a calm room) are final. A climax refused only because the improvised arc threw the same blow at the same person within the minute is `organic`: the scene has its physical climax from another origin;
- a beat that missed its body (the actor not placed, busy, the hook found nowhere to go) is released once, 40 s later; a gate's veto is never released late;
- `replay.json` `beat_sheet`: arc, beats played, late, dropped by reason, and the climax (`outcome`, `planned_ms`, `at_ms`); counters `beats_played`, `beats_dropped_<why>`, `beat_sheet_climax_ms`;
- a scenario compiled without a sheet gets one at run start with `PERFECTMAN_BEAT_SHEET_LAZY=1` (25 s, before anything is built).

## Offline proof

`pnpm --filter @perfectman/eval drama:sim -- --scenario confronto-da-traicao --sheet [mock|file.json] [--climax slap] [--climax-at 170] --out <dir>` plays a preset from a sheet through the real director and planner and exits 1 unless the climax came by 240 s. The bench has five `sheet_*` scenarios (climax by 240 s through the ladder and the spacing; forced over a ladder the improvised arc never climbed; held by the 20 s spacing; a kill with its cut; the gates not opened by the sheet) and the probes `sheet-climax-by-240s`, `sheet-climax-physical`, `sheet-no-stray-scenario-acts`, `sheet-skip-only-peak`, `sheet-one-climax`, `sheet-silence-kept`, `sheet-not-all-talk`, `sheet-beats-played`. A seed sweep over every drama preset is in `drama-sheet-sim.test.ts`.
