/* eslint-disable */
/**
 * GENERATED, DO NOT EDIT.
 * Source: packages/hotel/schema/director.schema.json (vendored from Tilehouse,
 * see schema/SOURCE.md). Regenerate: pnpm --filter @perfectman/hotel gen:director
 */
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "HotelMsg".
 */
export type HotelMsg =
  | {
      actors: HelloActor[];
      caps?: string[];
      /**
       * The drama offer: vocabulary, chip and harm numbers, and the dead set (NEG-2, NEG-8).
       */
      drama?: HelloDrama | null;
      hotel: HotelInfo;
      /**
       * Always `PROTO_BASE` (NEG-1).
       */
      proto: number;
      /**
       * The highest dialect the hotel offers. Present whenever Perfectman is on (NEG-2, D58).
       */
      proto_max?: number | null;
      /**
       * Rooms the sidecar may travel to: every official room (the Perfectman wing included) and each room a live run is in, at most `HELLO_ROOMS_MAX`. Absent from an older hotel.
       */
      rooms?: HelloRoom[];
      runs: HelloRun[];
      session: string;
      t: "hello";
      /**
       * JSON paths of strings a stranger wrote (section 7.1).
       */
      untrusted_text?: string[];
    }
  | {
      lease: number;
      run: number;
      t: "lease";
    }
  | {
      admin: AdminRef;
      cap_actors: number;
      lease: number;
      mode: RunMode;
      /**
       * The model the admin picked for this run (D54). Link 1 of the chain for this run; the configured chain stays behind it as failover. Absent: the chain as configured.
       */
      model?: RunModel | null;
      room: number;
      run: number;
      scenario_version: number;
      t: "run_start";
    }
  | {
      reason: HotelEndReason;
      run: number;
      t: "run_end";
    }
  | {
      /**
       * Absent for `source:"auto"`.
       */
      admin?: AdminRef | null;
      /**
       * Command arguments, unparsed. `whisper` takes `<name> <text>` with a name that contains spaces quoted (D51): `"Ana Clara" hello`. `auto` pauses carry `idle`.
       */
      args?: string;
      cmd: PmCmd;
      room: number;
      run: number;
      source: CommandSource;
      t: "pm_command";
    }
  | {
      actor: number;
      cid: number;
      dir: number;
      ref: string;
      room: number;
      t: "actor_spawned";
      x: number;
      y: number;
    }
  | {
      actor: number;
      reason: ActorGoneReason;
      run: number;
      t: "actor_gone";
    }
  | {
      actor?: number | null;
      /**
       * Absent when the failing frame had none (for example an unknown `t`).
       */
      cid?: number | null;
      code: ActorErrorCode;
      detail?: string | null;
      t: "actor_error";
    }
  | {
      avatars: Avatar[];
      background?: string;
      defs: {
        [k: string]: SnapDef | undefined;
      };
      furni: Furni[];
      layout: SnapLayout;
      /**
       * Untrusted: the room owner wrote it.
       */
      name: string;
      owner: number;
      pet?: string;
      rev: number;
      room: number;
      seats: SnapSeat[];
      t: "room_snapshot";
      template: string;
      untrusted_text?: string[];
      /**
       * `.` blocked or void, `0` open, `s` seat, `g` gate or portal; one string per row.
       */
      walk: string[];
    }
  | {
      msg: ServerMsg;
      rev: number;
      room: number;
      t: "delta";
    }
  | {
      rev: number;
      room: number;
      t: "room_ping";
    }
  | {
      at: number;
      from: PersonRef;
      had_image?: boolean;
      /**
       * `say`, `shout` or `whisper`; a whisper is forwarded only when `to` is an Actor (D44).
       */
      mode: ChatMode;
      rev: number;
      room: number;
      t: "human_chat";
      text: string;
      to?: number | null;
      /**
       * Always true: human chat is untrusted in-world speech (D22).
       */
      untrusted: boolean;
      untrusted_text?: string[];
    }
  | {
      actor: number;
      plan?: string | null;
      room: number;
      t: "arrived";
      x: number;
      y: number;
    }
  | {
      actor: number;
      eta_ms: number;
      plan?: string | null;
      steps: number;
      t: "walk_started";
    }
  | {
      actor: number;
      from: number;
      t: "moved_room";
      to: number;
      x: number;
      y: number;
    }
  | {
      room: number;
      t: "room_closed";
    }
  | {
      actor: number;
      at: number;
      outcome: PairOutcome;
      pair: string;
      /**
       * Why a drama session's `pair` was refused (PAIR-1): `kill_switch`, `calm_room` or `cooldown`. Never set towards a dialect 1 session.
       */
      reason?: BlockedReason | null;
      run: number;
      t: "pair_reaction";
      with: number;
    }
  | {
      act_id: string;
      actor: number;
      at: number;
      authored_skip: boolean;
      chip: boolean;
      /**
       * Planned `Tc - T0`; `null` when a chip decides.
       */
      contact_in_ms?: number | null;
      impact?: ImpactClass | null;
      intensity: number;
      origin: Origin;
      room: number;
      run: number;
      rung?: number | null;
      /**
       * `"<run>.<n>"` (SCENE-1).
       */
      scene: string;
      skipped_rungs: Verb[];
      t: "act_started";
      /**
       * Present only when `with` is a human; always `true` since D59.
       */
      target_opt_in?: boolean | null;
      verb: Verb;
      with?: number | null;
    }
  | {
      act_id: string;
      at: number;
      beat: BeatKind;
      /**
       * The only ground truth of what is owed (REA-2).
       */
      owed: Owed[];
      room: number;
      run: number;
      t: "act_beat";
      /**
       * Ascending numeric id: actors (negative) first.
       */
      witnesses: number[];
    }
  | {
      act_id: string;
      at: number;
      /**
       * A label of `enums.reaction_labels` (source `table`) or `cmd:<k>` (source `planner`).
       */
      reaction: string;
      role: ReactionRole;
      room: number;
      run: number;
      source: ReactionSource;
      t: "act_reaction";
      who: number;
    }
  | {
      act_id: string;
      actor: number;
      /**
       * The chip answer; present iff a chip was shown.
       */
      answer?: ChipAnswer | null;
      at: number;
      detail?: string | null;
      downgraded: Downgrade[];
      outcome: Outcome2;
      /**
       * Empty for every table-driven act (REA-10).
       */
      owed_missed: OwedMissed[];
      reason?: ActReason | null;
      room: number;
      run: number;
      t: "act_done";
      verb: Verb;
      with?: number | null;
    }
  | {
      act_id: string;
      actor: number;
      /**
       * On `answered`; a timeout is `answer:"timeout"` at `shown.at + ttl_ms`.
       */
      answer?: ChipAnswer | null;
      at: number;
      family: ConsentFamily;
      phase: ConsentPhase;
      room: number;
      run: number;
      t: "drama_consent";
      /**
       * On `shown`.
       */
      ttl_ms?: number | null;
      verb: Verb;
      with: number;
    }
  | {
      act_id: string;
      actor: number;
      at: number;
      cause: DeathCause;
      killer?: number | null;
      room: number;
      run: number;
      scene: string;
      t: "actor_death";
    }
  | {
      actor: number;
      at: number;
      /**
       * The effect it had before it died; empty for none.
       */
      effect: string;
      prev: string;
      room: number;
      run: number;
      scene: string;
      t: "actor_revive";
      x: number;
      y: number;
    }
  | {
      act_id: string;
      at: number;
      human: number;
      ms: number;
      room: number;
      run: number;
      scene: string;
      t: "human_down";
    }
  | {
      act_id: string;
      at: number;
      human: number;
      reason: HumanUpReason;
      room: number;
      run: number;
      t: "human_up";
    }
  | {
      at: number;
      prev: string;
      reason: SceneCutReason;
      removed: number[];
      revived: number[];
      run: number;
      scene: string;
      t: "scene_cut";
    }
  | {
      at: number;
      calm: boolean;
      enabled: boolean;
      /**
       * Every human avatar in the room: all of them are opted in since D59.
       */
      opt_in: number[];
      paused: boolean;
      paused_until?: number | null;
      room: number;
      run: number;
      scene: string;
      t: "drama_state";
    };
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "AvatarState".
 */
