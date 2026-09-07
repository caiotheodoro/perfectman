/** Presets and editable markdown share one selection, throughout the flow. */
import { useRef, useState } from "react";
import { chipIndexFor, type UploadedFile } from "@perfectman/shared";
import type { Preset } from "./usePresets.js";
import { MarkdownEditor } from "./MarkdownEditor.js";
import { charactersIn, type PreviewCharacter } from "./preview.js";
import { Figure } from "../stage/Figure.js";

export type Selection = {
  /** Null once the files have been edited away from any preset. */
  presetId: string | null;
  files: UploadedFile[];
};

export function PickStep({
  title, lede, kind = "cast", presets, casts = [], activeCast, selection, onSelect,
  accept, emptyHint, children,
}: {
  title: string;
  lede: string;
  kind?: "cast" | "scene";
  presets: Preset[];
  casts?: Preset[];
  activeCast?: Selection;
  selection: Selection;
  onSelect: (next: Selection) => void;
  accept: string;
  emptyHint: string;
  children: React.ReactNode;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const currentCast = casts.find((cast) => cast.id === activeCast?.presetId);
  const selected = presets.find((preset) => preset.id === selection.presetId);

  async function absorb(list: FileList | null): Promise<void> {
    if (!list || list.length === 0) return;
    setUploadError(null);
    try {
      const files = await Promise.all(
        Array.from(list).map(async (file) => ({ filename: file.name, text: await file.text() })),
      );
      onSelect({ presetId: null, files });
      setEditing(false);
    } catch {
      setUploadError("Could not read those files. Try uploading them again.");
    }
  }

  return (
    <section className={`step pick-step pick-step--${kind}`}>
      <header className="step__head">
        <h2>{title}</h2>
        <p>{lede}</p>
      </header>

      {kind === "scene" && activeCast ? (
        <div className="pick-cast-context">
          <CastRow files={activeCast.files} />
          <p><strong>{currentCast?.title ?? "Your cast"}</strong><span className="u-dim"> · current cast</span></p>
        </div>
      ) : null}

      <div className={`cards cards--${kind}`}>
        {presets.map((preset) => {
          const required = casts.find((cast) => cast.id === preset.cast);
          const cast = charactersIn(kind === "scene" ? required?.files ?? [] : preset.files);
          const chosen = selection.presetId === preset.id;
          const changesCast = kind === "scene" && required && activeCast?.presetId !== required.id;
          return (
            <button
              key={preset.id}
              type="button"
              className={`card card--${kind}${chosen ? " card--on" : ""}`}
              aria-pressed={chosen}
              onClick={() => {
                onSelect({ presetId: preset.id, files: preset.files });
                setEditing(false);
              }}
            >
              <span className="card__choice" aria-hidden="true">{chosen ? "✓" : ""}</span>
              {kind === "cast" ? <CastPortraits cast={cast} /> : null}
              <span className="card__copy">
                <span className="card__title">{preset.title}</span>
                <span className="card__blurb">{preset.blurb}</span>
                {kind === "cast" ? (
                  <span className="card__count">{cast.length} AI agent{cast.length === 1 ? "" : "s"}</span>
                ) : required ? (
                  <span className={`card__context${changesCast ? " card__context--changes" : ""}`}>
                    {changesCast ? `Changes cast to ${required.title}` : `With ${required.title}`}
                    <span>{cast.map((agent) => agent.name).join(" · ")}</span>
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      <div className="pick-authoring">
        <div>
          <h3>Write your own</h3>
          <p>{selection.files.length > 0 ? "Start with the selected files and make them yours." : emptyHint}</p>
        </div>
        <div className="pick-authoring__actions">
          <button type="button" className="btn--bare" onClick={() => setEditing(true)}>Open editor</button>
          <button type="button" className="btn--bare" onClick={() => picker.current?.click()}>Upload files</button>
          <input
            ref={picker} type="file" accept={accept} multiple hidden
            onChange={(event) => void absorb(event.target.files)}
          />
        </div>
      </div>
      {uploadError ? <p className="alert-inline" role="alert">{uploadError}</p> : null}

      {kind === "cast" && selection.files.length > 0 ? (
        <div className="pick-selection">
          <h3>{selected?.title ?? "Your cast"}</h3>
          <CastRow files={selection.files} />
        </div>
      ) : null}

      {editing ? (
        <MarkdownEditor
          files={selection.files}
          onChange={(files) => onSelect({ presetId: null, files })}
          onClose={() => setEditing(false)}
        />
      ) : <FileSummary files={selection.files} onEdit={() => setEditing(true)} />}

      <footer className="step__foot">{children}</footer>
    </section>
  );
}

function CastPortraits({ cast, className = "" }: { cast: PreviewCharacter[]; className?: string }): JSX.Element {
  const ids = cast.map((agent) => agent.id);
  return (
    <div className={`card__cast ${className}`}>
      {cast.map((agent) => (
        <Figure
          key={agent.id} index={chipIndexFor(agent.id, ids)} name={agent.name}
          face="neutral" energy={0.3} speaking={false} attentive
        />
      ))}
    </div>
  );
}

/** Read from the current files, so editing or uploading immediately changes the cast. */
function CastRow({ files }: { files: UploadedFile[] }): JSX.Element | null {
  const cast = charactersIn(files);
  return cast.length > 0 ? <CastPortraits cast={cast} className="cast-row" /> : null;
}

function FileSummary({ files, onEdit }: { files: UploadedFile[]; onEdit: () => void }): JSX.Element | null {
  if (files.length === 0) return null;
  return (
    <div className="summary-strip">
      <ul>
        {files.map((file) => {
          const agent = charactersIn([file])[0];
          return (
            <li key={file.filename}>
              <span className="summary-strip__name">
                {agent ? <strong>{agent.name}{agent.archetype ? ` · ${agent.archetype}` : ""}</strong> : null}
                <span>{file.filename}</span>
              </span>
              <span className="u-dim">{firstProse(file.text)}</span>
            </li>
          );
        })}
      </ul>
      <button type="button" className="btn--bare" onClick={onEdit}>Edit as markdown</button>
    </div>
  );
}

/** First real sentence past the frontmatter, enough to recognise the file by. */
function firstProse(text: string): string {
  const body = text.split(/^---\s*$/m).slice(2).join("---");
  const line = body.split("\n").map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("```"));
  return line ? (line.length > 160 ? `${line.slice(0, 160)}…` : line) : "";
}
