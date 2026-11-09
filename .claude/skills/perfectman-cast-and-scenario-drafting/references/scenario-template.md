# Scenario file template (`<scene>.scenario.md`) and preset files

Compiled by `packages/server/src/authoring/scenario-md-compiler.ts`; `drama` by `packages/hotel/src/authoring/scenario-drama.ts`; `beats` by `scenario-beats.ts`. Copy the shape from `examples/presets/scenes/assassinato-na-festa` (conflict, death) and `reencontro-abraco` (affection).

```markdown
---
name: <scene title>
seed: <integer>
maxPulses: <36 to 60>
storyClock: { start: "<HH:MM>", minutesPerPulse: 2 }
setting: <rooftop | stairwell | elevator | kitchen | living | lobby | street | office>
props: [<kebab-case, at most 12, at most 32 chars each>]
language: <en | pt-BR>
settings:
  pulseIntervalMs: 3000
channels:
  - { id: <id>, type: public_channel, name: <name>, default: true, members: [<agentIds>] }
familiarity:
  <a>:<b>: <close_friends | friends | acquaintances | strangers>
cast:
  - agentId: <id>
    persona: <id>.persona.md
    displayName: <name>
    presence: active
    mood: { valence: <-1..1>, arousal: <0..1>, stability: <0..1>, energy: <0..1> }
    social: { <jealousy | envy | humiliation | pride | shame | affection | resentment | suspicion | admiration | contempt | neediness | socialAnxiety | fearOfExclusion | desireForStatus | desireForIntimacy>: <0..1> }
priorEvents:
  - type: message
    actorId: <id>
    channelId: <channel id>
    pulseIndex: 0
    minutesAgo: <n>
    payload: { content: "<line, at most 200 chars>", tone: <hostile | accusing | betrayal | humiliating | tender | romantic>, personTargets: [<id>] }
drama: { max_rung: <0..6>, may_target: [[<aggressor>, <victim>]], may_die: [<victim>], permadeath: <true | false> }
beats:
  - { at: <seconds>, actor: <id>, verb: <verb>, with: <id>, skip: <true> }
  - { at: <seconds>, cut: "<reason, at most 40 chars>" }
---

## Room Context
## Starting Mood
## Intro Behavior
## First Move

## Agent: <id>

### Hidden Objective
<the scene goal, then (resource: <snake_case_token>)>
Constraint: <what stops them>
Cost of exposure: <what they lose>
Breaking point: <the event that makes the tactic change>
```

`setting` and `props` are viewer-only; the simulation never reads them. `stage_frame` is the same kind of thing and lives only in `plan.json` and in the prose of `First Move`.

## Where the plan lands in the scenario

| Plan field | Scenario |
|---|---|
| `scene_metadata.given_circumstances` | `Room Context` and `priorEvents` |
| `macro_conflict` | `Room Context`, last sentence |
| `start_zone` | `First Move` (who stands where, in words) |
| `scene_goal`, `obstacle` | `Hidden Objective` and `Constraint` |
| `expectation` | `Cost of exposure` |
| A beat's trigger (what makes a tactic fail) | `Breaking point` |
| `emotion_vector` at the start | `mood` and `social` |
| `baseline_status` | `social.desireForStatus` and `pride` high, `socialAnxiety` and `shame` low for high status; the reverse for low status (see `references/status-and-space.md` in the runtime skill) |
| `SCRIPTED` beat with an act | `beats:` entry. Use `skip: true` only when the plan says `skip` |
| `STEERED` beat | No entry. It is carried by the fields above |
| `scene_cuts` | `beats:` cut entries |
| `drama` | `drama:` block, same values |

Every scripted beat's actor and `with` are agent ids from `cast`. `with` is omitted for `die`, `recoil`, `freeze_gasp`, `cry`, `storm_off`, `tableau` and `faint`, and present for every other verb.

## Preset files

Scene preset, `scenes/<scene>/preset.json`: `{ "title": "...", "blurb": "...", "cast": "<cast folder id>" }`.
Cast preset, `casts/<cast>/preset.json`: `{ "title": "...", "blurb": "..." }`.
Both are in the user's language.
