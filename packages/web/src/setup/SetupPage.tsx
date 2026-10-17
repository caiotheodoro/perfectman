/**
 * One page from "I want to try this" to a running room.
 *
 * A story is already chosen when the page opens, so the shortest path is to
 * paste a key and press Start. Everything else (swap the story, write your own,
 * change the people, change the model) is one click away and changes the same
 * page rather than moving to another.
 */
import { useMemo, useRef, useState } from "react";
import { chipIndexFor, type CompileResponse, type UploadedFile } from "@perfectman/shared";
import { Figure } from "../stage/Figure.js";
import { MarkdownEditor } from "../pick/MarkdownEditor.js";
import { charactersIn, secretIn } from "../pick/preview.js";
import type { PresetLibrary, Preset } from "../pick/usePresets.js";
import type { Selection } from "../pick/selection.js";
import { isProviderReady, ProviderForm, type ProviderValue } from "../run/ProviderForm.js";
import { useServerBusy } from "../run/useServerBusy.js";
import { ServerBusyNotice } from "./ServerBusyNotice.js";
import { StoryCard } from "./StoryCard.js";
import { StoryWriter } from "./StoryWriter.js";
import type { RoomDraft, RoomFiles } from "./room-draft.js";

/** Stories shown before "Show all": enough to choose from without a wall of cards. */
const FIRST_STORIES = 4;