export type AvatarState = ("stand" | "walk" | "sit" | "lay") | "dance";
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "RunMode".
 */
export type RunMode = "default" | "cinematic";
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "RunState".
 */
export type RunState =
  "starting" | "running" | "paused" | "stopping" | "ended" | "interrupted" | "failed";
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "ModelReasoning".
 */
export type ModelReasoning = "none" | "optional" | "mandatory";
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "HotelEndReason".
 */
export type HotelEndReason = "idle_timeout" | "killall" | "lease_expired" | "hotel_shutdown";
/**
 * `start`, `killall` and `open` are hotel-local and never forwarded.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "PmCmd".
 */
export type PmCmd =
  "stop" | "pause" | "resume" | "inject" | "whisper" | "replay" | "status" | "wipe_memory";
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "CommandSource".
 */
export type CommandSource = "chat" | "panel" | "auto";
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "ActorGoneReason".
 */
export type ActorGoneReason =
  | (
      | "despawned"
      | "kicked"
      | "muted_out"
      | "room_closed"
      | "lease_expired"
      | "sidecar_lost"
      | "killall"
      | "hotel_shutdown"
    )
  | "died";
/**
 * `actor_error.code`, plus the section 9 table of the doc.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "ActorErrorCode".
 */
export type ActorErrorCode =
  | "bad_message"
  | "disabled"
  | "stale_lease"
  | "no_such_run"
  | "run_ended"
  | "run_limit"
  | "actor_limit"
  | "unknown_actor"
  | "no_such_room"
  | "not_subscribed"
  | "too_many_subscriptions"
  | "room_full"
  | "human_slots"
  | "name_taken"
  | "bad_name"
  | "bad_figure"
  | "no_route"
  | "action_not_here"
  | "slow_down"
  | "rate_limited"
  | "muted"
  | "not_a_seat"
  | "not_adjacent"
  | "target_gone"
  | "internal"
  | "unknown_verb"
  | "target_required"
  | "target_forbidden"
  | "bad_target"
  | "act_busy"
  | "actor_dead";
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "Action".
 */
export type Action =
  | ("wave" | "blow" | "laugh" | "thumbs" | "sit" | "stand" | "lay")
  | "dance"
  | "idle"
  | "sign"
  | "stop"
  | "expression"
  | "turn";
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "ServerMsg".
 */
