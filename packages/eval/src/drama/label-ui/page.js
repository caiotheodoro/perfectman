// Clip labeler front end. Plain browser JS, no build step, no dependencies.
// Blind mode: the server never sends judge/model scores, so there is nothing to hide here.
"use strict";

const SAVE_DEBOUNCE_MS = 600;
const EXTRA_CODE_PATTERN = /^[A-Z]\d+$/;
const LABELER_KEY = "pm.labeler";
const draftKey = (id) => `pm.draft.${id}`;

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, children = []) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const c of children) node.append(c);
  return node;
};

const state = {
  meta: null,
  clips: [],
  labeled: new Map(), // clip id -> true when a label file exists
  index: -1,
  draft: null,
  focus: 0,
  saveTimer: null,
  inflight: Promise.resolve(),
  version: 0, // bumped on every edit; a save only counts as clean if the version did not move
  loadToken: 0,
};

const axisRows = new Map(); // axis id -> { root, buttons }
const codeBoxes = new Map(); // D-code id -> checkbox

async function api(path, init) {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = Array.isArray(body.details) ? `: ${body.details.join("; ")}` : "";
    throw Object.assign(new Error((body.error || `HTTP ${res.status}`) + detail), { status: res.status });
  }
  return body;
}

function emptyDraft() {
  const scores = {};
  for (const a of state.meta.axes) scores[a.id] = undefined; // undefined = not answered yet, null = N/A
  return { scores, failureCodes: [], pass: null, notes: "" };
}

function draftFromLabel(label) {
  const d = emptyDraft();
  for (const a of state.meta.axes) d.scores[a.id] = label.scores[a.id].score;
  d.failureCodes = [...label.failureCodes];
  d.pass = label.pass;
  d.notes = label.notes || "";
  return d;
}

function loadSavedDraft(id) {
  try {
    const raw = localStorage.getItem(draftKey(id));
    if (!raw) return null;
    const d = JSON.parse(raw);
    const out = emptyDraft();
    for (const a of state.meta.axes) {
      const v = d.scores?.[a.id];
      out.scores[a.id] = v === null || (Number.isInteger(v) && v >= 1 && v <= 5) ? v : undefined;
    }
    out.failureCodes = Array.isArray(d.failureCodes) ? d.failureCodes.filter((c) => EXTRA_CODE_PATTERN.test(c)) : [];
    out.pass = typeof d.pass === "boolean" ? d.pass : null;
    out.notes = typeof d.notes === "string" ? d.notes : "";
    return out;
  } catch {
    return null;
  }
}

function persistDraft() {
  const clip = currentClip();
  if (!clip) return;
  // JSON turns undefined into a missing key, which loadSavedDraft reads back as unanswered.
  localStorage.setItem(draftKey(clip.id), JSON.stringify(state.draft));
}

const currentClip = () => state.clips[state.index];
const labeler = () => $("labeler").value.trim();
const missingAxes = () => state.meta.axes.filter((a) => state.draft.scores[a.id] === undefined).map((a) => a.id);
const isComplete = () => state.draft !== null && missingAxes().length === 0 && state.draft.pass !== null;

function toLabel() {
  const scores = {};
  for (const a of state.meta.axes) scores[a.id] = { score: state.draft.scores[a.id] };
  const notes = state.draft.notes.trim();
  return {
    clipId: currentClip().id,
    labeler: labeler(),
    labeledAt: new Date().toISOString(),
    scores,
    failureCodes: [...state.draft.failureCodes],
    pass: state.draft.pass,
    ...(notes ? { notes } : {}),
  };
}

function setSaveState(kind, text) {
  const node = $("save-state");
  node.dataset.state = kind;
  node.textContent = text;
}

function refreshSaveState() {
  if (!state.draft) return;
  if (!isComplete()) {
    const answered = state.meta.axes.length - missingAxes().length;
    const need = state.draft.pass === null ? ", pass/fail" : "";
    setSaveState("draft", `draft: ${answered}/${state.meta.axes.length} axes${need} - not saved yet`);
  } else if (!labeler()) {
    setSaveState("draft", "enter your name to save");
  }
}

