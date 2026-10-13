import type { CompileResponse } from "@perfectman/shared";
import { useCallback, useRef, useState } from "react";
import { API_BASE, IS_SPLIT_DEPLOY } from "./api/origin.js";
import { Shell } from "./design/Shell.js";
import { Intro, type StartChoice } from "./onboarding/Intro.js";
import { DEFAULT_PROVIDER, parseExtraBody, type ProviderValue } from "./run/ProviderForm.js";
import { RunScreen } from "./run/RunScreen.js";
import { SetupPage } from "./setup/SetupPage.js";
import { draftFromSentence, INITIAL_ROOM, type RoomDraft, type RoomFiles } from "./setup/room-draft.js";
import { useWorkspaceFlow } from "./useWorkspaceFlow.js";
import { WatchScreen } from "./watch/WatchScreen.js";

export function App(): JSX.Element {
  const [watching, setWatching] = useState(false);
  const [provider, setProvider] = useState<ProviderValue>(DEFAULT_PROVIDER);
  const [draft, setDraft] = useState<RoomDraft>(INITIAL_ROOM);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [setupFailure, setSetupFailure] = useState<{ message: string; hint?: string } | null>(null);
  const unlockSound = useRef<() => void>(() => undefined);
  const {
    introDone, setIntroDone, step, setStep, furthest, library,
    presetsLoading, presetsError, cast, setCast, scene, compiled,
    compiling, sceneTitle, runPlan, activeRun,
    runId, setRunId, setRunPlan, failure, setFailure,
    setCastChange, starting, cancelling, stream, pickScene, advance,
    run, stop, setScene, writing, setWriting, finishIntro,
  } = useWorkspaceFlow();

  const begin = useCallback((choice: StartChoice) => {
    const preset = library.scenes.find((s) => s.id === choice.presetId);
    if (preset) {
      setWriting(false);
      pickScene({ presetId: preset.id, files: preset.files });
    } else if (choice.story) {
      setDraft(draftFromSentence(choice.story));
      setWriting(true);
    }
    setStep("setup");
    finishIntro();
  }, [library.scenes, pickScene, setStep, setWriting, finishIntro]);

  const written = useCallback((result: { files: RoomFiles } | { error: string }) => {
    if ("error" in result) { setWriteError(result.error); return; }
    setWriteError(null);
    setCast({ presetId: null, files: result.files.personas });
    setScene({ presetId: null, files: [result.files.scenario] });
    setCastChange(null);
  }, [setCast, setScene, setCastChange]);

  const start = useCallback(() => {
    // Inside the click, before anything async: this is the gesture the browser will let the soundtrack play under.
    unlockSound.current();
    const extra = parseExtraBody(provider.extraBodyText);
    setSetupFailure(null);
    setFailure(null);
    void run({ ...provider.llm, ...(extra.value ? { extraBody: extra.value } : {}) }, provider.maxPulses ? { maxPulses: provider.maxPulses } : undefined);
    advance("run");
  }, [provider, run, advance, setFailure]);

  const backToSetup = useCallback((why?: { message: string; hint?: string }) => {
    // The key goes with the run. A model, key or output format that does not work is nearly always the key.
    setProvider((p) => (p.llm.apiKey ? { ...p, llm: { ...p.llm, apiKey: "" } } : p));
    setRunId(null);
    setRunPlan(null);
    setFailure(null);
    if (why) setSetupFailure(why);
    setStep("setup");
  }, [setRunId, setRunPlan, setFailure, setStep]);

  const sceneCompiled: CompileResponse | null = writeError ? { ok: false, config: null, diagnostics: [{ level: "error", message: writeError }], summary: null } as unknown as CompileResponse : compiled;

  return (
    <>
      {!introDone ? (
        <Intro starters={library.scenes} onStart={begin} onWatch={() => setWatching(true)} />
      ) : null}
      <div hidden={!introDone}>
    <Shell step={step} furthest={furthest} onStep={setStep} onHome={() => setIntroDone(false)} onWatch={() => setWatching(true)}>
      {presetsLoading ? <p role="status">Loading stories…</p> : null}
      {presetsError ? (
        <div className="alert alert--shell" role="alert">
          <p>
            Could not reach the run server{IS_SPLIT_DEPLOY ? ` at ${API_BASE}` : ""}: {presetsError}. You can still
            write your own story below.
          </p>
        </div>
      ) : null}

      <div hidden={step !== "setup"}>
        <SetupPage
          visible={introDone && step === "setup"}
          library={library} cast={cast} scene={scene}
          compiled={sceneCompiled} compiling={compiling}
          draft={draft} writing={writing} failure={setupFailure} provider={provider} starting={starting} runActive={activeRun} onReturnToRun={() => setStep("run")}
          onPickPreset={(preset) => { setWriting(false); setWriteError(null); pickScene({ presetId: preset.id, files: preset.files }); }}
          onWrite={() => setWriting(true)}
          onStopWriting={() => { setWriting(false); setWriteError(null); }}
          onWritten={written}
          onFiles={(castFiles, sceneFiles) => { setWriting(false); setCast({ presetId: null, files: castFiles }); setScene({ presetId: null, files: sceneFiles }); setCastChange(null); }}
          onProvider={setProvider}
          onStart={start}
        />
      </div>

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
          onStop={stop}
          onDismissError={() => setFailure(null)}
          onReset={() => backToSetup()}
          onGiveUp={backToSetup}
          unlockRef={unlockSound}
        />
      </div>
    </Shell>
      </div>
      {watching ? <WatchScreen onClose={() => setWatching(false)} /> : null}
    </>
  );
}