export type ServerMsg =
  | {
      bot?: boolean;
      coins?: number;
      effect?: string;
      features?: Features;
      figure?: string;
      id: number;
      look: Look;
      name: string;
      t: "welcome";
    }
  | {
      avatars: Avatar[];
      background?: string;
      can_edit: boolean;
      /**
       * A cinematic cut: keep the camera, the HUD and the drawers.
       */
      cut?: boolean;
      furni: Furni[];
      id: number;
      landscape?: string;
      /**
       * The room has a password. Sent only to those who may change it.
       */
      locked?: boolean;
      mood_light?: MoodLight;
      name: string;
      owner: number;
      pet?: string;
      shell?: RoomShell;
      /**
       * You are watching without an avatar (Audience, or a cut): `me` is not in `avatars`.
       */
      spectating?: boolean;
      surfaces?: RoomSurfaces;
      t: "room_joined";
      template: string;
    }
  | {
      locked: boolean;
      t: "room_lock_changed";
    }
  | {
      room: number;
      t: "password_needed";
      wrong?: boolean;
    }
  | {
      can_edit: boolean;
      rights: boolean;
      t: "rights_changed";
    }
  | {
      t: "room_rights";
      users: RightsHolder[];
    }
  | {
      reason?: string | null;
      t: "room_left";
    }
  | {
      avatar: Avatar;
      t: "avatar_joined";
    }
  | {
      id: number;
      t: "avatar_left";
    }
  | {
      moves: AvatarMove[];
      t: "moves";
    }
  | {
      id: number;
      look: Look;
      t: "look_changed";
    }
  | {
      effect: string;
      figure: string;
      id: number;
      t: "appearance_changed";
    }
  | {
      background: string;
      pet: string;
      t: "room_style_changed";
    }
  | {
      surfaces: RoomSurfaces;
      t: "room_surfaces_changed";
    }
  | {
      shell: RoomShell;
      t: "room_shell_changed";
    }
  | {
      light: MoodLight;
      t: "mood_light_changed";
    }
  | {
      landscape: string;
      t: "landscape_changed";
    }
  | {
      /**
       * Spoken by an AI Actor. Players see the badge; never in Director payloads (D43).
       */
      ai?: boolean;
      bold?: boolean;
      bot?: boolean;
      from: number;
      image?: ChatImage | null;
      mode?: ChatMode & string;
      name: string;
      t: "chat";
      text: string;
      /**
       * For a whisper, whom it was to.
       */
      to?: string | null;
      /**
       * Free text from a stranger that a bot must not treat as an instruction.
       */
      untrusted?: boolean;
    }
  | {
      addressed: boolean;
      at: number;
      bot?: boolean;
      from: number;
      name: string;
      t: "chat_activity";
    }
  | {
      count: number;
      t: "mentions_dropped";
    }
  | {
      action: Action;
      id: number;
      /**
       * How long a table gesture plays before the idle pose returns, with no `stop` (TBL-15). Set only by the drama sequencer.
       */
      ms?: number | null;
      style?: number | null;
      t: "avatar_action";
    }
  | {
      furni: Furni;
      t: "furni_added";
    }
  | {
      furni: Furni;
      t: "furni_moved";
    }
  | {
      id: number;
      t: "furni_removed";
    }
  | {
      id: number;
      state: number;
      t: "furni_state_changed";
    }
  | {
      labels: {
        [k: string]: number | undefined;
      };
      t: "batch_applied";
    }
  | {
      failed: BatchFailure[];
      t: "batch_refused";
    }
  | {
      id: number;
      ms: number;
      t: "furni_rolling";
    }
  | {
      from: number;
      id: number;
      name: string;
      outcome: Outcome;
      payout?: number;
      stake?: number;
      t: "casino_result";
      text: string;
    }
  | {
      id: string;
      t: "image_removed";
    }
  | {
      balance: number;
      delta: number;
      reason: string;
      t: "coins_changed";
    }
  | {
      t: "announce";
      text: string;
    }
  | {
      /**
       * Whether you may switch games on and off here.
       */
      configurable: boolean;
      enabled: GameKind[];
      game?: GameView | null;
      t: "game_state";
    }
  | {
      t: "game_line";
      text: string;
    }
  | {
      t: "reported";
    }
  | {
      t: "friend_request_sent";
    }
  | {
      t: "friends_changed";
    }
  | {
      at: number;
      bot?: boolean;
      from: number;
      id: number;
      image?: ChatImage | null;
      name: string;
      t: "dm";
      text: string;
      to: number;
    }
  | {
      code: ErrorCode;
      t: "error";
    }
  | {
      reason: string;
      t: "disconnect";
    }
  | {
      id: number;
      on: boolean;
      t: "typing";
    }
  | {
      enabled: boolean;
      room: number;
      runs: RunBrief[];
      sidecar: boolean;
      start?: boolean;
      t: "perfectman_open";
    }
  | {
      t: "perfectman_ui";
      ui: PerfectmanUi;
    }
  | {
      from: number;
      kind: PairKind;
      name: string;
      pair: string;
      t: "pair_prompt";
      ttl_ms: number;
    }
  | {
      from: string;
      t: "whisper_notice";
      to: string;
    }
  | {
      args?: {
        [k: string]: string | undefined;
      };
      code: string;
      t: "notice";
    }
  | {
      mode: RunMode;
      run: number;
      t: "audience_started";
      title: string;
    }
  | {
      reason: string;
      t: "audience_ended";
    }
  | {
      act_id: string;
      choices: ChipChoice[];
      /**
       * The focused button and the Escape answer: always `dodge`.
       */
      default: ChipChoice;
      family: ConsentFamily;
      from: number;
      name: string;
      t: "act_prompt";
      timeout_as: TimeoutAs;
      ttl_ms: number;
      verb: Verb;
    }
  | {
      act_id: string;
      reason: PromptClose;
      t: "act_prompt_close";
    }
  | {
      act_id: string;
      actor: number;
      base_at: number;
      class?: ImpactClass | null;
      phase: TimelinePhase;
      steps: TimelineStep[];
      t: "act_timeline";
      verb: Verb;
      with?: number | null;
    }
  | {
      act_id: string;
      id: string;
      name: string;
      reason: OverlayClear;
      t: "act_overlay_clear";
      who: number;
    }
  | {
      calm: boolean;
      enabled: boolean;
      opt_in: boolean;
      paused: boolean;
      t: "drama_status";
    };
/**
 * What an attachment is. Both `thumb` and `full` exist for every kind; the thumb is always a still.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "MediaKind".
 */
export type MediaKind = "image" | "gif" | "video";
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "ChatMode".
 */
export type ChatMode = ("say" | "shout" | "whisper") | "thought" | "caption";
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "ErrorCode".
 */
export type ErrorCode =
  | (
      | "bad_message"
      | "not_authenticated"
      | "no_such_room"
      | "room_full"
      | "not_in_room"
      | "not_allowed"
      | "no_route"
      | "muted"
      | "rate_limited"
      | "no_such_user"
      | "not_friends"
      | "too_many_friends"
      | "too_many_blocks"
      | "not_enough_coins"
      | "internal"
    )
  | {
      place: PlaceError;
    }
  | "too_soon"
  | "blocked_by_you"
  | "game_running"
  | "action_not_here"
  | "slow_down"
  | "too_far"
  | "busy"
  | "not_a_game"
  | "no_such_image"
  | "not_implemented";
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "PlaceError".
 */
export type PlaceError =
  | (
      | "unknown_furni"
      | "bad_rotation"
      | "out_of_bounds"
      | "not_flat"
      | "occupied"
      | "door_blocked"
      | "room_full"
      | "no_wall"
    )
  | "bad_spot"
  | "not_layered";
/**
 * What came up, for showing to the room.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "Outcome".
 */
export type Outcome =
  | {
      faces: number;
      g: "die";
      value: number;
    }
  | {
      dir: number;
      g: "bottle";
    }
  | {
      faces: number;
      g: "wheel";
      value: number;
    }
  | {
      g: "slot";
      /**
       * @minItems 3
       * @maxItems 3
       */
      reels: [Symbol, Symbol, Symbol];
    }
  | {
      g: "roulette";
      number: number;
      on: RouletteBet;
    }
  | {
      dealer: Card;
      g: "high_card";
      you: Card;
    };
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "Symbol".
 */
export type Symbol = "lemon" | "plum" | "cherry" | "bell" | "bar" | "seven";
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "RouletteBet".
 */
export type RouletteBet =
  | {
      k: "number";
      n: number;
    }
  | {
      k: "red";
    }
  | {
      k: "black";
    }
  | {
      k: "odd";
    }
  | {
      k: "even";
    }
  | {
      k: "low";
    }
  | {
      k: "high";
    }
  | {
      k: "dozen";
      n: number;
    };
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "GameKind".
 */
export type GameKind = "chair_dance" | "banzai" | "ice_tag" | "football" | "falling_floor";
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "Phase".
 */
