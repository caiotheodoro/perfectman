/**
 * Pick a cast, or pick a scene. The same shape both times: a row of cards, the
 * selection shown in full underneath, and a way out into writing your own.
 *
 * Editing is not a separate mode you commit to. Opening the editor pre-fills it
 * with whatever is selected, so "write your own" usually means "change one line
 * of theirs", which is how people actually start.
 */
import { useRef, useState } from "react";
import type { UploadedFile } from "@perfectman/shared";
import { chipFor, chipIndexFor } from "@perfectman/shared";
import type { Preset } from "./usePresets.js";
import { MarkdownEditor } from "./MarkdownEditor.js";
import { charactersIn } from "./preview.js";
import { Figure } from "../stage/Figure.js";

export type Selection = {
  /** Null once the files have been edited away from any preset. */
  presetId: string | null;
  files: UploadedFile[];
};

export function PickStep({
  title,
  lede,
  presets,
  selection,
  onSelect,
  accept,
  emptyHint,
  children,
}: {
  title: string;
  lede: string;
  presets: Preset[];
  selection: Selection;
  onSelect: (next: Selection) => void;
  /** File-extension hint for the upload control. */
  accept: string;
  emptyHint: string;
  /** The step's footer — continue button and anything beside it. */
  children: React.ReactNode;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  async function absorb(list: FileList | null): Promise<void> {
    if (!list || list.length === 0) return;
    const files = await Promise.all(
      Array.from(list).map(async (f) => ({ filename: f.name, text: await f.text() })),
    );
    onSelect({ presetId: null, files });
    setEditing(false);
  }

  return (
    <section className="step">
      <header className="step__head">
        <h2>{title}</h2>
        <p>{lede}</p>
      </header>

      <div className="cards">
        {presets.map((preset) => {
          const cast = charactersIn(preset.files);
          return (
            <button
              key={preset.id}
              type="button"
              className={`card${selection.presetId === preset.id ? " card--on" : ""}`}
              aria-pressed={selection.presetId === preset.id}
              onClick={() => {
                onSelect({ presetId: preset.id, files: preset.files });
                setEditing(false);
              }}
            >
              {cast.length > 0 ? (
                <span className="card__cast" aria-hidden="true">
                  {cast.map((character) => (
                    <Figure
                      key={character.id}
                      index={chipIndexFor(character.id, cast.map((c) => c.id))}
                      name={character.name}
                      face="neutral"
                      energy={0.3}
                      speaking={false}
                      attentive
                    />
                  ))}
                </span>
              ) : (
                <span className="card__chip" style={{ background: chipFor(0) }} aria-hidden="true" />
              )}
              <span className="card__title u-serif">{preset.title}</span>
              <span className="card__blurb">{preset.blurb}</span>
              <span className="card__count">
                {cast.length > 0
                  ? cast.map((c) => c.archetype).filter(Boolean).join(" · ")
                  : `${preset.files.length} file${preset.files.length === 1 ? "" : "s"}`}
              </span>
            </button>
          );
        })}

        <div className="card card--ghost">
          <span className="card__title u-serif">Write your own</span>
          <span className="card__blurb">
            {selection.files.length > 0
              ? "Opens with what's selected, so you can change one line rather than start over."
              : emptyHint}
          </span>
          <div className="card__ghost-actions">
            <button type="button" className="btn--bare" onClick={() => setEditing(true)}>
              Open editor
            </button>
            <button type="button" className="btn--bare" onClick={() => picker.current?.click()}>
              Upload files
            </button>
            <input
              ref={picker}
              type="file"
              accept={accept}
              multiple
              hidden
              onChange={(e) => void absorb(e.target.files)}
            />
          </div>
        </div>
      </div>

      {editing ? (
        <MarkdownEditor
          files={selection.files}
          onChange={(files) => onSelect({ presetId: null, files })}
          onClose={() => setEditing(false)}
        />
      ) : (
        <FileSummary files={selection.files} onEdit={() => setEditing(true)} />
      )}

      <footer className="step__foot">{children}</footer>
    </section>
  );
}

function FileSummary({ files, onEdit }: { files: UploadedFile[]; onEdit: () => void }): JSX.Element | null {
  if (files.length === 0) return null;
  return (
    <div className="summary-strip">
      <ul>
        {files.map((file) => (
          <li key={file.filename}>
            <span className="summary-strip__name">{file.filename}</span>
            <span className="u-dim">{firstProse(file.text)}</span>
          </li>
        ))}
      </ul>
      <button type="button" className="btn--bare" onClick={onEdit}>
        Edit as markdown
      </button>
    </div>
  );
}

/** First real sentence past the frontmatter — enough to recognise the file by. */
function firstProse(text: string): string {
  const body = text.split(/^---\s*$/m).slice(2).join("---");
  const line = body
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("```"));
  return line ? (line.length > 96 ? `${line.slice(0, 96)}…` : line) : "";
}