function renderProgress() {
  const done = [...state.labeled.values()].filter(Boolean).length;
  $("progress").textContent = `${done}/${state.clips.length} labelled`;
}

function renderClipList() {
  const list = $("clip-list");
  list.replaceChildren(
    ...state.clips.map((clip, i) => {
      const li = el("li", { className: i === state.index ? "current" : "", title: clip.title }, [
        el("span", { className: "mark", textContent: state.labeled.get(clip.id) ? "✓" : "" }),
        el("span", { className: "name", textContent: clip.id }),
      ]);
      li.dataset.id = clip.id;
      li.addEventListener("click", () => void loadClip(i));
      return li;
    }),
  );
  list.children[state.index]?.scrollIntoView({ block: "nearest" });
}

function renderDraft() {
  const d = state.draft;
  state.meta.axes.forEach((a, i) => {
    const row = axisRows.get(a.id);
    row.root.classList.toggle("focus", i === state.focus);
    row.root.classList.toggle("missing", false);
    for (const [value, btn] of row.buttons) btn.classList.toggle("on", d.scores[a.id] === value);
  });
  for (const [id, box] of codeBoxes) box.checked = d.failureCodes.includes(id);
  const extras = d.failureCodes.filter((c) => !codeBoxes.has(c));
  $("extra-chips").replaceChildren(
    ...extras.map((code) =>
      el("span", { className: "chip" }, [
        code,
        el("button", { type: "button", title: `remove ${code}`, textContent: "×", onclick: () => toggleCode(code, false) }),
      ]),
    ),
  );
  const passSeg = $("pass");
  passSeg.classList.toggle("pass-on", d.pass === true);
  passSeg.classList.toggle("pass-off", d.pass === false);
  for (const btn of passSeg.children) btn.classList.toggle("on", String(d.pass) === btn.dataset.pass);
  if ($("notes").value !== d.notes) $("notes").value = d.notes;
}

function onEdit() {
  state.version++;
  $("hint").textContent = "";
  persistDraft();
  renderDraft();
  if (!isComplete() || !labeler()) {
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    refreshSaveState();
    return;
  }
  setSaveState("unsaved", "unsaved changes…");
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => void save(), SAVE_DEBOUNCE_MS);
}