export type Phase = "lobby" | "running" | "finished";
/**
 * Team colours shared by the team games, matching the `_r`, `_g`, `_b` and `_y` pieces.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "Team".
 */
export type Team = "red" | "green" | "blue" | "yellow";
/**
 * The `ui_push.ui` union, discriminated by `k`. Also the payload of `ServerMsg::PerfectmanUi`. `Cut` is sidecar to hotel only: the hotel performs it and never forwards it. Every cinematic kind takes an optional `in_ms` delay so the Director's lookahead (D18) can send cues early.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "PerfectmanUi".
 */
export type PerfectmanUi =
  | {
      actors: PanelActor[];
      breaker: Breaker;
      budget_warn_usd?: number | null;
      cost_usd: number;
      elapsed_s: number;
      /**
       * Only while `pause_cause` is `idle`.
       */
      idle_ends_in_s?: number | null;
      k: "run_panel";
      llm_calls: number;
      /**
       * LLM call latency from the last `run_status` (D53). Absent until the sidecar reports it.
       */
      llm_p50_ms?: number | null;
      llm_p95_ms?: number | null;
      pause_cause?: PauseCause | null;
      pulse: number;
      run: number;
      state: RunState;
      title: string;
      tokens_in: number;
      tokens_out: number;
    }
  | {
      code?: string | null;
      k: "notice";
      kind?: NoticeKind & string;
      text?: string | null;
    }
  | {
      k: "replay_ready";
      run: number;
      url?: string | null;
    }
  | {
      fade?: Fade | null;
      in_ms?: number | null;
      k: "hud";
      letterbox?: boolean | null;
    }
  | {
      in_ms?: number | null;
      k: "card";
      kind: CardKind;
      ms: number;
      subtitle?: string | null;
      title: string;
    }
  | {
      in_ms?: number | null;
      k: "lower_third";
      ms: number;
      name: string;
      role?: string | null;
    }
  | {
      in_ms?: number | null;
      k: "caption";
      ms: number;
      text: string;
    }
  | {
      id: number;
      in_ms?: number | null;
      k: "thought";
      ms: number;
      text: string;
    }
  | {
      emotion: string;
      id: number;
      in_ms?: number | null;
      k: "cue";
      ms: number;
    }
  | {
      ease_ms: number;
      follow?: boolean;
      hold_ms: number;
      in_ms?: number | null;
      k: "camera";
      shot: Shot;
      target: ShotTarget;
      zoom: ShotZoom;
    }
  | {
      /**
       * `shake`: the strongest offset, in screen pixels.
       */
      amp_px?: number | null;
      /**
       * `dolly`: the ease; `in_out` when absent.
       */
      curve?: FxCurve | null;
      /**
       * `slowmo`: the animation time scale, 0.25 to 1.
       */
      factor?: number | null;
      /**
       * `vignette` and `grade`: how long it stays at full strength before it eases out. Absent: until the next one.
       */
      hold_ms?: number | null;
      in_ms?: number | null;
      /**
       * `vignette` and `grade`: how strong, 0 to 1. 0 clears it.
       */
      intensity?: number | null;
      k: "camera_fx";
      move: FxMove;
      /**
       * How long the move takes (a `hitstop`, `slowmo` or `shake`: how long it lasts).
       */
      ms: number;
      /**
       * `grade`: `#rrggbb`.
       */
      tint?: string | null;
      /**
       * `dolly`: the zoom to reach, 0.5 to 2.5.
       */
      to_zoom?: number | null;
    }
  | {
      /**
       * @minItems 2
       * @maxItems 2
       */
      at?: [number, number] | null;
      cue: string;
      gain?: number | null;
      id?: string | null;
      in_ms?: number | null;
      k: "sfx";
      loop?: boolean;
      stop?: string | null;
    }
  | {
      in_ms?: number | null;
      k: "cut_fx";
      kind: CutFxKind;
      label?: string | null;
      ms: number;
    }
  | {
      k: "next_room";
      room: number;
    }
  | {
      k: "cut";
      room: number;
    };
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "Breaker".
 */
export type Breaker = "open" | "closed";
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "PauseCause".
 */
export type PauseCause = "admin" | "idle" | "breaker";
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "NoticeKind".
 */
export type NoticeKind = "info" | "warn" | "error";
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "CardKind".
 */
export type CardKind = "title" | "scene";
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "Shot".
 */
export type Shot =
  "establishing" | "two_shot" | "close_up" | "tracking" | "reaction" | "insert" | "transition";
/**
 * What a shot points at. Externally tagged: `{"avatar":-701}`, `{"pair":[1,2]}`, `{"tile":[3,4]}`, `{"furni":5}`, `{"room":true}`.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "ShotTarget".
 */
export type ShotTarget =
  | {
      avatar: number;
    }
  | {
      /**
       * @minItems 2
       * @maxItems 2
       */
      pair: [number, number];
    }
  | {
      /**
       * @minItems 2
       * @maxItems 2
       */
      tile: [number, number];
    }
  | {
      furni: number;
    }
  | {
      room: boolean;
    };
/**
 * A shot's resting zoom: 0.5, 1 or 2, or `"fit"`.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "ShotZoom".
 */
export type ShotZoom = number | FitZoom;
/**
 * The literal `"fit"`: the room's own opening zoom.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "FitZoom".
 */
export type FitZoom = "fit";
/**
 * The ease of a `dolly`.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "FxCurve".
 */
export type FxCurve = "in_out" | "linear" | "in" | "out";
/**
 * The camera moves beyond a shot (`PerfectmanUi::CameraFx`). A client that does not know a move ignores the cue.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "FxMove".
 */
export type FxMove = "dolly" | "shake" | "slowmo" | "vignette" | "hitstop" | "grade";
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "CutFxKind".
 */
export type CutFxKind = "fade" | "door" | "meanwhile";
/**
 * A pair act between two avatars.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "PairKind".
 */
export type PairKind = "kiss" | "hug";
/**
 * What a human can press on the chip (`act_reply.choice`, `act_prompt.choices`).
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "ChipChoice".
 */
export type ChipChoice = "take" | "dodge" | "push_back";
/**
 * The label set of a chip.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "ConsentFamily".
 */
export type ConsentFamily = "violent" | "affection";
/**
 * What silence means on a chip: `dodge`, or the act completing with the initiator's steps only (a hug).
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "TimeoutAs".
 */
export type TimeoutAs = "dodge" | "initiator_only";
/**
 * The 25 verbs (section 0.2, plus the seven of table rev 4). The wire spelling is the table's id.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "Verb".
 */
