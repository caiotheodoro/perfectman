/**
 * snapshot-html-generator — generates a self-contained single-file HTML replay viewer.
 *
 * Features:
 * - Pulse-by-pulse timeline navigation
 * - Channel tabs with perspective filtering (who sees what)
 * - Per-agent panels: emotion circumplex, social emotion bars, thinking, dreaming
 * - No external dependencies — pure HTML/CSS/JS
 */
import type { SimulationReplay } from "./simulation-recorder.js";

export function generateHtml(replay: SimulationReplay): string {
  const dataJson = JSON.stringify(replay, null, 0);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${escapeHtml(replay.simulationName)} — Simulation Replay</title>
<style>
${CSS}
</style>
</head>
<body>

<header class="top-bar">
  <div class="sim-title">${escapeHtml(replay.simulationName)}</div>
  <div class="pulse-nav">
    <button class="nav-btn" id="btn-prev" onclick="prevPulse()">◀</button>
    <div class="timeline" id="timeline"></div>
    <button class="nav-btn" id="btn-next" onclick="nextPulse()">▶</button>
  </div>
  <div class="pulse-label">Pulse <span id="pulse-display">0</span> / ${replay.pulses.length - 1}</div>
</header>

<div class="main-layout">

  <!-- Left: channels + chat -->
  <div class="left-panel">
    <div class="channel-tabs" id="channel-tabs"></div>
    <div class="perspective-row">
      <label>Perspective:</label>
      <select id="perspective-select" onchange="setPerspective(this.value)">
        <option value="omniscient">👁 Omniscient</option>
        ${replay.agentIds.map(id =>
          `<option value="${id}">${escapeHtml(replay.agentNames[id] ?? id)}</option>`
        ).join("\n        ")}
      </select>
    </div>
    <div class="chat-feed" id="chat-feed"></div>
  </div>

  <!-- Right: agent cards -->
  <div class="right-panel">
    <div class="agent-grid" id="agent-grid"></div>
  </div>

</div>

<script id="REPLAY_DATA" type="application/json">
${dataJson}
</script>
<script>
${JS}
</script>
</body>
</html>`;
}

// ── HTML escape ───────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ── CSS ───────────────────────────────────────────────────────────────────────

const CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg: #0d0d1a;
  --bg2: #13131f;
  --bg3: #1a1a2e;
  --border: #2a2a4a;
  --text: #e0e0f0;
  --text2: #8888aa;
  --text3: #5555aa;
  --accent: #7c5cfc;
  --pulse-active: #7c5cfc;
  --ana:   #5bc8f5;
  --bruno: #7ee78e;
  --carla: #f5765a;
  --diego: #f0c060;
  --ana-dim:   #1a3e52;
  --bruno-dim: #1a3d22;
  --carla-dim: #3d1e16;
  --diego-dim: #3d3010;
}

html, body {
  height: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: 'Segoe UI', system-ui, sans-serif;
  font-size: 13px;
  overflow: hidden;
}

/* ── Top bar ── */
.top-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  background: var(--bg2);
  border-bottom: 1px solid var(--border);
  height: 52px;
  flex-shrink: 0;
}
.sim-title { font-weight: 600; font-size: 14px; color: var(--text); white-space: nowrap; }
.pulse-nav { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; }
.nav-btn {
  background: var(--bg3); border: 1px solid var(--border); color: var(--text2);
  border-radius: 4px; padding: 3px 8px; cursor: pointer; flex-shrink: 0;
}
.nav-btn:hover { border-color: var(--accent); color: var(--text); }
.timeline {
  display: flex; gap: 4px; overflow-x: auto; flex: 1;
  scrollbar-width: thin; scrollbar-color: var(--border) transparent;
}
.timeline::-webkit-scrollbar { height: 4px; }
.timeline::-webkit-scrollbar-track { background: transparent; }
.timeline::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
.pulse-btn {
  background: var(--bg3); border: 1px solid var(--border); color: var(--text2);
  border-radius: 4px; padding: 3px 8px; cursor: pointer; white-space: nowrap;
  font-size: 11px; flex-shrink: 0; min-width: 32px;
}
.pulse-btn:hover { border-color: var(--accent); color: var(--text); }
.pulse-btn.active { background: var(--pulse-active); border-color: var(--pulse-active); color: #fff; }
.pulse-label { font-size: 12px; color: var(--text2); white-space: nowrap; }

/* ── Main layout ── */
body { display: flex; flex-direction: column; }
.main-layout {
  display: flex; flex: 1; min-height: 0; overflow: hidden;
}

/* ── Left panel ── */
.left-panel {
  width: 380px; min-width: 280px; max-width: 420px;
  display: flex; flex-direction: column;
  border-right: 1px solid var(--border);
  flex-shrink: 0;
}
.channel-tabs {
  display: flex; gap: 2px; padding: 6px 8px 0;
  background: var(--bg2); border-bottom: 1px solid var(--border);
}
.ch-tab {
  padding: 5px 10px; border-radius: 6px 6px 0 0; cursor: pointer;
  font-size: 11px; color: var(--text2); background: var(--bg3);
  border: 1px solid transparent; border-bottom: none;
}
.ch-tab:hover { color: var(--text); }
.ch-tab.active {
  background: var(--bg); color: var(--text);
  border-color: var(--border); border-bottom-color: var(--bg);
  margin-bottom: -1px; z-index: 1; position: relative;
}
.perspective-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px; background: var(--bg2); border-bottom: 1px solid var(--border);
  font-size: 11px; color: var(--text2);
}
.perspective-row select {
  background: var(--bg3); border: 1px solid var(--border); color: var(--text);
  border-radius: 4px; padding: 2px 6px; font-size: 11px;
}
.chat-feed {
  flex: 1; overflow-y: auto; padding: 10px;
  display: flex; flex-direction: column; gap: 6px;
  scrollbar-width: thin; scrollbar-color: var(--border) transparent;
}
.chat-feed::-webkit-scrollbar { width: 5px; }
.chat-feed::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

.msg-bubble {
  display: flex; gap: 8px; align-items: flex-start;
  padding: 6px 8px; border-radius: 8px; background: var(--bg2);
  border-left: 3px solid var(--border);
}
.msg-bubble.ana   { border-left-color: var(--ana);   background: var(--ana-dim); }
.msg-bubble.bruno { border-left-color: var(--bruno); background: var(--bruno-dim); }
.msg-bubble.carla { border-left-color: var(--carla); background: var(--carla-dim); }
.msg-bubble.diego { border-left-color: var(--diego); background: var(--diego-dim); }
.msg-bubble.system { border-left-color: var(--text3); opacity: 0.7; }

.msg-avatar {
  width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 700;
}
.msg-avatar.ana   { background: var(--ana);   color: #000; }
.msg-avatar.bruno { background: var(--bruno); color: #000; }
.msg-avatar.carla { background: var(--carla); color: #000; }
.msg-avatar.diego { background: var(--diego); color: #000; }
.msg-body { flex: 1; min-width: 0; }
.msg-meta {
  display: flex; gap: 6px; align-items: baseline; margin-bottom: 2px;
}
.msg-name { font-weight: 600; font-size: 11px; }
.msg-name.ana   { color: var(--ana); }
.msg-name.bruno { color: var(--bruno); }
.msg-name.carla { color: var(--carla); }
.msg-name.diego { color: var(--diego); }
.msg-pulse { font-size: 10px; color: var(--text3); }
.msg-text { font-size: 12px; line-height: 1.4; word-break: break-word; }
.msg-channel-badge {
  font-size: 9px; color: var(--text3); background: var(--bg3);
  border-radius: 3px; padding: 1px 4px; white-space: nowrap;
}
.msg-type-badge {
  font-size: 9px; color: var(--text3); font-style: italic;
}
.empty-state {
  color: var(--text3); text-align: center; padding: 20px; font-style: italic;
}

/* ── Right panel (agent grid) ── */
.right-panel { flex: 1; overflow-y: auto; padding: 10px; min-width: 0; }
.agent-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
}

/* ── Agent card ── */
.agent-card {
  background: var(--bg2); border: 1px solid var(--border);
  border-radius: 10px; overflow: hidden;
}
.agent-card-header {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; font-weight: 600; font-size: 13px;
  border-bottom: 1px solid var(--border);
}
.agent-dot { width: 10px; height: 10px; border-radius: 50%; }
.agent-dot.ana   { background: var(--ana); }
.agent-dot.bruno { background: var(--bruno); }
.agent-dot.carla { background: var(--carla); }
.agent-dot.diego { background: var(--diego); }
.agent-name.ana   { color: var(--ana); }
.agent-name.bruno { color: var(--bruno); }
.agent-name.carla { color: var(--carla); }
.agent-name.diego { color: var(--diego); }
.agent-archetype { font-size: 10px; color: var(--text3); font-weight: 400; }
.agent-action-badge {
  margin-left: auto; font-size: 10px; padding: 2px 6px;
  border-radius: 4px; background: var(--bg3); color: var(--text2);
}

.agent-card-body { padding: 10px 12px; display: flex; flex-direction: column; gap: 10px; }

/* Circumplex */
.circumplex-wrap { display: flex; gap: 10px; align-items: flex-start; }
.circumplex-container { flex-shrink: 0; }
.circumplex-svg { display: block; }
.mood-labels { font-size: 9px; color: var(--text3); display: flex; flex-direction: column; gap: 2px; }
.mood-label-row { display: flex; gap: 4px; }
.mood-val { color: var(--text2); font-variant-numeric: tabular-nums; }

/* Social emotion bars */
.section-label {
  font-size: 10px; color: var(--text3); text-transform: uppercase; letter-spacing: 0.5px;
  margin-bottom: 4px;
}
.emo-bars { display: flex; flex-direction: column; gap: 3px; }
.emo-row { display: flex; align-items: center; gap: 6px; }
.emo-name { width: 90px; font-size: 10px; color: var(--text2); text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.emo-bar-track { flex: 1; height: 6px; background: var(--bg3); border-radius: 3px; overflow: hidden; }
.emo-bar-fill { height: 100%; border-radius: 3px; transition: width 0.3s; }
.emo-bar-fill.positive { background: #4ade80; }
.emo-bar-fill.negative { background: #f87171; }
.emo-bar-fill.neutral  { background: #818cf8; }
.emo-val { width: 32px; font-size: 10px; color: var(--text3); font-variant-numeric: tabular-nums; text-align: right; }

/* Thinking panel */
.thinking-panel {
  background: var(--bg3); border-radius: 6px; padding: 8px 10px;
  border-left: 2px solid var(--accent);
}
.panel-title { font-size: 10px; color: var(--text3); margin-bottom: 4px; }
.thinking-text { font-size: 11px; color: var(--text); line-height: 1.5; font-style: italic; }
.thinking-drivers { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px; }
.driver-tag {
  font-size: 9px; padding: 1px 5px; border-radius: 3px;
  background: var(--bg); color: var(--text3); border: 1px solid var(--border);
}
.driver-tag.emotion { border-color: #818cf8; color: #818cf8; }
.driver-tag.motivation { border-color: #4ade80; color: #4ade80; }
.thinking-idle { color: var(--text3); font-style: italic; font-size: 11px; }

/* Dreaming panel */
.dream-panel {
  background: var(--bg3); border-radius: 6px; padding: 8px 10px;
  border-left: 2px solid #818cf8;
}
.dream-text { font-size: 11px; color: var(--text2); line-height: 1.5; }
.dream-accumulators { margin-top: 6px; display: flex; flex-direction: column; gap: 3px; }
.acc-row { display: flex; align-items: center; gap: 6px; }
.acc-name { width: 110px; font-size: 10px; color: var(--text3); text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.acc-track { flex: 1; height: 5px; background: var(--bg); border-radius: 3px; overflow: hidden; }
.acc-fill { height: 100%; background: #818cf8; border-radius: 3px; transition: width 0.3s; }
.acc-threshold { position: relative; }

/* Relations */
.relations-row { display: flex; gap: 6px; flex-wrap: wrap; }
.rel-chip {
  display: flex; align-items: center; gap: 4px;
  background: var(--bg3); border: 1px solid var(--border);
  border-radius: 12px; padding: 2px 8px; font-size: 10px;
}
.rel-name { color: var(--text2); }
.rel-trust { font-variant-numeric: tabular-nums; }
.trust-pos { color: #4ade80; }
.trust-neg { color: #f87171; }
.trust-neu { color: var(--text3); }

/* Scrollbar global */
::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
`;

// ── JavaScript ────────────────────────────────────────────────────────────────

const JS = `
// ── Load replay data ────────────────────────────────────────────────────────
const REPLAY = JSON.parse(document.getElementById('REPLAY_DATA').textContent);
const AGENT_IDS = REPLAY.agentIds;
const AGENT_NAMES = REPLAY.agentNames;
const AGENT_ARCHETYPES = REPLAY.agentArchetypes;
const CHANNELS = REPLAY.channels;
const PULSES = REPLAY.pulses;

// ── State ────────────────────────────────────────────────────────────────────
let currentPulse = 0;
let currentChannel = CHANNELS[0]?.id ?? 'general';
let perspective = 'omniscient';

// ── Colour map ───────────────────────────────────────────────────────────────
function agentColor(id) {
  const COLORS = { ana: '#5bc8f5', bruno: '#7ee78e', carla: '#f5765a', diego: '#f0c060' };
  return COLORS[id] ?? '#8888aa';
}
function agentInitial(id) {
  return (AGENT_NAMES[id] ?? id)[0].toUpperCase();
}

// ── INIT ─────────────────────────────────────────────────────────────────────
function init() {
  buildTimeline();
  buildChannelTabs();
  buildAgentGrid();
  renderPulse(0);
}

function buildTimeline() {
  const tl = document.getElementById('timeline');
  PULSES.forEach((p, i) => {
    const btn = document.createElement('button');
    btn.className = 'pulse-btn' + (i === 0 ? ' active' : '');
    btn.id = 'tlbtn-' + i;
    btn.textContent = String(i);
    btn.onclick = () => goToPulse(i);
    tl.appendChild(btn);
  });
}

function buildChannelTabs() {
  const tabs = document.getElementById('channel-tabs');
  CHANNELS.forEach((ch, i) => {
    const btn = document.createElement('button');
    btn.className = 'ch-tab' + (i === 0 ? ' active' : '');
    btn.id = 'chtab-' + ch.id;
    btn.textContent = ch.name;
    btn.title = ch.type === 'private_channel' ? '🔒 ' + ch.memberAgentIds.join(', ') : '🌐 ' + ch.memberAgentIds.join(', ');
    btn.onclick = () => setChannel(ch.id);
    tabs.appendChild(btn);
  });
}

function buildAgentGrid() {
  const grid = document.getElementById('agent-grid');
  AGENT_IDS.forEach(id => {
    const card = document.createElement('div');
    card.className = 'agent-card';
    card.id = 'card-' + id;
    card.innerHTML = agentCardHtml(id);
    grid.appendChild(card);
  });
}

// ── Navigation ───────────────────────────────────────────────────────────────
function goToPulse(i) {
  document.getElementById('tlbtn-' + currentPulse)?.classList.remove('active');
  currentPulse = Math.max(0, Math.min(i, PULSES.length - 1));
  document.getElementById('tlbtn-' + currentPulse)?.classList.add('active');
  document.getElementById('tlbtn-' + currentPulse)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  renderPulse(currentPulse);
  document.getElementById('pulse-display').textContent = currentPulse;
}
function prevPulse() { goToPulse(currentPulse - 1); }
function nextPulse() { goToPulse(currentPulse + 1); }
function setChannel(id) {
  document.getElementById('chtab-' + currentChannel)?.classList.remove('active');
  currentChannel = id;
  document.getElementById('chtab-' + id)?.classList.add('active');
  renderChat();
}
function setPerspective(val) {
  perspective = val;
  renderChat();
}

// ── Render ───────────────────────────────────────────────────────────────────
function renderPulse(idx) {
  renderChat();
  AGENT_IDS.forEach(id => updateAgentCard(id, idx));
}

function renderChat() {
  const feed = document.getElementById('chat-feed');
  // Collect all messages up to and including currentPulse
  const msgs = [];
  for (let pi = 0; pi <= currentPulse; pi++) {
    const frame = PULSES[pi];
    if (!frame) continue;
    for (const evt of frame.committedEvents) {
      if (evt.channelId !== currentChannel) continue;
      if (!isVisible(evt)) continue;
      if (evt.type === 'message_sent' || evt.type === 'reply_sent') {
        msgs.push({ evt, pulseIndex: pi });
      } else if (evt.type === 'channel_created') {
        msgs.push({ evt, pulseIndex: pi });
      }
    }
  }
  if (msgs.length === 0) {
    feed.innerHTML = '<div class="empty-state">No visible messages in this channel</div>';
    return;
  }
  feed.innerHTML = msgs.map(({ evt, pulseIndex }) => renderMsgBubble(evt, pulseIndex)).join('');
  feed.scrollTop = feed.scrollHeight;
}

function isVisible(evt) {
  if (perspective === 'omniscient') return true;
  const vis = evt.visibility;
  if (!vis) return true;
  if (vis.visibleToAgents && vis.visibleToAgents.length > 0) {
    return vis.visibleToAgents.includes(perspective);
  }
  // empty means visible to all members of the channel
  const ch = CHANNELS.find(c => c.id === evt.channelId);
  return ch ? ch.memberAgentIds.includes(perspective) : true;
}

function renderMsgBubble(evt, pulseIndex) {
  const id = evt.actorId;
  const cls = id in AGENT_NAMES ? id : 'system';
  const name = AGENT_NAMES[id] ?? id;
  const initial = agentInitial(id);
  const content = evt.payload?.content ?? evt.payload?.channelName ?? '';
  const typeLabel = evt.type === 'reply_sent' ? '↩ reply' : (evt.type === 'channel_created' ? '📢 channel created' : '');
  const ch = CHANNELS.find(c => c.id === evt.channelId);
  const chBadge = ch && ch.type === 'private_channel' ? \`<span class="msg-channel-badge">🔒 \${ch.name}</span>\` : '';
  return \`
  <div class="msg-bubble \${cls}">
    <div class="msg-avatar \${cls}">\${initial}</div>
    <div class="msg-body">
      <div class="msg-meta">
        <span class="msg-name \${cls}">\${escHtml(name)}</span>
        <span class="msg-pulse">P\${pulseIndex}</span>
        \${chBadge}
        \${typeLabel ? \`<span class="msg-type-badge">\${typeLabel}</span>\` : ''}
      </div>
      <div class="msg-text">\${escHtml(String(content))}</div>
    </div>
  </div>\`;
}

// ── Agent cards ───────────────────────────────────────────────────────────────
function agentCardHtml(id) {
  const name = AGENT_NAMES[id] ?? id;
  const arch = AGENT_ARCHETYPES[id] ?? '';
  return \`
  <div class="agent-card-header">
    <div class="agent-dot \${id}"></div>
    <span class="agent-name \${id}">\${escHtml(name)}</span>
    <span class="agent-archetype">\${escHtml(arch)}</span>
    <span class="agent-action-badge" id="action-badge-\${id}">—</span>
  </div>
  <div class="agent-card-body">
    <div class="circumplex-wrap">
      <div class="circumplex-container">
        <svg class="circumplex-svg" width="90" height="90" id="circ-\${id}" viewBox="0 0 90 90">
          <!-- grid -->
          <rect x="0" y="0" width="90" height="90" fill="#13131f" rx="6"/>
          <line x1="45" y1="5" x2="45" y2="85" stroke="#2a2a4a" stroke-width="1"/>
          <line x1="5" y1="45" x2="85" y2="45" stroke="#2a2a4a" stroke-width="1"/>
          <circle cx="45" cy="45" r="30" fill="none" stroke="#2a2a4a" stroke-width="0.5"/>
          <circle cx="45" cy="45" r="15" fill="none" stroke="#2a2a4a" stroke-width="0.5"/>
          <!-- axis labels -->
          <text x="47" y="10" fill="#5555aa" font-size="7">excited</text>
          <text x="47" y="82" fill="#5555aa" font-size="7">calm</text>
          <text x="5"  y="43" fill="#5555aa" font-size="7">−</text>
          <text x="79" y="43" fill="#5555aa" font-size="7">+</text>
          <!-- agent dot -->
          <circle cx="45" cy="45" r="5" id="cdot-\${id}" fill="${{ana:'#5bc8f5',bruno:'#7ee78e',carla:'#f5765a',diego:'#f0c060'}}" opacity="0.9"/>
        </svg>
      </div>
      <div class="mood-labels" id="moodlabels-\${id}">
        <div class="mood-label-row"><span class="mood-val" style="color:#aaa">v</span>&nbsp;<span class="mood-val" id="mv-\${id}">—</span></div>
        <div class="mood-label-row"><span class="mood-val" style="color:#aaa">a</span>&nbsp;<span class="mood-val" id="ma-\${id}">—</span></div>
        <div class="mood-label-row"><span class="mood-val" style="color:#aaa">s</span>&nbsp;<span class="mood-val" id="ms-\${id}">—</span></div>
        <div class="mood-label-row"><span class="mood-val" style="color:#aaa">e</span>&nbsp;<span class="mood-val" id="me-\${id}">—</span></div>
      </div>
    </div>
    <div>
      <div class="section-label">Social Emotions</div>
      <div class="emo-bars" id="emobars-\${id}"></div>
    </div>
    <div class="thinking-panel">
      <div class="panel-title">💭 Thinking</div>
      <div id="thinking-\${id}"><span class="thinking-idle">No LLM call this pulse</span></div>
    </div>
    <div class="dream-panel">
      <div class="panel-title">🌙 Dreaming</div>
      <div id="dream-\${id}"></div>
    </div>
    <div>
      <div class="section-label">Relations</div>
      <div class="relations-row" id="rels-\${id}"></div>
    </div>
  </div>\`;
}

const AGENT_COLORS = {ana:'#5bc8f5',bruno:'#7ee78e',carla:'#f5765a',diego:'#f0c060'};

function updateAgentCard(id, pulseIdx) {
  const frame = PULSES[pulseIdx];
  if (!frame) return;
  const state = frame.agentStates[id];
  const thinking = frame.agentThinking[id];

  // action badge
  const badge = document.getElementById('action-badge-' + id);
  if (badge) {
    const actEvt = frame.committedEvents.find(e => e.actorId === id && (e.type === 'message_sent' || e.type === 'reply_sent' || e.type === 'create_channel'));
    const noOp = frame.committedEvents.find(e => e.actorId === id && e.type === 'no_op_recorded');
    badge.textContent = actEvt ? (actEvt.type === 'message_sent' ? '💬 message' : actEvt.type === 'reply_sent' ? '↩ reply' : '📢 channel') : (noOp ? '🤫 no-op' : '—');
  }

  if (!state) return;

  // Circumplex
  const mood = state.coreMood;
  const dot = document.getElementById('cdot-' + id);
  if (dot) {
    // valence [-1,1] → x [10,80], arousal [0,1] → y [80,10] (inverted)
    const x = 10 + ((mood.valence + 1) / 2) * 70;
    const y = 80 - (mood.arousal * 70);
    dot.setAttribute('cx', String(x.toFixed(1)));
    dot.setAttribute('cy', String(y.toFixed(1)));
    const color = AGENT_COLORS[id] ?? '#8888aa';
    dot.setAttribute('fill', color);
  }
  const mvEl = document.getElementById('mv-' + id);
  const maEl = document.getElementById('ma-' + id);
  const msEl = document.getElementById('ms-' + id);
  const meEl = document.getElementById('me-' + id);
  if (mvEl) mvEl.textContent = mood.valence.toFixed(2);
  if (maEl) maEl.textContent = mood.arousal.toFixed(2);
  if (msEl) msEl.textContent = mood.stability.toFixed(2);
  if (meEl) meEl.textContent = mood.energy.toFixed(2);

  // Social emotions
  const barsEl = document.getElementById('emobars-' + id);
  if (barsEl) {
    const POSITIVE_EMOS = new Set(['pride','affection','admiration','desireForIntimacy']);
    const NEGATIVE_EMOS = new Set(['jealousy','envy','humiliation','shame','resentment','suspicion','contempt','neediness','socialAnxiety','fearOfExclusion']);
    const se = state.socialEmotions;
    const entries = Object.entries(se).sort(([,a],[,b]) => b - a).slice(0, 7);
    barsEl.innerHTML = entries.map(([k, v]) => {
      const cls = POSITIVE_EMOS.has(k) ? 'positive' : NEGATIVE_EMOS.has(k) ? 'negative' : 'neutral';
      const label = k.replace(/([A-Z])/g, ' $1').toLowerCase();
      return \`<div class="emo-row">
        <span class="emo-name">\${label}</span>
        <div class="emo-bar-track"><div class="emo-bar-fill \${cls}" style="width:\${(v*100).toFixed(1)}%"></div></div>
        <span class="emo-val">\${(v).toFixed(2)}</span>
      </div>\`;
    }).join('');
  }

  // Thinking
  const thinkEl = document.getElementById('thinking-' + id);
  if (thinkEl) {
    if (thinking) {
      const driversHtml = [
        ...(thinking.emotionDrivers.map(d => \`<span class="driver-tag emotion">\${escHtml(d)}</span>\`)),
        ...(thinking.motivationDrivers.map(d => \`<span class="driver-tag motivation">\${escHtml(d)}</span>\`)),
      ].join('');
      thinkEl.innerHTML = \`
        <div class="thinking-text">\${escHtml(thinking.privateMotiveSummary)}</div>
        \${driversHtml ? \`<div class="thinking-drivers">\${driversHtml}</div>\` : ''}
      \`;
    } else {
      thinkEl.innerHTML = '<span class="thinking-idle">No LLM call this pulse</span>';
    }
  }

  // Dreaming — from initiativeAccumulators
  const dreamEl = document.getElementById('dream-' + id);
  if (dreamEl) {
    const accs = (state.initiativeAccumulators ?? [])
      .filter(a => a.value > 0.05)
      .sort((a, b) => (b.value / b.threshold) - (a.value / a.threshold))
      .slice(0, 4);
    const topAcc = accs[0];
    const topEmo = topSocialEmotion(state.socialEmotions);
    const topRel = topRelation(state.relationalStates);
    const name = AGENT_NAMES[id] ?? id;
    let narrative = '';
    if (topAcc && topAcc.value > 0.1) {
      const pct = Math.min(100, Math.round((topAcc.value / topAcc.threshold) * 100));
      const accLabel = topAcc.source.replace(/_/g, ' ');
      narrative = \`<span style="color:#a0a0cc">\${escHtml(name)}</span> lingers in silence, \${accLabel} building (\${pct}% of threshold).\`;
      if (topEmo) narrative += \` There's a quiet <span style="color:#818cf8">\${topEmo.key.replace(/([A-Z])/g,' $1').toLowerCase()}</span> in the air.\`;
      if (topRel) narrative += \` \${escHtml(AGENT_NAMES[topRel.id] ?? topRel.id)}'s presence weighs on them.\`;
    } else {
      narrative = \`\${escHtml(name)}'s mind is quiet — no strong pulls right now.\`;
    }
    const accBars = accs.map(a => {
      const pct = Math.min(100, (a.value / a.threshold) * 100);
      return \`<div class="acc-row">
        <span class="acc-name">\${a.source.replace(/_/g,' ')}</span>
        <div class="acc-track"><div class="acc-fill" style="width:\${pct.toFixed(1)}%"></div></div>
        <span class="emo-val">\${a.value.toFixed(2)}</span>
      </div>\`;
    }).join('');
    dreamEl.innerHTML = \`<div class="dream-text">\${narrative}</div>\${accs.length > 0 ? '<div class="dream-accumulators">' + accBars + '</div>' : ''}\`;
  }

  // Relations
  const relsEl = document.getElementById('rels-' + id);
  if (relsEl) {
    const rels = Object.values(state.relationalStates ?? {});
    if (rels.length === 0) {
      relsEl.innerHTML = '<span style="color:var(--text3);font-size:10px">No relationships yet</span>';
    } else {
      relsEl.innerHTML = rels.map(r => {
        const trust = r.trust;
        const cls = trust > 0.2 ? 'trust-pos' : trust < -0.2 ? 'trust-neg' : 'trust-neu';
        const name = AGENT_NAMES[r.targetAgentId] ?? r.targetAgentId;
        return \`<div class="rel-chip">
          <span class="rel-name">\${escHtml(name)}</span>
          <span class="rel-trust \${cls}">\${trust >= 0 ? '+' : ''}\${trust.toFixed(2)}</span>
        </div>\`;
      }).join('');
    }
  }
}

function topSocialEmotion(se) {
  if (!se) return null;
  let best = null;
  for (const [k, v] of Object.entries(se)) {
    if (!best || v > best.val) best = { key: k, val: v };
  }
  return best && best.val > 0.05 ? best : null;
}
function topRelation(rels) {
  if (!rels) return null;
  let best = null;
  for (const [id, r] of Object.entries(rels)) {
    const strength = Math.abs(r.trust) + r.affection + r.resentment;
    if (!best || strength > best.strength) best = { id, strength };
  }
  return best;
}

function escHtml(s) {
  if (typeof s !== 'string') s = String(s ?? '');
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

// keyboard nav
document.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextPulse();
  if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   prevPulse();
});

init();
`;
