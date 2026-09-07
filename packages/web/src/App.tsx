/**
 * The flow: see what this is, choose who is in the room, choose what is
 * happening, watch it.
 *
 * The intro shows once and is remembered, because the second time you open a
 * tool you want the tool. Everything the old shell put on screen at once is
 * still reachable — compiled config, diagnostics, the raw frame stream — but it
 * lives behind `details` on the run screen instead of competing with the scene.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CompileResponse, StartRunRequest, UploadedFile } from "@perfectman/shared";
import { ApiRequestError, compile, startRun, stopRun } from "./api/client.js";
import { useRunStream } from "./api/useRunStream.js";
import { Shell, type StepId } from "./design/Shell.js";
import { Intro } from "./onboarding/Intro.js";
import { PickStep, type Selection } from "./pick/PickStep.js";
import { usePresets } from "./pick/usePresets.js";
import { RunScreen } from "./run/RunScreen.js";

const INTRO_SEEN = "perfectman.intro.seen";
const COMPILE_DEBOUNCE_MS = 300;

const NOTHING: Selection = { presetId: null, files: [] };

export function App(): JSX.Element {
  const [introDone, setIntroDone] = useState(() => readFlag(INTRO_SEEN));
  const [step, setStep] = useState<StepId>("cast");
  const [furthest, setFurthest] = useState<StepId>("cast");

  const { library } = usePresets();
  const [cast, setCast] = useState<Selection>(NOTHING);
  const [scene, setScene] = useState<Selection>(NOTHING);

  const [compiled, setCompiled] = useState<CompileResponse | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const stream = useRunStream(runId);

  const inputs = useMemo(() => toInputs(cast.files, scene.files), [cast.files, scene.files]);
  const inputKey = useMemo(() => JSON.stringify(inputs), [inputs]);

  useEffect(() => {
    if (!inputs) {
      setCompiled(null);
      return;
    }
    let live = true;
    setCompiling(true);
    const timer = setTimeout(() => {
      compile(inputs)
        .then((result) => live && setCompiled(result))
        .catch((err: unknown) => live && setFailure(messageOf(err)))
        .finally(() => live && setCompiling(false));
    }, COMPILE_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // Keyed by file contents; the compile call reads `inputs` fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputKey]);

  // A scene names its people by id, so picking one pulls in the cast it was
  // written for rather than failing validation a step later.
  const pickScene = useCallback(
    (next: Selection) => {
      setScene(next);
      const required = library.scenes.find((s) => s.id === next.presetId)?.cast;
      if (!required || cast.presetId === required) return;
      const match = library.casts.find((c) => c.id === required);
      if (match) setCast({ presetId: match.id, files: match.files });
    },
    [library, cast.presetId],
  );

  const advance = useCallback((to: StepId) => {
    setStep(to);
    setFurthest((far) => (order(to) > order(far) ? to : far));
  }, []);

  const run = useCallback(
    (llm: StartRunRequest["llm"], limits?: StartRunRequest["limits"]) => {
      if (!inputs) return;
      setFailure(null);
      setRunId(null);
      startRun({ inputs, llm, ...(limits ? { limits } : {}) })
        .then((res) => setRunId(res.runId))
        .catch((err: unknown) => setFailure(messageOf(err)));
    },
    [inputs],
  );

  const stop = useCallback(() => {
    if (runId) void stopRun(runId).catch((err: unknown) => setFailure(messageOf(err)));
  }, [runId]);

  if (!introDone) {
    return (
      <Intro
        onDone={() => {
          writeFlag(INTRO_SEEN);
          setIntroDone(true);
        }}
      />
    );
  }

  return (
    <Shell step={step} furthest={furthest} onStep={setStep}>
      {step === "cast" ? (
        <PickStep
          title="Who is in the room?"
          lede="Each character decides for themselves whether to speak. Pick a group, or write your own."
          presets={library.casts}
          selection={cast}
          onSelect={setCast}
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
          title="What is happening?"
          lede="The situation, who can see which channel, and what each of them wants but will not say."
          presets={library.scenes}
          selection={scene}
          onSelect={pickScene}
          accept=".md,text/markdown"
          emptyHint="One markdown file: the room, the channels, and a hidden objective per character."
        >
          <button
            type="button"
            className="btn"
            disabled={!compiled?.ok}
            onClick={() => advance("run")}
          >
            Ready
          </button>
          <StepStatus compiled={compiled} compiling={compiling} hasScene={scene.files.length > 0} />
        </PickStep>
      ) : null}

      {step === "run" ? (
        <RunScreen
          compiled={compiled}
          stream={stream}
          runId={runId}
          error={failure ?? stream.error}
          onRun={run}
          onStop={stop}
          onDismissError={() => setFailure(null)}
        />
      ) : null}
    </Shell>
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