export type Verb =
  | "glare"
  | "insult"
  | "shove"
  | "slap"
  | "punch"
  | "kill"
  | "die"
  | "recoil"
  | "freeze_gasp"
  | "hug"
  | "kiss"
  | "turn_back"
  | "cry"
  | "storm_off"
  | "tableau"
  | "restrain"
  | "faint"
  | "tend_fallen"
  | "point"
  | "grab"
  | "push_away"
  | "slump"
  | "kneel"
  | "flee"
  | "plead";
/**
 * Why `act_prompt_close` closed the chip.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "PromptClose".
 */
export type PromptClose = "answered" | "timeout" | "aborted";
/**
 * The impact class of an act (TBL-4). The wire spelling is one capital letter.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "ImpactClass".
 */
export type ImpactClass = "L" | "M" | "H" | "F";
/**
 * Which phase of an act a `act_timeline` frame carries (section 3.11).
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "TimelinePhase".
 */
export type TimelinePhase = "pre" | "post" | "all";
/**
 * A step of an `act_timeline`: `at` is in ms from the frame's `base_at` and may be negative.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "TimelineStep".
 */
export type TimelineStep = {
  at: number;
} & TimelineStep1;
export type TimelineStep1 =
  | {
      emotion: string;
      ms: number;
      on: number;
      p: "cue";
    }
  | {
      cue: string;
      p: "sfx";
    }
  | {
      ms: number;
      p: "caption";
      text: string;
    }
  | {
      away_from?: number | null;
      back_ms?: number | null;
      bounce_px?: number | null;
      color?: string | null;
      curve?: string | null;
      drop_px?: number | null;
      frame_ms?: number | null;
      frames?: number | null;
      in_ms?: number | null;
      ms?: number | null;
      name: Motion;
      overshoot_px?: number | null;
      p: "motion";
      px?: number | null;
      rot_deg?: number | null;
      toward?: number | null;
      who: MotionWho;
    }
  | {
      id: string;
      name: string;
      p: "overlay";
      until: OverlayUntil;
      who: number;
    };
/**
 * The seven client procedural motions (section 5.8).
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "Motion".
 */
export type Motion =
  "lunge" | "hit_stop" | "tint_flash" | "knockback" | "shake" | "recoil" | "fall";
/**
 * `motion.who`: an avatar id, or `"both"` (the actor and the target).
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "MotionWho".
 */
export type MotionWho = number | Both;
/**
 * The only value of `motion.who` besides an avatar id.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "Both".
 */
export type Both = "both";
/**
 * `overlay.until`: after that many ms, at the next scene cut, or when `act_overlay_clear` says so.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "OverlayUntil".
 */
export type OverlayUntil = number | OverlayEnd;
/**
 * How an overlay ends besides a number of milliseconds.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "OverlayEnd".
 */
export type OverlayEnd = "scene_cut" | "cleared";
/**
 * Why `act_overlay_clear` ended an overlay (OVL-2, OVL-3).
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "OverlayClear".
 */
export type OverlayClear = "cleared" | "scene_cut";
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "PairOutcome".
 */
export type PairOutcome = "accept" | "timeout" | "dodge" | "push" | "aborted" | "done";
/**
 * Why a gate refused an accepted command (`outcome:"blocked"`), in no order.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "BlockedReason".
 */
export type BlockedReason =
  | "kill_switch"
  | "calm_room"
  | "consent_off"
  | "ladder"
  | "budget"
  | "cooldown"
  | "too_far"
  | "dead_target"
  | "no_scenario_gate"
  | "rate_limit";
/**
 * Who asked for an act: the model, the director or the scenario's author.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "Origin".
 */
export type Origin = "model" | "director" | "scenario";
/**
 * `act_beat.beat`: only `contact` in this revision.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "BeatKind".
 */
export type BeatKind = "contact";
/**
 * Who owes a reaction.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "ReactionRole".
 */
export type ReactionRole = "target" | "witness";
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "ReactionSource".
 */
export type ReactionSource = "table" | "planner";
/**
 * How a human answered a consent chip, including silence.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "ChipAnswer".
 */
export type ChipAnswer = "take" | "dodge" | "push_back" | "timeout";
/**
 * Table steps that were skipped or replaced (`act_done.downgraded`). `chat` is REA-9's muted line, which the table of section 3.6 does not list (spec defect, see `docs/perfectman/decisions.md`).
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "Downgrade".
 */
export type Downgrade = "forced_step" | "face" | "walk_to" | "gesture" | "posture" | "chat";
/**
 * `act_done.outcome`.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "Outcome2".
 */
export type Outcome2 = "landed" | "dodged" | "blocked" | "declined" | "timeout" | "aborted";
/**
 * `act_done.reason`: a blocked reason or an abort reason. `kill_switch` and `calm_room` are both.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "ActReason".
 */
export type ActReason =
  | "kill_switch"
  | "calm_room"
  | "consent_off"
  | "ladder"
  | "budget"
  | "cooldown"
  | "too_far"
  | "dead_target"
  | "no_scenario_gate"
  | "rate_limit"
  | "target_moved"
  | "target_gone"
  | "actor_gone"
  | "actor_dead"
  | "scene_cut"
  | "run_end"
  | "paused"
  | "opt_out";
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "ConsentPhase".
 */
export type ConsentPhase = "shown" | "answered";
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "DeathCause".
 */
export type DeathCause = "kill" | "die";
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "HumanUpReason".
 */
export type HumanUpReason = "timer" | "left" | "closed";
/**
 * `scene_cut.reason`: always `sidecar`; the field stays so a later revision can add causes.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "SceneCutReason".
 */
export type SceneCutReason = "sidecar";
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "JobOp".
 */
export type JobOp = "validate" | "compile" | "draft" | "autolook" | "ai_draft" | "ai_crew";
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "JobState".
 */
export type JobState = "queued" | "running" | "done" | "failed";
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "SidecarMsg".
 */