export function SetupPage({
  visible, library, cast, scene, compiled, compiling, draft, writing, failure, provider, starting, runActive,
  onReturnToRun, onWatchLive, onPickPreset, onWrite, onStopWriting, onWritten, onFiles, onProvider, onStart,
}: {
  visible: boolean;
  library: PresetLibrary;
  cast: Selection;
  scene: Selection;
  compiled: CompileResponse | null;
  compiling: boolean;
  /** The story the writer starts from. */
  draft: RoomDraft;
  /** Writing your own, rather than picking a ready-made story. */
  writing: boolean;
  /** Why the last run stopped; the key is the usual cause. */
  failure: { message: string; hint?: string } | null;
  provider: ProviderValue;
  starting: boolean;
  /** A run is still going; a new one has to wait for it. */
  runActive: boolean;
  onReturnToRun: () => void;
  /** Attach to the run the server is already doing. */
  onWatchLive: (runId: string) => void;
  onPickPreset: (preset: Preset) => void;
  onWrite: () => void;
  onStopWriting: () => void;
  onWritten: (result: { files: RoomFiles } | { error: string }) => void;
  onFiles: (cast: UploadedFile[], scene: UploadedFile[]) => void;
  onProvider: (next: ProviderValue) => void;
  onStart: () => void;
}): JSX.Element {
  const server = useServerBusy(visible && !starting && !runActive);
  const [showAll, setShowAll] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const people = useMemo(() => charactersIn(cast.files), [cast.files]);
  const ids = people.map((p) => p.id);
  const secrets = useMemo(() => new Map(cast.files.map((f) => [charactersIn([f])[0]?.id, secretIn(f)])), [cast.files]);
  const sceneNames = useMemo(() => new Set(scene.files.map((f) => f.filename)), [scene.files]);
  const story = library.scenes.find((s) => s.id === scene.presetId);
  const ok = Boolean(compiled?.ok);
  const ready = ok && isProviderReady(provider) && !server.busy && !starting && !runActive;

  async function absorb(list: FileList | null): Promise<void> {
    if (!list || list.length === 0) return;
    setUploadError(null);
    try {
      const files = await Promise.all(Array.from(list).map(async (file) => ({ filename: file.name, text: await file.text() })));
      onFiles(files.filter((f) => !/\.scenario\.md$/i.test(f.filename)), files.filter((f) => /\.scenario\.md$/i.test(f.filename)));
    } catch {
      setUploadError("Could not read those files. Try uploading them again.");
    }
  }

  const status = scene.files.length === 0 ? "Pick a story to begin."
    : compiling ? "Checking the story…"
    : !compiled ? ""
    : compiled.ok ? `${compiled.summary?.agents.length ?? people.length} people, ${compiled.summary?.channels.length ?? 1} channel${(compiled.summary?.channels.length ?? 1) === 1 ? "" : "s"}.`
    : compiled.diagnostics.find((d) => d.level === "error")?.message ?? "These files do not fit together.";

  return (
    <section className="setup">
      <header className="setup__head">
        <h2>Set up a room</h2>
        <p>Pick a story, meet the people in it, connect a model. Then watch.</p>
      </header>

      <section className="setup__block" aria-labelledby="setup-story">
        <h3 id="setup-story">The story</h3>
        {writing ? (
          <button type="button" className="btn--bare setup__back" onClick={onStopWriting}>← Pick a ready-made story instead</button>
        ) : (
          <div className="stories">
            {library.scenes.filter((s, i) => showAll || i < FIRST_STORIES || s.id === scene.presetId).map((preset) => (
              <StoryCard
                key={preset.id} preset={preset} cast={library.casts.find((c) => c.id === preset.cast)}
                chosen={scene.presetId === preset.id} onPick={() => onPickPreset(preset)}
              />
            ))}
            <button type="button" className="story story--write" onClick={onWrite}>
              <span className="story__copy">
                <span className="story__title">Write your own</span>
                <span className="story__blurb">A situation, a few people, and what each of them is hiding.</span>
              </span>
            </button>
            {!showAll && library.scenes.length > FIRST_STORIES ? (
              <button type="button" className="btn--bare setup__more" onClick={() => setShowAll(true)}>Show all {library.scenes.length} stories</button>
            ) : null}
          </div>
        )}
        {writing ? <StoryWriter initial={draft} provider={provider} onChange={onWritten} /> : null}
      </section>

      <section className="setup__block" aria-labelledby="setup-people">
        <h3 id="setup-people">The people</h3>
        {people.length === 0 ? <p className="u-dim">They show up here once you pick a story.</p> : (
          <ul className="people">
            {people.map((p) => (
              <li key={p.id}>
                <Figure index={chipIndexFor(p.id, ids)} name={p.name} face="neutral" energy={0.3} speaking={false} attentive />
                <span className="people__text">
                  <strong>{p.name}</strong>
                  {p.archetype ? <span className="u-dim">{p.archetype}</span> : null}
                  {secrets.get(p.id) ? <em>Hiding: {secrets.get(p.id)}</em> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
        {story ? <p className="u-dim setup__note">{story.title} comes with this cast.</p> : null}
        <details className="setup__files">
          <summary>Edit the files yourself</summary>
          <MarkdownEditor
            files={[...cast.files, ...scene.files]}
            onChange={(all) => { const isScene = (f: UploadedFile): boolean => /\.scenario\.md$/i.test(f.filename) || sceneNames.has(f.filename); onFiles(all.filter((f) => !isScene(f)), all.filter(isScene)); }}
            onClose={() => undefined}
          />
          <button type="button" className="btn--bare" onClick={() => picker.current?.click()}>Upload files</button>
          <input ref={picker} type="file" accept=".md,text/markdown" multiple hidden onChange={(e) => void absorb(e.target.files)} />
          {uploadError ? <p className="alert-inline" role="alert">{uploadError}</p> : null}
        </details>
      </section>

      <section className="setup__block" aria-labelledby="setup-brain">
        <h3 id="setup-brain">The model</h3>
        {runActive ? (
          <p className="u-dim">Your current run is still going. <button type="button" className="btn--bare" onClick={onReturnToRun}>Return to the run</button> to finish or stop it first.</p>
        ) : null}
        {failure ? (
          <div className="alert" role="alert">
            <p>The last run stopped: {failure.message}{failure.hint ? ` ${failure.hint}` : ""} Paste the key again and start over.</p>
          </div>
        ) : null}
        {server.busy ? <ServerBusyNotice server={server} onWatch={onWatchLive} /> : null}
        <ProviderForm value={provider} onChange={onProvider} focusKey={failure !== null} />
      </section>

      <footer className="setup__bar">
        <p className={`setup__status${compiled && !compiled.ok ? " is-bad" : ""}`} role="status">
          <strong>{writing ? "Your story" : story?.title ?? ""}</strong> {status}
        </p>
        <button type="button" className="btn setup__go" disabled={!ready} onClick={onStart}>Start the room</button>
        {!ready && ok && !server.busy && !isProviderReady(provider) ? <span className="u-dim setup__why">Paste a key to start.</span> : null}
        {server.busy ? <span className="u-dim setup__why">Waiting for the current run to finish.</span> : null}
      </footer>
    </section>
  );
}
