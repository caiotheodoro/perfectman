/**
 * Editing the markdown directly.
 *
 * Deliberately plain: a file list and a textarea. This is authoring input the
 * compiler will report on in a moment, so the editor's job is to stay out of
 * the way and not to invent a second opinion about what is valid.
 *
 * A new file is created blank rather than from a template, because the
 * preset sitting next to it already is the template.
 */
import { useState } from "react";
import type { UploadedFile } from "@perfectman/shared";

export function MarkdownEditor({
  files,
  onChange,
  onClose,
}: {
  files: UploadedFile[];
  onChange: (files: UploadedFile[]) => void;
  onClose: () => void;
}): JSX.Element {
  const [active, setActive] = useState(0);
  const current = files[Math.min(active, files.length - 1)];

  function update(text: string): void {
    onChange(files.map((file, i) => (i === active ? { ...file, text } : file)));
  }

  function rename(filename: string): void {
    onChange(files.map((file, i) => (i === active ? { ...file, filename } : file)));
  }

  function add(): void {
    onChange([...files, { filename: `new-${files.length + 1}.persona.md`, text: "" }]);
    setActive(files.length);
  }

  function remove(index: number): void {
    onChange(files.filter((_, i) => i !== index));
    setActive(Math.max(0, index - 1));
  }

  return (
    <div className="editor">
      <div className="editor__files">
        {files.map((file, i) => (
          <div key={`${file.filename}-${i}`} className={`editor__tab${i === active ? " editor__tab--on" : ""}`}>
            <button type="button" onClick={() => setActive(i)}>
              {file.filename}
            </button>
            <button type="button" className="editor__drop" aria-label={`Remove ${file.filename}`} onClick={() => remove(i)}>
              ×
            </button>
          </div>
        ))}
        <button type="button" className="btn--bare" onClick={add}>
          + file
        </button>
        <span className="editor__spacer" />
        <button type="button" className="btn--bare" onClick={onClose}>
          Done editing
        </button>
      </div>

      {current ? (
        <>
          <label className="editor__name">
            <span className="u-dim">filename</span>
            <input value={current.filename} onChange={(e) => rename(e.target.value)} spellCheck={false} />
          </label>
          <textarea
            className="editor__text"
            value={current.text}
            spellCheck={false}
            rows={22}
            onChange={(e) => update(e.target.value)}
            aria-label={`Contents of ${current.filename}`}
          />
        </>
      ) : (
        <p className="u-dim">No files yet. Add one, or go back and pick a starting point.</p>
      )}
    </div>
  );
}