export type SidecarMsg =
  | {
      /**
       * `["drama.v1"]` from a dialect 2 sidecar; absent otherwise (NEG-3).
       */
      caps?: string[];
      proto: number;
      resume?: number[];
      sidecar: SidecarInfo;
      t: "hello_ack";
    }
  | {
      run: number;
      t: "run_heartbeat";
    }
  | {
      error?: ErrorInfo | null;
      ok: boolean;
      run: number;
      t: "run_ack";
    }
  | {
      breaker?: Breaker | null;
      cost_usd: number;
      /**
       * Event-loop lag of the sidecar, not LLM latency.
       */
      lag_ms?: number | null;
      llm_calls: number;
      /**
       * Median latency of the run's LLM calls over the sidecar's recent window (D53).
       */
      llm_p50_ms?: number | null;
      /**
       * 95th percentile of the same window (D53).
       */
      llm_p95_ms?: number | null;
      pause_cause?: PauseCause | null;
      pulse: number;
      run: number;
      state: RunState;
      t: "run_status";
      tokens_in: number;
      tokens_out: number;
      undelivered_committed: number;
    }
  | {
      reason: SidecarEndReason;
      run: number;
      summary?: string | null;
      t: "run_end";
    }
  | {
      resnapshot?: boolean;
      room: number;
      t: "subscribe_room";
    }
  | {
      room: number;
      t: "unsubscribe_room";
    }
  | {
      cid: number;
      effect?: string;
      figure: string;
      lease: number;
      name: string;
      /**
       * The sidecar's agent id; the hotel stores and echoes it, never interprets it.
       */
      ref: string;
      room: number;
      run: number;
      t: "actor_spawn";
      /**
       * @minItems 2
       * @maxItems 2
       */
      tile?: [number, number] | null;
    }
  | {
      actor: number;
      cid: number;
      lease: number;
      mode: DespawnMode;
      run: number;
      t: "actor_despawn";
    }
  | {
      actor: number;
      cid: number;
      cmd: ActorCmd;
      lease: number;
      run: number;
      t: "actor_cmd";
    }
  | {
      /**
       * The run's lease. Optional so older sidecars still connect; when present it must be current.
       */
      lease?: number | null;
      run: number;
      t: "ui_push";
      to: UiTarget;
      ui: PerfectmanUi;
    }
  | {
      cid?: number | null;
      lease: number;
      /**
       * Free text, at most 40 characters, logged only.
       */
      reason: string;
      run: number;
      t: "scene_advance";
    };
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "SidecarEndReason".
 */
export type SidecarEndReason = "completed" | "stopped" | "failed" | "breaker";
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "DespawnMode".
 */
export type DespawnMode = "walk_out" | "now";
/**
 * What an Actor does. `k` discriminates.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "ActorCmd".
 */
export type ActorCmd =
  | {
      k: "walk";
      plan?: string | null;
      x: number;
      y: number;
    }
  | {
      floor?: boolean;
      furni?: number | null;
      k: "sit";
    }
  | {
      k: "chat";
      mode: ChatMode;
      text: string;
      to?: number | null;
    }
  | {
      action: Action;
      k: "action";
      style?: number | null;
    }
  | {
      face: Face;
      k: "expression";
    }
  | {
      dir?: number | null;
      k: "face";
      target?: FaceTarget | null;
      /**
       * @minItems 2
       * @maxItems 2
       */
      tile?: [number, number] | null;
    }
  | {
      k: "move_room";
      room: number;
      via?: Via | null;
    }
  | {
      k: "typing";
      on: boolean;
    }
  | {
      k: "pair";
      kind: PairKind;
      /**
       * The sidecar's id for this act, echoed in `pair_reaction`.
       */
      pair: string;
      with: number;
    }
  | {
      effect?: string | null;
      figure?: string | null;
      k: "appearance";
    }
  | {
      /**
       * `^[A-Za-z0-9_.:-]{1,32}$`, unique within the run for its whole life.
       */
      act_id: string;
      /**
       * Honoured only with `origin:"scenario"` (GATE-5).
       */
      authored_skip?: boolean;
      /**
       * `0..=1`; absent means the verb's default. Selects the impact class.
       */
      intensity?: number | null;
      k: "act";
      /**
       * Absent means `director`.
       */
      origin?: Origin | null;
      /**
       * `insult` only; at most 200 characters.
       */
      text?: string | null;
      verb: Verb;
      /**
       * An avatar in the actor's room: required for the targeted verbs, forbidden for the solo ones.
       */
      with?: number | null;
    }
  | {
      drink?: boolean | null;
      item?: string | null;
      k: "carry";
    };
/**
 * What an expression shows, as `Action::Expression` styles 0..=5.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "Face".
 */
export type Face =
  "neutral" | "smile" | "angry" | "sad" | "surprised" | "sleepy" | "fear" | "disgust" | "smug";
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "Via".
 */
export type Via = "door";
/**
 * Where a `ui_push` goes. Externally tagged: `{"admin":9}`, `{"run":7}`, `{"room":12}`, `{"users":[1,2]}`.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "UiTarget".
 */
export type UiTarget =
  | {
      admin: number;
    }
  | {
      run: number;
    }
  | {
      room: number;
    }
  | {
      users: number[];
    };

/**
 * Generated from crates/sim/src/director.rs (proto 2). Do not edit by hand: run `cargo test -p tilehouse-sim director_schema`.
 */
export interface PerfectmanDirectorContract {
  api_error: ApiError;
  autolook_request: AutolookRequest;
  autolook_response: AutolookResponse;
  compile_request: CompileRequest;
  compile_response: CompileResponse;
  draft_request: DraftRequest;
  draft_response: DraftResponse;
  hotel_to_sidecar: HotelMsg;
  job: Job;
  preset_list: PresetList;
  preset_source: PresetSource;
  proto: number;
  room_snapshot: RoomSnapshot;
  /**
   * Every frame also carries `seq` (a `u64` from 1 per connection and direction) beside `t`; see [`SidecarFrame`] and [`HotelFrame`]. It is left out here so the unions stay named types.
   */
  sidecar_to_hotel: SidecarMsg;
  ui: PerfectmanUi;
  validate_request: ValidateRequest;
  validate_response: ValidateResponse;
}
/**
 * Error body of every authoring and admin route: `400 bad_request`, `401`, `422 bad_scenario`, `503 llm_unavailable`, `504 timeout`.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "ApiError".
 */
export interface ApiError {
  error: string;
  /**
   * Present on `bad_scenario`.
   */
  errors?: PathMessage[];
  message?: string | null;
}
/**
 * `{path, message}` rows of a validation.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "PathMessage".
 */
export interface PathMessage {
  message: string;
  path: string;
}
/**
 * `catalog` is the constrained figure list the hotel supplies, one figure string per entry.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "AutolookRequest".
 */
export interface AutolookRequest {
  catalog: string[];
  characters: AutolookCharacter[];
}
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "AutolookCharacter".
 */
export interface AutolookCharacter {
  name: string;
  traits: string;
}
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "AutolookResponse".
 */
export interface AutolookResponse {
  looks: AutolookEntry[];
}
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "AutolookEntry".
 */
