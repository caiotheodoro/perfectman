# Optional export: Fountain and Samuel French

Not part of a live Habbo run. Use it only when the user asks for a readable script, or later as Stage 4 of the generation pipeline. The plan's `scene_metadata.export_format` says which one (`NONE` by default).

The script is written from `plan.json`: beats in order, one block per beat, dialogue in the plan language. Never put a verb id, a status value or a tactic in the script text. Subtext stays implicit.

## Fountain (screenplay)

Plain text. A page is about a minute.

| Element | Rule |
|---|---|
| Scene heading | Line starting with `INT.`, `EXT.`, `INT./EXT.` or `EST.`, upper case, blank line before and after. `INT. ROOFTOP - NIGHT`. Force one with a leading `.`: `.ROOFTOP, NIGHT`. |
| Action | Plain paragraph, 2 to 4 lines. Only what a camera or a microphone can capture. Force with a leading `!`. |
| Character cue | Upper case name, blank line before, dialogue on the next line with no blank between. `@Name` forces a cue that is not upper case. Extensions: `(V.O.)`, `(O.S.)`. |
| Parenthetical | Under the cue, in parentheses, rare. Never "angrily" or "ironically". |
| Dual dialogue | `^` after the second cue: `MARLOWE ^`. |
| Transition | Upper case line ending in `TO:`, or forced with `>`. |
| Centered text | `> THE END <`. |
| Emphasis | `*italic*`, `**bold**`, `_underline_`. |
| Page break | `===`. |
| Note | `[[note]]`, stripped from the output. Use for `STEERED` beats that may not happen. |

Layout when rendered: Courier 12 pt, left margin 1.5 in, right 1.0 in, dialogue indented about 2.5 in. A spec script has no scene numbers and no camera directions.

Other languages: use the forced slugline (`.`) and keep cues upper case.

## Samuel French (stage play)

| Element | Rule |
|---|---|
| Cover and cast | Centered title. Next page: cast list with ages, looks and relations, then time and place. |
| Act and scene | Each begins on a new page. `ACT I` centered, upper case, roman numeral. `Scene 1` underlined. |
| Setting and At Rise | Before the first line: `SETTING:` and `(AT RISE: ...)`. |
| Speaker | Name upper case, centered or at 3.5 in. `(Cont.)` when a speech continues across a page. |
| Dialogue | Single spaced, double space between speeches. A parenthetical sits at the start of the line: `(Whispering.) Do not make a sound.` |
| Stage directions | Indented three tabs (about 2.5 in) from the left, not to the right margin. Character names in them are upper case. |
| Overlap | `—` for an interruption, `...` for a trailing off. |
| Blocking | Upstage, downstage, stage left, stage right, centre, from the actor facing the audience. Use the plan's `stage_frame` zones: `downstage_left` is "down left". |
| End | `(CURTAIN)`. |

Dense casts (5 or more): do not stack more than three people at centre stage. Give background characters a reaction line of stage direction every second beat.
