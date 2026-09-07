/**
 * The flow: see what this is, choose who is in the room, choose what is
 * happening, watch it.
 *
 * The intro shows once and is remembered, because the second time you open a
 * tool you want the tool. Everything the old shell put on screen at once is
 * still reachable — compiled config, diagnostics, the raw frame stream — but it
 * lives behind `details` on the run screen instead of competing with the scene.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CompileResponse, StartRunRequest, UploadedFile } from "@perfectman/shared";
import { ApiRequestError, compile, startRun, stopRun } from "./api/client.js";
import { API_BASE, IS_SPLIT_DEPLOY } from "./api/origin.js";
import { useRunStream } from "./api/useRunStream.js";
import { Shell, type StepId } from "./design/Shell.js";
import { Intro } from "./onboarding/Intro.js";
import { PickStep, type Selection } from "./pick/PickStep.js";
import { usePresets } from "./pick/usePresets.js";
import { sceneTitleIn } from "./pick/preview.js";
import { RunScreen } from "./run/RunScreen.js";

const INTRO_SEEN = "perfectman.intro.seen";
const COMPILE_DEBOUNCE_MS = 300;

const NOTHING: Selection = { presetId: null, files: [] };

export function App(): JSX.Element {
  const [introDone, setIntroDone] = useState(() => readFlag(INTRO_SEEN));
  const [step, setStep] = useState<StepId>("cast");
  const [furthest, setFurthest] = useState<StepId>("cast");

  const { library, loading: presetsLoading, error: presetsError } = usePresets();
  const [cast, setCast] = useState<Selection>(NOTHING);
  const [scene, setScene] = useState<Selection>(NOTHING);

  const [compilation, setCompilation] = useState<{
    key: string; result?: CompileResponse; error?: string;
  } | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [runPlan, setRunPlan] = useState<{ key: string; title: string; compiled: CompileResponse } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [castChange, setCastChange] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const pendingStart = useRef<{ cancelled: boolean } | null>(null);
  const stream = useRunStream(runId);

  const inputs = useMemo(() => toInputs(cast.files, scene.files), [cast.files, scene.files]);
  const inputKey = useMemo(() => JSON.stringify(inputs), [inputs]);
  const sceneTitle = library.scenes.find((preset) => preset.id === scene.presetId)?.title ?? sceneTitleIn(scene.files) ?? "Your scene";
  const currentCompilation = compilation?.key === inputKey ? compilation : null;
  const compiled = currentCompilation?.result ?? null;
  const compiling = Boolean(inputs && !currentCompilation);
  const activeRun = starting || (runId !== null && stream.stoppedReason === null &&
    stream.status?.state !== "done" && stream.status?.state !== "failed");
  const changedRunInputs = runPlan !== null && runPlan.key !== inputKey;

  useEffect(() => {
    if (!inputs) {
      setCompilation(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      compile(inputs)
        .then((result) => live && setCompilation({ key: inputKey, result }))
        .catch((err: unknown) => live && setCompilation({ key: inputKey, error: messageOf(err) }));
    }, COMPILE_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [inputKey, inputs]);

  // A scene names its people by id, so picking one pulls in the cast it was
  // written for rather than failing validation a step later.
  const pickScene = useCallback(
    (next: Selection) => {
      setScene(next);
      setCastChange(null);
      const required = library.scenes.find((s) => s.id === next.presetId)?.cast;
      if (!required || cast.presetId === required) return;
      const match = library.casts.find((c) => c.id === required);
      if (match) {
        setCast({ presetId: match.id, files: match.files });
        setCastChange(`This scene uses ${match.title}. Your cast has changed to match.`);
      }
    },
    [library, cast.presetId],
  );

  const advance = useCallback((to: StepId) => {
    setStep(to);
    setFurthest((far) => (order(to) > order(far) ? to : far));
  }, []);

  const run = useCallback(
    async (llm: StartRunRequest["llm"], limits?: StartRunRequest["limits"]) => {
      if (!inputs || !compiled?.ok || pendingStart.current) return;
      const request = { cancelled: false };
      pendingStart.current = request;
      setStarting(true);
      setCancelling(false);
      setFailure(null);
      setRunId(null);
      setRunPlan({ key: inputKey, title: sceneTitle, compiled });
      try {
        const res = await startRun({ inputs, llm, ...(limits ? { limits } : {}) });
        // Aborting fetch would not cancel an accepted server run. If the user
        // cancels before its id arrives, stop that run as soon as it does.
        setRunId(res.runId);
        if (request.cancelled) await stopRun(res.runId);
      } catch (err) {
        // A poll can lose a race to another start; preserve the server-busy explanation.
        setFailure(err instanceof ApiRequestError && err.status === 409
          ? "Someone else started a run just before you. Stop it above, or wait for it to finish."
          : messageOf(err));
      } finally {
        pendingStart.current = null;
        setStarting(false);
        setCancelling(false);
      }
    },
    [inputs, inputKey, sceneTitle, compiled],
  );

  const stop = useCallback(() => {
    if (pendingStart.current) {
      pendingStart.current.cancelled = true;
      setCancelling(true);
      return;
    }
    if (runId) void stopRun(runId).catch((err: unknown) => setFailure(messageOf(err)));
  }, [runId]);

  return (
    <>
      {!introDone ? (
      <Intro
        onDone={() => {
          writeFlag(INTRO_SEEN);
          setIntroDone(true);
        }}
      />
      ) : null}
      <div hidden={!introDone}>
    <Shell step={step} furthest={furthest} onStep={setStep} onHome={() => setIntroDone(false)}>
      {presetsLoading ? <p role="status">Loading casts and scenes…</p> : null}
      {presetsError ? (
        <div className="alert alert--shell" role="alert">
          <p>
            Could not reach the run server{IS_SPLIT_DEPLOY ? ` at ${API_BASE}` : ""}: {presetsError}. You can still
            write your own cast and scene below.
          </p>
        </div>
      ) : null}
      {step === "scene" && castChange ? <p className="selection-note" role="status">{castChange}</p> : null}
      {step === "scene" && currentCompilation?.error ? (
        <p className="alert" role="alert">Could not check this scene: {currentCompilation.error}. Edit it to retry.</p>
      ) : null}
      {step === "cast" ? (
        <PickStep
          kind="cast"
          title="Who’s in the room?"
          lede="A cast of AI agents, each with a different way of seeing things. Choose a group, or write your own."
          presets={library.casts}
          selection={cast}
          onSelect={(next) => { setCast(next); setCastChange(null); }}
          accept=".md,text/markdown"
          emptyHint="One markdown file per character: how they see themselves, how they talk, what they remember."
        >
          <button type="button" className="btn" disabled={cast.files.length === 0} onClick={() => advance("scene")}>
            Choose a scene
          </button>
          {cast.files.length === 0 ? <span className="u-dim">Pick a cast to continue.</span> : null}
        </PickStep>
      ) : null}

      {step === "scene" ? (
        <PickStep
          kind="scene"
          casts={library.casts}
          activeCast={cast}
          title="Give them something to talk about."
          lede="Choose a situation. Each agent decides what to say, and what to keep to themselves."
          presets={library.scenes}
          selection={scene}
          onSelect={pickScene}
          accept=".md,text/markdown"
          emptyHint="One markdown file: the room, the channels, and a hidden objective per character."
        >
          <button
            type="button"
            className="btn"
            disabled={!compiled?.ok || (activeRun && changedRunInputs)}
            onClick={() => {
              if (changedRunInputs && !activeRun) {
                setRunId(null);
                setRunPlan(null);
                setFailure(null);
              }
              advance("run");
            }}
          >
            Ready
          </button>
          {activeRun && changedRunInputs ? (
            <span className="u-dim">Your current run is still going. <button type="button" className="btn--bare" onClick={() => advance("run")}>Return to the run</button> to finish or stop it first.</span>
          ) : <StepStatus compiled={compiled} compiling={compiling} hasScene={scene.files.length > 0} />}
        </PickStep>
      ) : null}

      {furthest === "run" ? (
        <div hidden={step !== "run"}>
        <RunScreen
          visible={introDone && step === "run"}
          sceneTitle={(runId || starting) && runPlan ? runPlan.title : sceneTitle}
          compiled={(runId || starting) && runPlan ? runPlan.compiled : compiled}
          stream={stream}
          runId={runId}
          starting={starting}
          cancelling={cancelling}
          error={failure ?? stream.error}
          onRun={run}
          onStop={stop}
          onDismissError={() => setFailure(null)}
          onReset={() => { setRunId(null); setFailure(null); }}
        />
        </div>
      ) : null}
    </Shell>
      </div>
    </>
  );
}

function StepStatus({
  compiled,
  compiling,
  hasScene,
}: {
  compiled: CompileResponse | null;
  compiling: boolean;
  hasScene: boolean;
}): JSX.Element | null {
  if (!hasScene) return <span className="u-dim">Pick a scene to continue.</span>;
  if (compiling) return <span className="u-dim">Checking…</span>;
  if (!compiled) return null;
  if (compiled.ok) {
    const agents = compiled.summary?.agents.length ?? 0;
    const channels = compiled.summary?.channels.length ?? 0;
    return (
      <span className="u-dim">
        {agents} in the room, {channels} channel{channels === 1 ? "" : "s"}.
      </span>
    );
  }
  const first = compiled.diagnostics.find((d) => d.level === "error");
  return <span className="alert-inline">{first?.message ?? "These files do not fit together."}</span>;
}

function toInputs(personas: UploadedFile[], scene: UploadedFile[]) {
  const scenario = scene[0];
  if (!scenario || personas.length === 0) return null;
  return { kind: "markdown" as const, personas, scenario };
}

function order(step: StepId): number {
  return ["cast", "scene", "run"].indexOf(step);
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    // Private windows and blocked site data both throw. Showing the intro
    // again is the harmless failure.
    return false;
  }
}

function writeFlag(key: string): void {
  try {
    localStorage.setItem(key, "1");
  } catch {
    // Nothing to do; the intro will show again next time.
  }
}

function messageOf(err: unknown): string {
  if (err instanceof ApiRequestError) return err.hint ? `${err.message} — ${err.hint}` : err.message;
  return err instanceof Error ? err.message : String(err);
}