export interface AutolookEntry {
  effect?: string;
  figure: string;
  name: string;
}
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "CompileRequest".
 */
export interface CompileRequest {
  source: string;
}
/**
 * Invalid source is `422 {"error":"bad_scenario","errors":[...]}` (see [`ApiError`]).
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "CompileResponse".
 */
export interface CompileResponse {
  body: unknown;
  schema_version: number;
}
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "DraftRequest".
 */
export interface DraftRequest {
  brief: string;
  cast_size?: number | null;
  language: string;
}
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "DraftResponse".
 */
export interface DraftResponse {
  source: string;
}
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "HelloActor".
 */
export interface HelloActor {
  actor: number;
  dir: number;
  name: string;
  ref: string;
  room: number;
  run: number;
  state: AvatarState;
  x: number;
  y: number;
}
/**
 * What `hello.drama` tells a dialect 2 sidecar (NEG-2). Sent whenever Perfectman is on (D58).
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "HelloDrama".
 */
export interface HelloDrama {
  chip_ttl_ms: number;
  /**
   * Every actor that is `fainted`, `dying` or `body`: a full replacement set, not a delta (NEG-8).
   */
  dead?: number[];
  enabled: boolean;
  harm_max: number;
  harm_window_s: number;
  verb_vocab: VerbVocabRef;
}
/**
 * `{version, rev, sha256}` of the published `verb-vocab.json` bytes (NEG-7, VV-3). A `version` mismatch makes the sidecar answer dialect 1; `rev` or `sha256` only warn.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "VerbVocabRef".
 */
export interface VerbVocabRef {
  rev: number;
  sha256: string;
  version: number;
}
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "HotelInfo".
 */
export interface HotelInfo {
  build: string;
  human_reserve: number;
  join_interval_ms: number;
  max_actions_per_5s: number;
  max_avatars_per_room: number;
  max_chat: number;
  tick_ms: number;
}
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "HelloRoom".
 */
export interface HelloRoom {
  id: number;
  /**
   * Untrusted when the room is not official: its owner wrote it.
   */
  name: string;
  official: boolean;
  /**
   * The navigator section of an official room (`Featured`, `Casinos`, `Games`, `Perfectman`).
   */
  section?: string | null;
}
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "HelloRun".
 */
export interface HelloRun {
  mode: RunMode;
  room: number;
  /**
   * Untrusted: the room owner wrote it.
   */
  room_name: string;
  run: number;
  scenario_version: number;
  state: RunState;
}
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "AdminRef".
 */
export interface AdminRef {
  id: number;
  name: string;
}
/**
 * An OpenRouter model chosen for one run, with what the hotel knew of it when it was picked.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "RunModel".
 */
export interface RunModel {
  /**
   * Context window in tokens; the sidecar picks the compact prompt for 8192 or less.
   */
  context?: number | null;
  /**
   * The OpenRouter id, e.g. `minimax/minimax-m3.1-flash`.
   */
  id: string;
  /**
   * OpenRouter's listed price in USD per million tokens, for a model the sidecar has no price for.
   */
  price_in?: number | null;
  price_out?: number | null;
  /**
   * Whether the model thinks before it answers: `mandatory` models get a low effort, `optional` ones are told not to think.
   */
  reasoning?: ModelReasoning | null;
}
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "Avatar".
 */
export interface Avatar {
  /**
   * A dance or a doze under way, which people coming into the room are shown. Walking ends it.
   */
  action?: Action | null;
  action_style?: number | null;
  /**
   * An AI Actor: the client draws a badge. Never sent to the Director (D43).
   */
  ai?: boolean;
  bot?: boolean;
  /**
   * 0 is north-west on screen (towards -y), increasing clockwise in tile space.
   */
  dir: number;
  /**
   * Worn effect library name, empty for none.
   */
  effect?: string;
  /**
   * The current expression (`perfectman::Face` style, 0 is neutral), so late joiners match.
   */
  face?: number;
  /**
   * A `type:lib` figure string, empty for the procedural palette look.
   */
  figure?: string;
  id: number;
  look: Look;
  name: string;
  state: AvatarState;
  x: number;
  y: number;
}
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "Look".
 */
export interface Look {
  hair: number;
  pants: number;
  shirt: number;
  skin: number;
}
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "SnapDef".
 */
export interface SnapDef {
  d: number;
  h: number;
  lay: boolean;
  name: string;
  seat: boolean;
  states: number;
  w: number;
  walkable: boolean;
  wall: boolean;
}
/**
 * Where on its wall a piece hangs, in screen pixels at the default zoom. A piece placed before walls had a pixel grid has both at 0, which means the middle of the tile's edge at the height its art was drawn for (`WALL_MOUNT_LEVELS` unless the piece has its own).
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "Furni".
 */
export interface Furni {
  def: string;
  id: number;
  /**
   * Which of the flat pieces (rugs and wall pieces) that overlap is drawn over which: higher is nearer the viewer, and pieces with the same layer go by position and then by id.
   */
  layer?: number;
  /**
   * The cell along the tile's edge, 1 to `WALL_CELLS`, or 0 for the middle of the edge.
   */
  off?: number;
  /**
   * Quarter turns, 0..=3. Odd turns swap width and depth.
   */
  rot: number;
  /**
   * Which of the piece's states it's in. 0 is the resting one.
   */
  state?: number;
  /**
   * How high above the tile's floor the piece's origin is, in pixels, or 0 for its usual height.
   */
  up?: number;
  x: number;
  y: number;
  /**
   * How far up a stack it starts, in hundredths of a level above the floor. The server works this out when placing or moving it, and rooms from before stacking are all 0.
   */
  z?: number;
}
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "SnapLayout".
 */
export interface SnapLayout {
  /**
   * @minItems 2
   * @maxItems 2
   */
  door: [number, number];
  door_dir: number;
  /**
   * One char per tile: `x` void, `0-9a-w` floor level.
   */
  rows: string[];
}
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "SnapSeat".
 */
export interface SnapSeat {
  dir: number;
  furni: number;
  lay: boolean;
  tiles: [number, number][];
}
/**
 * Optional parts of the game this server has switched on.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "Features".
 */
export interface Features {
  coins?: boolean;
  images?: boolean;
  /**
   * Players may also send MP4 clips. Off when the server has no ffmpeg or `CHAT_VIDEO=off`.
   */
  video?: boolean;
}
/**
 * A room's mood light: three slots, `active` picks the one that tints the room.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "MoodLight".
 */
