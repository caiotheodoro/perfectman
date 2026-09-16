import type { CompileResponse } from "@perfectman/shared";
import { API_BASE, IS_SPLIT_DEPLOY } from "./api/origin.js";
import { Shell } from "./design/Shell.js";
import { Intro } from "./onboarding/Intro.js";
import { PickStep } from "./pick/PickStep.js";
import { RunScreen } from "./run/RunScreen.js";
import { useWorkspaceFlow } from "./useWorkspaceFlow.js";

export function App(): JSX.Element {
  const {
    introDone, setIntroDone, step, setStep, furthest, library,
    presetsLoading, presetsError, cast, setCast, scene, compiled,
    compiling, currentCompilation, sceneTitle, activeRun, changedRunInputs, runPlan,
    runId, setRunId, setRunPlan, failure, setFailure, castChange,
    setCastChange, starting, cancelling, stream, pickScene, advance,
    run, stop, setScene, finishIntro,
  } = useWorkspaceFlow();
  return (
    <>
      {!introDone ? (
      <Intro
        onDone={finishIntro}
        onCreate={({ personas, scenario }) => {
          setCast({ presetId: null, files: personas });
          setScene({ presetId: null, files: [scenario] });
          setCastChange(null);
          advance("scene");
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