/** Saves the current draft if it is complete. Resolves when the PUT has settled. */
function save() {
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  if (!isComplete() || !labeler()) return state.inflight;
  const clip = currentClip();
  const label = toLabel();
  const version = state.version;
  setSaveState("unsaved", "saving…");
  state.inflight = state.inflight.then(async () => {
    try {
      await api(`/api/labels/${encodeURIComponent(clip.id)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(label),
      });
      state.labeled.set(clip.id, true);
      renderProgress();
      renderClipList();
      if (version === state.version && currentClip()?.id === clip.id) {
        localStorage.removeItem(draftKey(clip.id));
        setSaveState("saved", `saved ✓ ${new Date().toLocaleTimeString()}`);
      }
    } catch (err) {
      setSaveState("error", `NOT SAVED: ${err.message}`);
    }
  });
  return state.inflight;
}

async function flushSave() {
  if (state.saveTimer !== null) await save();
  await state.inflight;
}

function setScore(value) {
  const axis = state.meta.axes[state.focus];
  state.draft.scores[axis.id] = value;
  onEdit();
}

function moveFocus(delta) {
  const n = state.meta.axes.length;
  state.focus = (state.focus + delta + n) % n;
  renderDraft();
}

function toggleCode(code, on) {
  const set = new Set(state.draft.failureCodes);
  if (on) set.add(code);
  else set.delete(code);
  state.draft.failureCodes = [...set];
  onEdit();
}

function addExtraCode() {
  const input = $("extra-code");
  const code = input.value.trim().toUpperCase();
  const err = $("extra-error");
  if (!code) return;
  if (!EXTRA_CODE_PATTERN.test(code)) {
    err.textContent = "use one letter then digits, e.g. E10";
    return;
  }
  err.textContent = "";
  input.value = "";
  toggleCode(code, true);
}

async function loadClip(i) {
  if (i < 0 || i >= state.clips.length) return;
  await flushSave();
  const token = ++state.loadToken;
  const clip = state.clips[i];
  let label = null;
  try {
    label = await api(`/api/labels/${encodeURIComponent(clip.id)}`);
  } catch (err) {
    if (err.status !== 404) setSaveState("error", `could not read label: ${err.message}`);
  }
  if (token !== state.loadToken) return;
  state.index = i;
  state.focus = 0;
  state.version++;
  state.draft = loadSavedDraft(clip.id) || (label ? draftFromLabel(label) : emptyDraft());
  const restored = !!localStorage.getItem(draftKey(clip.id));

  $("clip-title").textContent = clip.title;
  const dur = clip.durationSec === null ? "" : ` · ${Math.floor(clip.durationSec / 60)}:${String(Math.round(clip.durationSec % 60)).padStart(2, "0")}`;
  $("clip-meta").textContent = `${clip.id}${clip.scene ? ` · ${clip.scene}` : ""}${dur} · clip ${i + 1} of ${state.clips.length}`;
  const video = $("video");
  video.src = `/clips/${encodeURIComponent(clip.id)}`;
  video.playbackRate = video.defaultPlaybackRate;
  $("contact").hidden = true;
  $("contact-toggle").disabled = !clip.hasContactSheet;
  renderClipList();
  renderDraft();
  $("hint").textContent = "";
  if (restored) {
    setSaveState("unsaved", "restored unsaved draft");
    if (isComplete() && labeler()) onEdit();
    else refreshSaveState();
  } else if (label) {
    setSaveState("saved", `loaded saved label (${label.labeler})`);
  } else {
    setSaveState("idle", "new clip");
  }
}

async function saveAndAdvance() {
  if (!state.draft) return;
  if (!isComplete()) {
    const missing = missingAxes();
    for (const id of missing) axisRows.get(id).root.classList.add("missing");
    const parts = [...missing.map((m) => m.replace(/_/g, " "))];
    if (state.draft.pass === null) parts.push("pass/fail");
    $("hint").textContent = `Not saved - still needed: ${parts.join(", ")}`;
    return;
  }
  if (!labeler()) {
    $("hint").textContent = "Enter your name first";
    $("labeler").focus();
    return;
  }
  await save();
  await state.inflight;
  if (state.index < state.clips.length - 1) await loadClip(state.index + 1);
  else $("hint").textContent = "That was the last clip.";
}

function toggleContact() {
  const clip = currentClip();
  if (!clip || !clip.hasContactSheet) return;
  const img = $("contact");
  if (img.hidden) img.src = `/contacts/${encodeURIComponent(clip.id)}`;
  img.hidden = !img.hidden;
}

function setSpeed(speed) {
  const video = $("video");
  video.defaultPlaybackRate = speed;
  video.playbackRate = speed;
  for (const b of $("speed").children) b.classList.toggle("on", Number(b.dataset.speed) === speed);
}

function togglePlay() {
  const video = $("video");
  if (video.paused) void video.play().catch(() => undefined);
  else video.pause();
}

const isTyping = (t) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;

function onKeyDown(e) {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    void saveAndAdvance();
    return;
  }
  if (isTyping(e.target)) {
    if (e.key === "Escape") e.target.blur();
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey || !state.draft) return;
  if (e.key >= "1" && e.key <= "5") setScore(Number(e.key));
  else if (e.key === "n" || e.key === "N") setScore(null);
  else if (e.key === "ArrowDown") moveFocus(1);
  else if (e.key === "ArrowUp") moveFocus(-1);
  else if (e.key === "Tab") moveFocus(e.shiftKey ? -1 : 1);
  else if (e.key === "j") void loadClip(state.index + 1);
  else if (e.key === "k") void loadClip(state.index - 1);
  else if (e.key === " ") togglePlay();
  else if (e.key === "c") toggleContact();
  else if (e.key === "p") {
    state.draft.pass = true;
    onEdit();
  } else if (e.key === "f") {
    state.draft.pass = false;
    onEdit();
  } else return;
  e.preventDefault();
}

function buildStaticUi() {
  const axes = $("axes");
  state.meta.axes.forEach((a, i) => {
    const buttons = new Map();
    const scoreBox = el("div", { className: "scores" });
    for (const v of [1, 2, 3, 4, 5, null]) {
      const btn = el("button", {
        type: "button",
        tabIndex: -1,
        className: v === null ? "na" : "",
        textContent: v === null ? "N/A" : String(v),
        title: v === null ? "does not apply to this clip (n)" : `score ${v}`,
      });
      btn.addEventListener("click", () => {
        state.focus = i;
        setScore(v);
      });
      buttons.set(v, btn);
      scoreBox.append(btn);
    }
    const root = el("div", { className: "axis" }, [
      el("div", { className: "axis-head" }, [el("span", { className: "axis-name", textContent: a.id.replace(/_/g, " ") }), scoreBox]),
      el("div", { className: "axis-q", textContent: a.question }),
    ]);
    root.addEventListener("click", () => {
      state.focus = i;
      renderDraft();
    });
    axisRows.set(a.id, { root, buttons });
    axes.append(root);
  });

  for (const c of state.meta.failureCodes) {
    const box = el("input", { type: "checkbox", tabIndex: -1 });
    box.addEventListener("change", () => toggleCode(c.id, box.checked));
    codeBoxes.set(c.id, box);
    $("code-boxes").append(
      el("label", { title: `${c.id} ${c.slug}: ${c.definition}` }, [box, el("strong", { textContent: c.id }), el("span", { className: "slug", textContent: c.slug.replace(/_/g, " ") })]),
    );
  }
}

async function init() {
  const [meta, clips, statuses] = await Promise.all([api("/api/meta"), api("/api/clips"), api("/api/labels")]);
  state.meta = meta;
  state.clips = clips;
  for (const s of statuses) state.labeled.set(s.id, s.labeled);
  $("labeler").value = meta.labeler || localStorage.getItem(LABELER_KEY) || "";
  buildStaticUi();
  renderProgress();

  $("labeler").addEventListener("input", () => {
    localStorage.setItem(LABELER_KEY, labeler());
    if (state.draft) onEdit();
  });
  $("notes").addEventListener("input", (e) => {
    state.draft.notes = e.target.value;
    onEdit();
  });
  $("extra-add").addEventListener("click", addExtraCode);
  $("extra-code").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !(e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      addExtraCode();
    }
  });
  $("save-next").addEventListener("click", () => void saveAndAdvance());
  $("contact-toggle").addEventListener("click", toggleContact);
  for (const b of $("speed").children) b.addEventListener("click", () => setSpeed(Number(b.dataset.speed)));
  for (const b of $("pass").children)
    b.addEventListener("click", () => {
      state.draft.pass = b.dataset.pass === "true";
      onEdit();
    });
  document.addEventListener("keydown", onKeyDown);
  // A button left focused after a mouse click would swallow the space bar; keep focus on the page.
  document.addEventListener("keyup", (e) => {
    if (e.key === " " && !isTyping(e.target)) e.preventDefault();
  });
  document.addEventListener("click", (e) => {
    const btn = e.target instanceof Element ? e.target.closest("button") : null;
    if (btn) btn.blur();
  });
  window.addEventListener("beforeunload", (e) => {
    if (state.saveTimer !== null) {
      void save();
      e.preventDefault();
    }
  });

  if (clips.length === 0) {
    $("clip-title").textContent = "The manifest has no clips";
    return;
  }
  const firstOpen = clips.findIndex((c) => !state.labeled.get(c.id));
  await loadClip(firstOpen === -1 ? 0 : firstOpen);
}

init().catch((err) => {
  $("clip-title").textContent = `Failed to start: ${err.message}`;
});