export interface MoodLight {
  active?: number;
  on?: boolean;
  /**
   * @minItems 3
   * @maxItems 3
   */
  presets?: [MoodPreset, MoodPreset, MoodPreset];
}
/**
 * One slot of the mood light: a swatch from `COLOURS`, how strongly it tints, and whether furniture and people are spared.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "MoodPreset".
 */
export interface MoodPreset {
  brightness?: number;
  colour?: number;
  surfaces_only?: boolean;
}
/**
 * A room's walls and floor slab. Every value is an offset from the template's look, so 0 is today's; thickness runs from -2 (thinnest) to 1 (thick), `wall_height` is whole levels.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "RoomShell".
 */
export interface RoomShell {
  floor_thickness?: number;
  hide_walls?: boolean;
  wall_height?: number;
  wall_thickness?: number;
}
/**
 * A room's own floor and wall, replacing the template's. An empty texture and a `None` colour mean the template's.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "RoomSurfaces".
 */
export interface RoomSurfaces {
  floor_colour?: number | null;
  floor_texture?: string;
  wall_colour?: number | null;
  wall_texture?: string;
}
/**
 * Someone who may edit a room's furniture because its owner said so.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "RightsHolder".
 */
export interface RightsHolder {
  id: number;
  name: string;
}
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "AvatarMove".
 */
export interface AvatarMove {
  dir: number;
  id: number;
  state: AvatarState;
  x: number;
  y: number;
}
/**
 * A picture, animated GIF or clip attached to a message. The file is served from `assets/chat/<id>/`.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "ChatImage".
 */
export interface ChatImage {
  h: number;
  id: string;
  kind?: MediaKind & string;
  w: number;
}
/**
 * Why one step of a `Batch` was refused.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "BatchFailure".
 */
export interface BatchFailure {
  code: ErrorCode;
  op: number;
}
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "Card".
 */
export interface Card {
  /**
   * 2 to 10, then 11 jack, 12 queen, 13 king, 14 ace.
   */
  rank: number;
  /**
   * 0 spades, 1 hearts, 2 diamonds, 3 clubs.
   */
  suit: number;
}
/**
 * What the Games window shows about the game a room is hosting.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "GameView".
 */
export interface GameView {
  /**
   * How long it runs, in seconds, for a game with a clock: the host's choice, or the default.
   */
  duration_secs?: number | null;
  host: number;
  kind: GameKind;
  min_players: number;
  phase: Phase;
  players: PlayerView[];
  result?: string | null;
  scores?: ScoreView[];
  status: string;
  timer_ms?: number | null;
}
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "PlayerView".
 */
export interface PlayerView {
  /**
   * Still in it. Players out of a game stay listed.
   */
  alive: boolean;
  id: number;
  name: string;
  team?: Team | null;
}
/**
 * One row of a game's scoreboard.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "ScoreView".
 */
export interface ScoreView {
  label: string;
  value: number;
}
/**
 * One run in the drawer's list (`PerfectmanOpen`).
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "RunBrief".
 */
export interface RunBrief {
  id: number;
  mode: RunMode;
  room: number;
  state: RunState;
  title: string;
}
/**
 * One Actor row in the run panel.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "PanelActor".
 */
export interface PanelActor {
  doing: string;
  id: number;
  last_line?: string | null;
  name: string;
  room: number;
}
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "Fade".
 */
export interface Fade {
  ms: number;
  /**
   * Target opacity, 0 to 1.
   */
  to: number;
}
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "PersonRef".
 */
export interface PersonRef {
  id: number;
  name: string;
}
/**
 * One reaction an actor owes (`act_beat.owed`), with its absolute deadline in epoch ms.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "Owed".
 */
export interface Owed {
  due_at: number;
  role: ReactionRole;
  who: number;
}
/**
 * A reaction still owed at the end of the window (`act_done.owed_missed`).
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "OwedMissed".
 */
export interface OwedMissed {
  role: ReactionRole;
  who: number;
}
/**
 * `GET /api/admin/perfectman/jobs/{id}`. In memory on the hotel: lost on restart, kept 10 min.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "Job".
 */
export interface Job {
  admin: number;
  error?: ApiError | null;
  id: string;
  op: JobOp;
  result?: unknown;
  /**
   * What a running job is doing now, for the AI jobs ("research", "build"). Absent for the rest.
   */
  stage?: string | null;
  state: JobState;
}
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "PresetList".
 */
export interface PresetList {
  presets: PresetInfo[];
}
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "PresetInfo".
 */
export interface PresetInfo {
  key: string;
  language: string;
  mode: RunMode;
  title: string;
}
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "PresetSource".
 */
export interface PresetSource {
  source: string;
}
/**
 * The room mirror's first message. `layout.rows`, `walk` and `seats` are server-derived so the sidecar re-implements no rules. The public `Avatar.ai` is never set here (D43).
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "RoomSnapshot".
 */
export interface RoomSnapshot {
  avatars: Avatar[];
  background?: string;
  defs: {
    [k: string]: SnapDef | undefined;
  };
  furni: Furni[];
  layout: SnapLayout;
  /**
   * Untrusted: the room owner wrote it.
   */
  name: string;
  owner: number;
  pet?: string;
  rev: number;
  room: number;
  seats: SnapSeat[];
  template: string;
  untrusted_text?: string[];
  /**
   * `.` blocked or void, `0` open, `s` seat, `g` gate or portal; one string per row.
   */
  walk: string[];
}
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "SidecarInfo".
 */
export interface SidecarInfo {
  build: string;
  /**
   * SHA-256 of the vendored `director.schema.json`. A mismatch is logged as a warning; only a `proto` mismatch refuses (checklist 2).
   */
  schema_sha256?: string | null;
  /**
   * The vendored `verb-vocab.json` of a dialect 2 sidecar (NEG-3, NEG-7).
   */
  verb_vocab?: VerbVocabRef | null;
  version: string;
}
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "ErrorInfo".
 */
export interface ErrorInfo {
  code: string;
  message: string;
}
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "FaceTarget".
 */
export interface FaceTarget {
  id: number;
}
/**
 * `POST /authoring/v1/validate`: `source` or `body`. A failing scenario is still `200`.
 *
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "ValidateRequest".
 */
export interface ValidateRequest {
  body?: unknown;
  source?: string | null;
}
/**
 * This interface was referenced by `PerfectmanDirectorContract`'s JSON-Schema
 * via the `definition` "ValidateResponse".
 */
export interface ValidateResponse {
  errors: PathMessage[];
  ok: boolean;
  warnings: PathMessage[];
}
