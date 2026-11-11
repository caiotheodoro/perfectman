/**
 * The narrow entry the eval harness uses to run the drama stack offline (`@perfectman/hotel/drama`, act-contract.md 11.2 P4).
 * It re-exports only the pieces of the real sidecar the fake grid hotel feeds frames to: the drama director (approve, veto,
 * start), the planner side (`DramaBody`: the act lock, owed reactions, memory of acts), the router that hands each hotel frame
 * to them, the scenario `drama` block and its compile, and the mock model's acts. The sidecar itself, the WebSocket and the
 * run manager are not here, so a bench that imports this never opens a socket.
 */
export { DramaBody } from "./embodiment/drama-body.js";
export type { ActorPool, AgentStateStore, DramaBodyDeps } from "./embodiment/drama-body.js";
export { DramaLog, dramaLogLine, DRAMA_LOG_CAP } from "./director/drama/decision-log.js";
export type { DramaLogEntry, DramaLogLine } from "./director/drama/decision-log.js";
export { plan, updateMemory } from "./embodiment/plan.js";
export type { PlanInput, PlannedCommand } from "./embodiment/types.js";
export { BeatPlayer, DramaDirector, SheetNotes, SheetPlayer, composeDramaSinks, mirrorWorld, DEFAULT_DRAMA_TUNING, FORCE_UNTIL_MS, LATE_RELEASE_MS } from "./director/drama/index.js";
export type { SheetPlayerDeps, SheetReport, SheetStageHooks, SheetSummary } from "./director/drama/index.js";
export { planBlock, planFace, planProp, placeToTile } from "./embodiment/sheet-stage.js";
export type { StageCtx } from "./embodiment/sheet-stage.js";
export { compileBeatSheet, settleSheetDrama, sheetScenarioBeats, climaxBeat, sheetInputHash } from "./authoring/beat-sheet.js";
export type { SheetCompile } from "./authoring/beat-sheet.js";
export { mockSheetFor, buildSheetPrompt, generateBeatSheet, sheetInputHashOf, sheetIsCurrent } from "./authoring/beat-sheet-generate.js";
export type { SheetBrief, SheetDeps, SheetLink, SheetResult } from "./authoring/beat-sheet-generate.js";
export { buildSheetLinks, sheetMode } from "./authoring/beat-sheet-links.js";
export { briefOfBody } from "./run/sheet-run.js";
export type { BeatPlayerDeps, BeatReport, DramaDecision, DramaDirectorDeps, DramaLink, DramaTuning, DramaWorld, WorldAvatar } from "./director/drama/index.js";
export { classifyHostility, readHostility } from "./director/drama/hostility.js";
export type { HostilityKind, LineReading } from "./director/drama/hostility.js";
export { SceneRecorder, SceneSpine, buildSceneSpine } from "./run/scene-recorder.js";
export { SpineEscalation, spineEscalateEnabled, SPINE_ESCALATE_ENV } from "./run/spine-escalation.js";
export { routeDramaFrame } from "./run/drama-frame-sink.js";
export type { DramaFrameSink } from "./run/drama-frame-sink.js";
export { isDramaFrame, DRAMA_HOTEL_TYPES } from "./director/drama-frames.js";
export type { DramaFrame } from "./director/drama-frames.js";
export { validateActCmd } from "./director/act-cmd.js";
export type { ActSend } from "./director/director-client.js";
export type { DramaSession } from "./director/dialect.js";
export type { ActorCmd, HotelFrame } from "./director/index.js";
export { VOCAB_CONSTANTS } from "./director/verb-vocab.generated.js";
export { verbTable } from "./director/verb-table.js";
export type { TableStep, VerbEntry, VerbTable } from "./director/verb-table.js";
export { compileDramaForm, compileSceneDrama, cleanDrama, cleanDramaExt, dramaForAuthoredActs, resolveRunDrama, summarizeRunDrama, defaultSceneDrama, isDramaOff, DEFAULT_SCENE_MAX_RUNG, DRAMA_OFF, FREE_PLAY_DRAMA } from "./authoring/scenario-drama.js";
export { HUMAN_TARGETS_ENV } from "./authoring/scenario-drama.js";
export type { AuthoredAct, DramaExt, DramaMode, DramaSummary, PressureFloor, RunDrama, SceneCastMember, ScenarioDrama, ScenarioFormDrama } from "./authoring/scenario-drama.js";
export { cleanBeats, compileSceneBeats, countCuts } from "./authoring/scenario-beats.js";
export type { BeatsCompile, ScenarioBeat, ScenarioFormBeat } from "./authoring/scenario-beats.js";
export { MockActMemory, mockAct, malformedAct } from "./llm/mock-act.js";
export type { MockActInput, MockDrama } from "./llm/mock-act.js";
export type { ActorSpace, OwnActor } from "./space/space-mirror.js";
export type { Clock, TimerHandle } from "./clock/clock.js";
export * from "./embodiment/human/index.js";
export { HotelGateway } from "./gateway/hotel-gateway.js";
export type { GatewayDeps, CastEntry } from "./gateway/hotel-gateway.js";
export { namedIn } from "./embodiment/plan.js";
export { ShotPlanner, DEFAULT_CINE, moodOfState, lineSalience } from "./director/cine/index.js";
export type { CineConfig, CineItem, CineMood, CineWorld, LineItem, NarrationSource, Program, Step } from "./director/cine/index.js";
