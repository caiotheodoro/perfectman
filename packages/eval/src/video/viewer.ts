/** The browser player wraps the same composition that produces the MP4. */
export function renderViewer(composition: string): string {
  const history = `<aside id="channel-history" hidden aria-label="Channel messages"><h2 id="history-title">Channel messages</h2><p>Choose a message to view it.</p><div id="history-list"></div></aside>`;
  const controls = `<div id="reading-pane" aria-live="polite"></div>
    <footer id="viewer-controls" aria-label="Story playback">
      <div class="playback-buttons"><button id="play" type="button" aria-label="Pause story">Pause</button><button id="previous" type="button" aria-label="Previous step">Previous</button><button id="next" type="button" aria-label="Next step">Next</button><button id="follow" type="button" hidden>Follow story</button></div>
      <div class="playback-time"><label for="seek">Story position</label><input id="seek" type="range" min="0" step="0.033333" value="0"><output id="clock" for="seek">0:00</output></div>
      <div class="sound-controls"><button id="sound" type="button" aria-pressed="false">Enable sound</button><label for="volume">Volume</label><input id="volume" type="range" min="0" max="1" step="0.05" value="0.8"><a href="assets/audio/ATTRIBUTION.md" target="_blank" rel="noopener">Music credits</a></div>
      <p id="playback-status" role="status">Following the story. Choose a channel to browse.</p>
    </footer><script src="assets/viewer-audio.js"></script><script src="assets/viewer.js"></script>`;
  return composition.replace('</head>', '<link rel="stylesheet" href="assets/viewer.css"></head>')
    .replace('<body>', '<body data-viewer="true">')
    .replace('data-composition-id="run-video"', 'data-viewer-scene="run-video"')
    .replace('<main id="stage"', '<label id="mobile-conversation">Conversation<select id="conversation-picker"><option value="">Browse a conversation…</option></select></label><div id="viewer-shell"><div id="viewer-viewport"><main id="stage"')
    .replace('</main>', `</main></div>${history}</div>`)
    .replace('</body>', `${controls}</body>`);
}
