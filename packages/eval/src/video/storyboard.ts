import type { VideoBeat, VideoStep, VideoStory, VideoStoryboard } from "./types.js";

/** Keep every code point and newline; split at a word boundary when possible. */
export function paginateText(text: string, maxCharacters = 220): string[] {
  if (!Number.isInteger(maxCharacters) || maxCharacters < 1) throw new Error("Page size must be a positive integer");
  if (!text.length) return [""];
  const characters = Array.from(text);
  const pages: string[] = [];
  for (let start = 0; start < characters.length;) {
    let end = Math.min(start + maxCharacters, characters.length);
    let newlines = 0;
    for (let i = start; i < end; i++) {
      if (characters[i] === "\n" && ++newlines === 5) { end = i + 1; break; }
    }
    if (end < characters.length && !/\s/u.test(characters[end - 1]!)) {
      for (let i = end - 1; i > start + Math.floor((end - start) / 2); i--) {
        if (/\s/u.test(characters[i]!)) { end = i + 1; break; }
      }
    }
    pages.push(characters.slice(start, end).join(""));
    start = end;
  }
  return pages;
}

export function planVideo(story: VideoStory, sourceFile: string, sourceSha256: string): VideoStoryboard {
  if (!story.steps.length) throw new Error("The source has no video steps");
  const fps = 30 as const;
  const intro = Math.max(2, 1 + story.title.split(/\s+/u).length / 3);
  let frame = Math.ceil(intro * fps);
  const beats: VideoBeat[] = [];
  story.steps.forEach((step: VideoStep, stepIndex) => {
    const pages = paginateText(step.text);
    pages.forEach((text, pageIndex) => {
      const words = text.trim().split(/\s+/u).filter(Boolean).length;
      const readingSeconds = Math.max(2.5, 1 + words / 3.2, 1 + Array.from(text).length / 24);
      const frames = Math.ceil(Math.max(readingSeconds, (step.duration ?? 0) / pages.length) * fps);
      if (!Number.isSafeInteger(frame + frames)) throw new Error("Requested video timing exceeds the supported range");
      const { raw: _raw, ...display } = step;
      beats.push({ ...display, text, stepIndex, pageIndex, pageCount: pages.length, start: frame / fps, duration: frames / fps });
      frame += frames;
    });
  });
  return {
    ...story, version: "perfectman-storyboard-v1", sourceFile, sourceSha256,
    beats, duration: frame / fps + 3, fps,
  };
}
