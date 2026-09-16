import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CompileResponse, StartRunRequest, UploadedFile } from "@perfectman/shared";
import { ApiRequestError, compile, startRun, stopRun } from "./api/client.js";
import { useRunStream } from "./api/useRunStream.js";
import type { StepId } from "./design/Shell.js";
import type { Selection } from "./pick/PickStep.js";
import { usePresets } from "./pick/usePresets.js";
import { sceneTitleIn } from "./pick/preview.js";

const INTRO_SEEN = "perfectman.intro.seen";
const COMPILE_DEBOUNCE_MS = 300;
const NOTHING: Selection = { presetId: null, files: [] };

export function useWorkspaceFlow() {
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

  return {
    introDone, setIntroDone, step, setStep, furthest, library,
    presetsLoading, presetsError, cast, setCast, scene, compiled,
    compiling, currentCompilation, sceneTitle, activeRun, changedRunInputs, runPlan,
    runId, setRunId, setRunPlan, failure, setFailure, castChange,
    setCastChange, starting, cancelling, stream, pickScene, advance,
    run, stop, setScene,
    finishIntro: () => { writeFlag(INTRO_SEEN); setIntroDone(true); },
  };
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
