// Interactive playback only. The MP4 uses the same cue envelopes through HyperFrames.
window.storyAudio = (() => {
  let enabled = false, level = .8;
  const pending = new Set();
  const elements = new Map((window.VIDEO.audio || []).map(cue => [cue.id, document.getElementById(cue.id)]));
  function sync(time, playing) {
    for (const cue of window.VIDEO.audio || []) {
      const media = elements.get(cue.id);
      if (!media) continue;
      const elapsed = time - cue.start, active = elapsed >= 0 && elapsed < cue.duration;
      if (!enabled || !playing || !active) { if (!media.paused) media.pause(); continue; }
      const fade = Math.min(1, cue.fadeIn ? elapsed / cue.fadeIn : 1, cue.fadeOut ? (cue.duration - elapsed) / cue.fadeOut : 1);
      media.volume = Math.min(1, Math.max(0, cue.volume * level * fade));
      const position = cue.mediaStart + elapsed;
      if ((media.paused && !pending.has(media)) || Math.abs(media.currentTime - position) > .25) media.currentTime = position;
      if (media.paused && !pending.has(media)) {
        pending.add(media);
        media.play().catch(error => {
          if (error.name === 'AbortError') return;
          enabled = false;
          const button = document.getElementById('sound');
          button.textContent = 'Enable sound'; button.setAttribute('aria-pressed', 'false');
          document.getElementById('playback-status').textContent = 'Sound needs a click to play. Choose Enable sound.';
        }).finally(() => pending.delete(media));
      }
    }
  }
  return {
    sync,
    toggle() { enabled = !enabled; return enabled; },
    volume(value) { level = Number(value); },
    pause() { for (const media of elements.values()) media?.pause(); },
  };
})();
