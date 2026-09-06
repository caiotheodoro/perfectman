/**
 * The shell: compile on change, run, watch frames arrive.
 *
 * Compiling is side-effect free on the server, so the preview can run on every
 * edit; starting a run recompiles anyway, which is why the panel can be trusted
 * as a preview of exactly what will run.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CompileResponse, StartRunRequest } from "@perfectman/shared";
import { ApiRequestError, compile, startRun, stopRun } from "./api/client.js";
import { useRunStream } from "./api/useRunStream.js";
import { CompiledConfigPanel } from "./components/CompiledConfigPanel.js";
import { FrameLog } from "./components/FrameLog.js";
import { RunForm, toRunInputs, type RunFormValue } from "./components/RunForm.js";
import { StatusBar } from "./components/StatusBar.js";

/** Long enough that typing a model name does not fire a request per keystroke. */
const COMPILE_DEBOUNCE_MS = 300;

const INITIAL: RunFormValue = {
  personas: [],
  scenario: null,
  llm: { providerType: "mock", modelName: "mock" },
  maxPulses: null,
};

export function App(): JSX.Element {
  const [form, setForm] = useState<RunFormValue>(INITIAL);
  const [compiled, setCompiled] = useState<CompileResponse | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const stream = useRunStream(runId);

  const inputs = useMemo(() => toRunInputs(form), [form]);
  // The compile request is keyed by content, so re-picking the same files or
  // toggling an unrelated field does not re-fire it.
  const inputKey = useMemo(() => JSON.stringify([inputs, form.llm.providerType]), [inputs, form.llm.providerType]);
  const latest = useRef(0);

  useEffect(() => {
    if (!inputs) {
      setCompiled(null);
      return;
    }
    const ticket = ++latest.current;
    setCompiling(true);
    const timer = setTimeout(() => {
      compile(inputs, form.llm)
        .then((result) => {
          if (ticket === latest.current) setCompiled(result);
        })
        .catch((err: unknown) => {
          if (ticket === latest.current) setFailure(messageOf(err));
        })
        .finally(() => {
          if (ticket === latest.current) setCompiling(false);
        });
    }, COMPILE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `inputKey` stands in for the file contents; `form.llm` is read fresh inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputKey]);

  const busy = stream.status ? ACTIVE.has(stream.status.state) : false;

  const run = useCallback(() => {
    if (!inputs) return;
    setFailure(null);
    const request: StartRunRequest = {
      inputs,
      llm: form.llm,
      ...(form.maxPulses ? { limits: { maxPulses: form.maxPulses } } : {}),
    };
    startRun(request)
      .then((res) => setRunId(res.runId))
      .catch((err: unknown) => setFailure(messageOf(err)));
  }, [inputs, form.llm, form.maxPulses]);

  const stop = useCallback(() => {
    if (runId) void stopRun(runId).catch((err: unknown) => setFailure(messageOf(err)));
  }, [runId]);

  const error = failure ?? stream.error;

  return (
    <div className="app">
      <header className="app__head">
        <h1>perfectman</h1>
        <p className="dim">markdown in, a simulation you can watch happen</p>
      </header>

      <StatusBar
        status={stream.status}
        connected={stream.connected}
        dropped={stream.dropped}
        runId={runId}
      />

      {error ? (
        <div className="alert" role="alert">
          {error}
          <button type="button" className="link" onClick={() => setFailure(null)}>
            dismiss
          </button>
        </div>
      ) : null}

      <div className="columns">
        <div className="column">
          <RunForm
            value={form}
            onChange={setForm}
            onRun={run}
            onStop={stop}
            busy={busy}
            canRun={Boolean(compiled?.ok) && !busy}
          />
          <CompiledConfigPanel result={compiled} pending={compiling} />
        </div>
        <div className="column">
          <FrameLog raw={stream.raw} />
        </div>
      </div>
    </div>
  );
}

const ACTIVE = new Set(["compiling", "validating", "health_check", "building", "running", "stopping"]);

function messageOf(err: unknown): string {
  if (err instanceof ApiRequestError) return err.hint ? `${err.message} — ${err.hint}` : err.message;
  return err instanceof Error ? err.message : String(err);
}
