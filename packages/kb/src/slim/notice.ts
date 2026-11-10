/**
 * The notice every slim file carries. `NOTICE.md` next to this file is the same text, and a test pins the two equal: edit both.
 * It is written into the file's header, so an excerpt that is redistributed with its file keeps its source and licence terms.
 */
export const SLIM_NOTICE = `Notice for kb-slim.json (third-party text)

This file holds short excerpts, at most 420 characters each, of plays that are in the public domain in the United States or are published under a share-alike licence. Speaker names inside an excerpt are replaced by letters; the words are otherwise the source's. Every beat points at a work in the works table, which names the title, the author and the licence class.

- public-domain-us: Project Gutenberg texts, in the editions and translations Project Gutenberg distributes. Project Gutenberg is a registered trademark; these excerpts are not Project Gutenberg files and carry none of its header.
- cc-by-sa: pt.wikisource transcriptions of Portuguese-language plays, licensed CC BY-SA. An excerpt from these, and anything derived from such an excerpt that is redistributed, must keep this notice, name the work and its author, and stay under CC BY-SA (share-alike).
- Never redistribute an excerpt without the work, author and licence it came with.
- The labels (action, tactic, status, emotion) are this project's own and are not part of the source texts.
- Left out on purpose: every screenplay, every Folger Digital Text (CC BY-NC), and every text without a verified licence line.
`;

/** What a rendering says per licence class. */
export const SLIM_LICENSE_LINES: Readonly<Record<string, string>> = {
  "public-domain-us": "Public domain in the United States (Project Gutenberg text).",
  "cc-by-sa": "CC BY-SA, share-alike (pt.wikisource text): derived excerpts must carry source and licence.",
};
