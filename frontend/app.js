// =====================================================================
//  Highlight Creator — frontend logic
// =====================================================================

const $ = (id) => document.getElementById(id);

const els = {
  tournament: $("tournament"),
  player1: $("player1"),
  player2: $("player2"),
  introSeconds: $("introSeconds"),
  pickVideoBtn: $("pickVideoBtn"),
  pickVideoLabel: $("pickVideoLabel"),
  slowSlider: $("slowSlider"),
  slowLabel: $("slowLabel"),
  slowHint: $("slowHint"),

  player: $("player"),
  overlay: $("overlayMsg"),
  playerTime: $("playerTime"),
  playerInfo: $("playerInfo"),

  // Custom controls
  timeline: $("timeline"),
  timelineProgress: $("timelineProgress"),
  timelineBuffered: $("timelineBuffered"),
  timelineThumb: $("timelineThumb"),
  timelineTooltip: $("timelineTooltip"),
  playBtn: $("playBtn"),
  playIcon: $("playIcon"),
  playText: $("playText"),
  speedSelect: $("speedSelect"),
  highlightBtn: $("highlightBtn"),
  highlightText: $("highlightText"),
  captureStatus: $("captureStatus"),

  // Preview-output transport
  previewOutputBtn: $("previewOutputBtn"),
  previewBar: $("previewBar"),
  pvPrev: $("pvPrev"),
  pvPlay: $("pvPlay"),
  pvNext: $("pvNext"),
  pvPhase: $("pvPhase"),
  pvTime: $("pvTime"),
  pvExit: $("pvExit"),

  clipsBody: $("clipsBody"),
  clipCount: $("clipCount"),
  clearClips: $("clearClips"),
  undoClipBtn: $("undoClipBtn"),

  // Text overlays
  textOverlayLayer: $("textOverlayLayer"),
  textPanel: $("textPanel"),
  textTimeline: $("textTimeline"),
  textList: $("textList"),
  textCount: $("textCount"),
  addTextBtn: $("addTextBtn"),

  // Project save/load
  projectName: $("projectName"),
  projectSelect: $("projectSelect"),
  saveProjectBtn: $("saveProjectBtn"),
  loadProjectBtn: $("loadProjectBtn"),
  deleteProjectBtn: $("deleteProjectBtn"),

  renderBtn: $("renderBtn"),
  renderSummary: $("renderSummary"),
  resolutionSelect: $("resolutionSelect"),
  resHint: $("resHint"),
  progressBox: $("progressBox"),
  progressStage: $("progressStage"),
  progressPct: $("progressPct"),
  progressFill: $("progressFill"),
  progressMsg: $("progressMsg"),
  cancelBtn: $("cancelBtn"),

  resultBox: $("resultBox"),
  resultFilename: $("resultFilename"),
  openFolderBtn: $("openFolderBtn"),
  newRenderBtn: $("newRenderBtn"),

  // File browser modal
  browseModal: $("browseModal"),
  browseBackdrop: $("browseBackdrop"),
  browseClose: $("browseClose"),
  browseUp: $("browseUp"),
  browsePath: $("browsePath"),
  browseGo: $("browseGo"),
  browseShortcuts: $("browseShortcuts"),
  browseList: $("browseList"),
  browseStatus: $("browseStatus"),
};

// ---- State ----------------------------------------------------------
let clips = [];          // [{id, start, end, slowmo, video}] — each clip carries its source
let captureStart = null; // number | null
let currentVideo = null; // video currently loaded in the player (source for NEW clips)
let videoFps = 30;
let currentJobId = null;
let currentEventSource = null;
let nextClipId = 1;
let clipUndoStack = []; // snapshots of `clips` taken before destructive edits
let outHeight = 0;        // target output height (px); 0 = native source height
let lastBrowseDir = "";  // last folder opened in the file browser (persisted)
const probeCache = {};   // video path -> probe info {width,height,fps,...}

// Text overlays burned onto the final video. Each: {id,text,font,sizePct,
// color,x,y,start,end,shadow}. x/y are the text CENTRE as a fraction of the
// final canvas; start/end are seconds on the final timeline (incl. intro),
// null = whole video.
let texts = [];
let nextTextId = 1;
let selectedTextId = null;

// Curated font families — keys match backend FONT_FAMILIES. `noStyle` marks
// families without bold/italic variants (Impact) so those toggles disable.
const FONT_OPTIONS = [
  { key: "arial",    label: "Arial",           css: "Arial, sans-serif" },
  { key: "segoe",    label: "Segoe UI",        css: "'Segoe UI', sans-serif" },
  { key: "impact",   label: "Impact",          css: "Impact, sans-serif", noStyle: true },
  { key: "times",    label: "Times New Roman", css: "'Times New Roman', serif" },
  { key: "consolas", label: "Consolas",        css: "Consolas, monospace" },
];
// Map legacy stored keys (pre family+B/I split) -> {key, bold}.
const LEGACY_FONT = { "arial-bold": { key: "arial", bold: true }, "segoe-bold": { key: "segoe", bold: true } };
function fontSpec(key) {
  return FONT_OPTIONS.find(f => f.key === key) || FONT_OPTIONS[0];
}

// Filename (tail) of an absolute path or bare name; used for compact display.
function baseName(p) {
  if (!p) return "";
  const s = String(p).replace(/[\\/]+$/, "");
  const i = Math.max(s.lastIndexOf("\\"), s.lastIndexOf("/"));
  return i >= 0 ? s.slice(i + 1) : s;
}

// Standard output tiers. The export dropdown offers every tier whose height is
// <= the canvas source height (so we never upscale); the top tier doubles as
// "native". A source above 1440p (e.g. 4K) tops out at 2K to keep renders sane.
const RES_TIERS = [
  { h: 720,  label: "720p" },
  { h: 1080, label: "1K · 1080p" },
  { h: 1440, label: "2K · 1440p" },
];

// ---- Persistence ----------------------------------------------------
const STORAGE_KEY = "highlight-creator-state-v1";
const STATE_VERSION = 2; // v2: clips carry a per-clip `video` source
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: STATE_VERSION,
      tournament: els.tournament.value,
      player1: els.player1.value,
      player2: els.player2.value,
      introSeconds: els.introSeconds.value,
      slow: els.slowSlider.value,
      outHeight,
      lastBrowseDir,
      currentVideo,
      clips,
      texts,
    }));
  } catch (e) { /* ignore */ }
}
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s.tournament) els.tournament.value = s.tournament;
    if (s.player1) els.player1.value = s.player1;
    if (s.player2) els.player2.value = s.player2;
    if (s.introSeconds) els.introSeconds.value = s.introSeconds;
    if (s.slow) { els.slowSlider.value = s.slow; updateSlowLabel(); }
    if (typeof s.outHeight === "number") outHeight = s.outHeight;
    if (typeof s.lastBrowseDir === "string") lastBrowseDir = s.lastBrowseDir;
    if (s.currentVideo) currentVideo = s.currentVideo;
    if (Array.isArray(s.clips)) {
      // Migration v1 -> v2: clips had no `video`; they all belonged to the
      // single selected video, so backfill with the saved currentVideo.
      clips = s.clips.map(c => ({
        ...c,
        video: c.video || s.currentVideo || "",
      }));
      nextClipId = Math.max(0, ...clips.map(c => c.id || 0)) + 1;
    }
    if (Array.isArray(s.texts)) {
      texts = s.texts.map(normalizeText);
      nextTextId = Math.max(0, ...texts.map(t => t.id || 0)) + 1;
    }
  } catch (e) { /* ignore */ }
}

// Coerce a stored/loaded overlay into the canonical shape with safe defaults.
function normalizeText(t) {
  t = t || {};
  // Migrate legacy font keys (e.g. "arial-bold") -> family + bold flag.
  let font = t.font, bold = !!t.bold;
  if (LEGACY_FONT[font]) { bold = LEGACY_FONT[font].bold || bold; font = LEGACY_FONT[font].key; }
  font = fontSpec(font).key;
  const noStyle = !!fontSpec(font).noStyle;
  return {
    id: t.id || nextTextId++,
    text: typeof t.text === "string" ? t.text : "",
    font,
    bold: noStyle ? false : bold,
    italic: noStyle ? false : !!t.italic,
    sizePct: clampNum(t.sizePct, 1, 30, 6),
    color: /^#[0-9a-fA-F]{6}$/.test(t.color || "") ? t.color : "#ffcc00",
    x: clampNum(t.x, 0, 1, 0.5),
    y: clampNum(t.y, 0, 1, 0.85),
    start: (typeof t.start === "number" && isFinite(t.start)) ? t.start : null,
    end: (typeof t.end === "number" && isFinite(t.end)) ? t.end : null,
    shadow: t.shadow !== false,
  };
}
function clampNum(v, lo, hi, dflt) {
  const n = parseFloat(v);
  if (!isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}

// ---- Helpers --------------------------------------------------------
function fmt(seconds) {
  if (!isFinite(seconds) || seconds < 0) return "00:00.00";
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

// Duration as minute:second (rounded), e.g. 90.5 -> "1:30", 45 -> "0:45".
function fmtClock(seconds) {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function parseTime(str) {
  // Accept "12.34" or "1:12.34" or "01:12.34"
  if (str === null || str === undefined) return NaN;
  str = String(str).trim();
  if (!str) return NaN;
  if (str.includes(":")) {
    const parts = str.split(":");
    const m = parseFloat(parts[0]) || 0;
    const s = parseFloat(parts[1]) || 0;
    return m * 60 + s;
  }
  return parseFloat(str);
}

// ---- Source video (absolute path anywhere on disk) ------------------
// A source is identified by its absolute path. Legacy clips/projects may carry
// a bare filename; the server resolves those under workspace/raw. Both flow
// through the same path-based endpoints, so no client-side migration is needed.

// Probe a video's metadata, caching by path so repeated lookups (resolution
// menu, summary) don't re-hit the server.
async function probeVideo(path) {
  if (!path) return null;
  if (probeCache[path]) return probeCache[path];
  try {
    const res = await fetch(`/api/source-probe?path=${encodeURIComponent(path)}`);
    if (!res.ok) return null;
    const info = await res.json();
    probeCache[path] = info;
    return info;
  } catch (e) {
    return null;
  }
}

// Update the picker button to show the current source filename (full path on hover).
function updatePickLabel() {
  if (!els.pickVideoLabel) return;
  els.pickVideoLabel.textContent = currentVideo ? baseName(currentVideo) : "Choose source video…";
  els.pickVideoBtn.title = currentVideo || "Pick a video from any drive/folder";
}

async function selectVideo(path) {
  if (!path) {
    currentVideo = null;
    els.player.removeAttribute("src");
    els.player.load();
    els.overlay.classList.remove("hidden");
    els.playerInfo.textContent = "No video selected";
    updatePickLabel();
    refreshResolutionOptions();
    renderTextOverlays();
    return;
  }
  currentVideo = path;
  els.player.src = `/api/source-stream?path=${encodeURIComponent(path)}`;
  els.player.playbackRate = parseFloat(els.speedSelect.value) || 1;
  els.player.load();
  els.overlay.classList.add("hidden");
  updatePickLabel();
  renderTextOverlays();
  // Probe for fps / resolution
  const info = await probeVideo(path);
  if (info) {
    videoFps = info.fps || 30;
    els.playerInfo.textContent = `${baseName(path)} · ${info.width}×${info.height} @ ${videoFps} fps`;
  } else {
    els.playerInfo.textContent = baseName(path);
  }
  refreshResolutionOptions();
  saveState();
}

// Directory portion of an absolute path (everything before the last separator).
function dirName(p) {
  if (!p) return "";
  const s = String(p).replace(/[\\/]+$/, "");
  const i = Math.max(s.lastIndexOf("\\"), s.lastIndexOf("/"));
  return i >= 0 ? s.slice(0, i) : "";
}

// ---- Source picker --------------------------------------------------
// Primary: ask the server to open the native OS "Open file" dialog (real
// Windows Explorer). Fall back to the in-app browser modal if unavailable.
async function openBrowse() {
  const initDir = (currentVideo && /[\\/]/.test(currentVideo))
    ? dirName(currentVideo)
    : (lastBrowseDir || "");
  const prevLabel = els.pickVideoLabel.textContent;
  els.pickVideoBtn.disabled = true;
  els.pickVideoLabel.textContent = "Opening file dialog…";
  try {
    const res = await fetch("/api/pick-file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initial_dir: initDir }),
    });
    if (!res.ok) throw new Error("native dialog unavailable");
    const data = await res.json();
    if (data.path) {
      lastBrowseDir = dirName(data.path);
      selectVideo(data.path);   // empty path => user cancelled, keep current
    }
  } catch (e) {
    openBrowseModal();          // graceful fallback to the in-app browser
  } finally {
    els.pickVideoBtn.disabled = false;
    els.pickVideoLabel.textContent = currentVideo ? baseName(currentVideo) : prevLabel;
  }
}

// ---- In-app file browser modal (fallback) --------------------------
function openBrowseModal() {
  els.browseModal.classList.remove("hidden");
  els.browseModal.setAttribute("aria-hidden", "false");
  // Open at: current video's folder > last browsed dir > drive root.
  // Only use currentVideo if it's an absolute path (legacy bare names aren't).
  const isAbs = currentVideo && /[\\/]/.test(currentVideo);
  const start = (isAbs ? currentVideo : "") || lastBrowseDir || "";
  loadBrowse(start);
}

function closeBrowse() {
  els.browseModal.classList.add("hidden");
  els.browseModal.setAttribute("aria-hidden", "true");
}

async function loadBrowse(path) {
  els.browseStatus.textContent = "Loading…";
  els.browseList.innerHTML = "";
  try {
    const res = await fetch(`/api/browse?path=${encodeURIComponent(path || "")}`);
    if (!res.ok) {
      const t = await res.text();
      throw new Error(t || `HTTP ${res.status}`);
    }
    const data = await res.json();
    renderBrowse(data);
  } catch (e) {
    els.browseStatus.textContent = "";
    els.browseList.innerHTML = `<div class="browse-empty">Cannot open folder:<br>${(e.message || e).toString().slice(0, 200)}</div>`;
  }
}

function renderBrowse(data) {
  els.browsePath.value = data.path || "";
  els.browseStatus.textContent = data.path || "Drives / root";
  // Remember the folder (not a drive-root listing) for next time.
  if (data.path) { lastBrowseDir = data.path; saveState(); }

  // Shortcuts (chips)
  els.browseShortcuts.innerHTML = "";
  for (const sc of (data.shortcuts || [])) {
    const chip = document.createElement("span");
    chip.className = "browse-chip";
    chip.textContent = sc.name;
    chip.title = sc.path;
    chip.addEventListener("click", () => loadBrowse(sc.path));
    els.browseShortcuts.appendChild(chip);
  }

  // Up button -> parent ("" means jump to drive/root list)
  els.browseUp.disabled = data.parent === null;
  els.browseUp.onclick = data.parent === null ? null : () => loadBrowse(data.parent);

  // Entries
  els.browseList.innerHTML = "";
  const entries = data.entries || [];
  if (!entries.length) {
    els.browseList.innerHTML = `<div class="browse-empty">Empty folder (no videos or subfolders).</div>`;
    return;
  }
  for (const e of entries) {
    const row = document.createElement("div");
    row.className = "browse-row" + (e.is_dir ? "" : " is-file");
    const size = e.is_dir ? "" : `<span class="b-size">${e.size_mb} MB</span>`;
    row.innerHTML = `
      <span class="b-icon">${e.is_dir ? "📁" : "🎬"}</span>
      <span class="b-name" title="${e.path.replace(/"/g, "&quot;")}">${e.name}</span>
      ${size}`;
    row.addEventListener("click", () => {
      if (e.is_dir) loadBrowse(e.path);
      else pickVideo(e.path);
    });
    els.browseList.appendChild(row);
  }
}

function pickVideo(path) {
  closeBrowse();
  selectVideo(path);
}

// The canvas source = first clip's video (run_job uses clip[0] for the canvas),
// or the currently loaded video when no clips exist yet.
function canvasSourceVideo() {
  return (clips[0] && clips[0].video) || currentVideo || "";
}

// Short label for a target height, used in the render summary.
function resShortLabel(h) {
  if (!h) return "source";
  if (h <= 720) return "720p";
  if (h <= 1080) return "1K";
  return "2K";
}

// Rebuild the resolution dropdown from the canvas source's height. Offers every
// standard tier <= source height; the selection caps output resolution and is
// clamped server-side so it never upscales.
async function refreshResolutionOptions() {
  const sel = els.resolutionSelect;
  if (!sel) return;
  const src = canvasSourceVideo();
  if (!src) {
    sel.innerHTML = `<option value="0">Auto — pick a source video</option>`;
    sel.value = "0";
    sel.disabled = true;
    return;
  }
  const info = await probeVideo(src);
  // Source may have changed while awaiting the probe.
  if (canvasSourceVideo() !== src) return;
  const srcH = (info && info.height) ? info.height : 0;
  const avail = RES_TIERS.filter(t => t.h <= srcH + 1);

  sel.innerHTML = "";
  if (!avail.length) {
    // Source smaller than 720p: single native option, no downscale possible.
    const o = document.createElement("option");
    o.value = "0";
    o.textContent = srcH ? `Auto · source ${srcH}p` : "Auto · source";
    sel.appendChild(o);
    sel.value = "0";
    sel.disabled = true;
    outHeight = 0;
    saveState();
    refreshRenderSummary();
    return;
  }

  sel.disabled = avail.length === 1;
  for (const t of avail) {
    const o = document.createElement("option");
    o.value = String(t.h);
    o.textContent = t.h >= srcH ? `${t.label} · source` : t.label;
    sel.appendChild(o);
  }
  // Keep the previous choice if still valid; otherwise default to the highest
  // available tier (native / best quality) — preserves prior full-res behaviour.
  const heights = avail.map(t => t.h);
  outHeight = (outHeight && heights.includes(outHeight))
    ? outHeight
    : heights[heights.length - 1];
  sel.value = String(outHeight);
  saveState();
  refreshRenderSummary();
}

// ---- Player ---------------------------------------------------------
function updatePlayerTime() {
  const c = els.player.currentTime || 0;
  const d = els.player.duration || 0;
  els.playerTime.textContent = `${fmt(c)} / ${fmt(d)}`;

  // Timeline progress + thumb
  const pct = d > 0 ? (c / d) * 100 : 0;
  els.timelineProgress.style.width = `${pct}%`;
  els.timelineThumb.style.left = `${pct}%`;
}

function updateBuffered() {
  const d = els.player.duration || 0;
  if (d <= 0) return;
  let end = 0;
  try {
    if (els.player.buffered.length) {
      end = els.player.buffered.end(els.player.buffered.length - 1);
    }
  } catch (e) { /* ignore */ }
  els.timelineBuffered.style.width = `${Math.min(100, (end / d) * 100)}%`;
}

function updatePlayBtn() {
  if (els.player.paused) {
    els.playIcon.textContent = "▶";
    els.playText.textContent = "Play";
  } else {
    els.playIcon.textContent = "❚❚";
    els.playText.textContent = "Pause";
  }
}

els.player.addEventListener("timeupdate", updatePlayerTime);
els.player.addEventListener("loadedmetadata", () => {
  updatePlayerTime();
  updateBuffered();
});
els.player.addEventListener("durationchange", () => {
  updatePlayerTime();
});
els.player.addEventListener("progress", updateBuffered);
els.player.addEventListener("play",  () => { updatePlayBtn(); pvSyncPlayBtn(); syncTextOverlayTiming(); });
els.player.addEventListener("pause", () => { updatePlayBtn(); pvSyncPlayBtn(); syncTextOverlayTiming(); });
els.player.addEventListener("ended", () => { updatePlayBtn(); pvSyncPlayBtn(); syncTextOverlayTiming(); });

// ---- Custom control bar ---------------------------------------------
els.playBtn.addEventListener("click", () => {
  if (!els.player.src) return;
  if (els.player.paused) els.player.play(); else els.player.pause();
});

document.querySelectorAll(".ctrl-btn[data-skip]").forEach(btn => {
  btn.addEventListener("click", () => {
    if (!els.player.src) return;
    const delta = parseFloat(btn.dataset.skip);
    const target = (els.player.currentTime || 0) + delta;
    els.player.currentTime = Math.max(0, Math.min((els.player.duration || 1e9), target));
  });
});

els.speedSelect.addEventListener("change", () => {
  els.player.playbackRate = parseFloat(els.speedSelect.value) || 1;
});

// ---- Timeline scrubbing --------------------------------------------
let scrubbing = false;

function timelineSeekFromEvent(e) {
  const d = els.player.duration || 0;
  if (!d) return;
  const rect = els.timeline.getBoundingClientRect();
  const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
  const pct = Math.max(0, Math.min(1, x / rect.width));
  els.player.currentTime = pct * d;
}

function timelineHoverFromEvent(e) {
  const d = els.player.duration || 0;
  if (!d) { els.timelineTooltip.style.opacity = "0"; return; }
  const rect = els.timeline.getBoundingClientRect();
  const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
  const pct = Math.max(0, Math.min(1, x / rect.width));
  els.timelineTooltip.textContent = fmt(pct * d);
  els.timelineTooltip.style.left = `${pct * 100}%`;
}

els.timeline.addEventListener("mousedown", (e) => {
  if (!els.player.src) return;
  scrubbing = true;
  timelineSeekFromEvent(e);
});
els.timeline.addEventListener("mousemove", (e) => {
  timelineHoverFromEvent(e);
  if (scrubbing) timelineSeekFromEvent(e);
});
window.addEventListener("mouseup", () => { scrubbing = false; });
window.addEventListener("mousemove", (e) => {
  if (scrubbing) timelineSeekFromEvent(e);
});

// ---- Slow slider ----------------------------------------------------
function updateSlowLabel() {
  const v = parseInt(els.slowSlider.value, 10);
  els.slowLabel.textContent = `${v}%`;
  const factor = 100 / v;
  els.slowHint.textContent = `Plays at ${v}% of real speed (${factor.toFixed(2)}× slower)`;
  saveState();
  refreshRenderSummary();
}

// ---- Capture (single toggle button) ---------------------------------
function setCaptureState(active, t = null) {
  if (active) {
    captureStart = t;
    els.highlightBtn.classList.add("recording");
    els.highlightText.textContent = `End highlight @ ${fmt(t)}`;
    els.captureStatus.textContent = `● Capturing — start @ ${fmt(t)}`;
  } else {
    captureStart = null;
    els.highlightBtn.classList.remove("recording");
    els.highlightText.textContent = "Highlight start/end";
    els.captureStatus.textContent = "";
  }
}

function markIn() {
  if (!currentVideo) { flashMsg("Pick a source video first"); return; }
  setCaptureState(true, els.player.currentTime || 0);
}

function markOut() {
  if (captureStart === null) return;
  const end = els.player.currentTime || 0;
  if (end <= captureStart + 0.05) {
    flashMsg("End time must be after start time");
    return;
  }
  addClip(captureStart, end);
  setCaptureState(false);
}

function toggleHighlight() {
  if (captureStart === null) markIn();
  else markOut();
}

function flashMsg(msg) {
  els.captureStatus.textContent = msg;
  setTimeout(() => {
    if (captureStart === null) els.captureStatus.textContent = "";
  }, 1800);
}

// ---- Clips list -----------------------------------------------------
// ---- Undo (restore accidentally deleted / changed events) -----------
// Snapshot `clips` before each structural change so the Undo button (and
// Ctrl+Z) can step back one action at a time.
function pushClipUndo() {
  // Any structural edit invalidates the live preview plan — leave preview mode.
  if (pvMode) pvExit();
  clipUndoStack.push(JSON.parse(JSON.stringify(clips)));
  if (clipUndoStack.length > 50) clipUndoStack.shift();
  updateUndoBtn();
}
function updateUndoBtn() {
  if (els.undoClipBtn) els.undoClipBtn.disabled = clipUndoStack.length === 0;
}
function undoClips() {
  if (!clipUndoStack.length) return;
  clips = clipUndoStack.pop();
  renderClipsTable();
  refreshResolutionOptions();
  saveState();
  updateUndoBtn();
  flashMsg("Undone");
}

function addClip(start, end) {
  if (!currentVideo) { flashTopMessage("Pick a source video before marking an event"); return; }
  pushClipUndo();
  // New highlight events default to no slow-motion (SLO unchecked).
  clips.push({ id: nextClipId++, start, end, slowmo: false, video: currentVideo });
  renderClipsTable();
  refreshResolutionOptions();
  saveState();
}

// Ordered list of distinct source videos used by the clips (first-appearance
// order). Used to label each clip with a short V1/V2/... badge.
function sourceList() {
  const seen = [];
  for (const c of clips) {
    const v = c.video || "";
    if (v && !seen.includes(v)) seen.push(v);
  }
  return seen;
}
function sourceBadge(video) {
  const i = sourceList().indexOf(video);
  return i >= 0 ? `V${i + 1}` : "—";
}

function removeClip(id) {
  pushClipUndo();
  clips = clips.filter(c => c.id !== id);
  renderClipsTable();
  refreshResolutionOptions();
  saveState();
}

function moveClip(id, dir) {
  const i = clips.findIndex(c => c.id === id);
  if (i < 0) return;
  const j = i + dir;
  if (j < 0 || j >= clips.length) return;
  pushClipUndo();
  [clips[i], clips[j]] = [clips[j], clips[i]];
  renderClipsTable();
  refreshResolutionOptions();  // reorder may change clip[0] = the canvas source
  saveState();
}

// Move `draggedId` to sit just before/after `targetId` (used by drag & drop).
// Same effect as repeated moveClip but in one gesture — handy for 30-50 events.
function reorderClips(draggedId, targetId, before) {
  if (draggedId === targetId) return;
  const fromIdx = clips.findIndex(c => c.id === draggedId);
  const targetIdx = clips.findIndex(c => c.id === targetId);
  if (fromIdx < 0 || targetIdx < 0) return;
  pushClipUndo();
  const [moved] = clips.splice(fromIdx, 1);
  // Recompute the target index after removing the dragged item, then insert.
  let insertIdx = clips.findIndex(c => c.id === targetId);
  if (!before) insertIdx += 1;
  clips.splice(insertIdx, 0, moved);
  renderClipsTable();
  refreshResolutionOptions();  // reorder may change clip[0] = the canvas source
  saveState();
}

function renderClipsTable() {
  els.clipCount.textContent = clips.length;
  if (!clips.length) {
    els.clipsBody.innerHTML = `<tr class="empty"><td colspan="7">No events yet. Click <b>Highlight start/end</b> to mark one.</td></tr>`;
    refreshRenderSummary();
    return;
  }
  els.clipsBody.innerHTML = "";
  clips.forEach((c, idx) => {
    const tr = document.createElement("tr");
    tr.dataset.id = c.id;
    const checked = c.slowmo === false ? "" : "checked";
    const srcVideo = c.video || "";
    tr.innerHTML = `
      <td class="cell-check">
        <input type="checkbox" data-id="${c.id}" data-field="slowmo" ${checked}
               title="Slow-motion for this event (uncheck = real-speed only)" />
      </td>
      <td class="cell-num"><span class="drag-grip" title="Drag to reorder">⠿</span><span class="num">${idx + 1}</span></td>
      <td class="src"><span class="src-badge" title="${srcVideo.replace(/"/g, "&quot;")}">${sourceBadge(srcVideo)}</span></td>
      <td><input class="t-input" data-id="${c.id}" data-field="start" value="${fmt(c.start)}" /></td>
      <td><input class="t-input" data-id="${c.id}" data-field="end" value="${fmt(c.end)}" /></td>
      <td class="dur">${(c.end - c.start).toFixed(1)}s</td>
      <td class="actions">
        <button data-act="preview" data-id="${c.id}" title="Preview event">▶</button>
        <button data-act="up" data-id="${c.id}" title="Move up">↑</button>
        <button data-act="down" data-id="${c.id}" title="Move down">↓</button>
        <button data-act="del" data-id="${c.id}" class="del" title="Delete">✕</button>
        <span class="actions-sep"></span>
        <button data-act="export" data-id="${c.id}" class="btn-exp real"
                title="Export this event (separate file, real-speed only)">Export</button>
        <button data-act="exportSlow" data-id="${c.id}" class="btn-exp slow"
                title="Export real-speed + slow-motion replay (SLOW MOTION badge, top-right)">Export + Replay</button>
      </td>
    `;
    els.clipsBody.appendChild(tr);
  });
  refreshRenderSummary();
}

els.clipsBody.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const id = parseInt(btn.dataset.id, 10);
  const clip = clips.find(c => c.id === id);
  if (!clip) return;
  switch (btn.dataset.act) {
    case "del":         removeClip(id); break;
    case "up":          moveClip(id, -1); break;
    case "down":        moveClip(id, +1); break;
    case "preview":     previewClip(clip); break;
    case "export":      exportSingleClip(clip, false); break;
    case "exportSlow":  exportSingleClip(clip, true); break;
  }
});

els.clipsBody.addEventListener("change", (e) => {
  const cb = e.target.closest('input[type="checkbox"][data-field="slowmo"]');
  if (cb) {
    const id = parseInt(cb.dataset.id, 10);
    const clip = clips.find(c => c.id === id);
    if (clip) {
      clip.slowmo = cb.checked;
      saveState();
      refreshRenderSummary();
    }
    return;
  }
  const input = e.target.closest("input.t-input");
  if (!input) return;
  const id = parseInt(input.dataset.id, 10);
  const field = input.dataset.field;
  const clip = clips.find(c => c.id === id);
  if (!clip) return;
  const v = parseTime(input.value);
  if (!isFinite(v)) {
    input.value = fmt(clip[field]);
    return;
  }
  if (v === clip[field]) return;  // no change -> no undo entry
  pushClipUndo();
  clip[field] = v;
  if (clip.end <= clip.start) clip.end = clip.start + 0.5;
  renderClipsTable();
  saveState();
});

// ---- Drag & drop reordering -----------------------------------------
// Rows reorder by dragging the ⠿ grip in the # column. The row is only made
// draggable while the grip is held, so the inline time inputs/checkboxes stay
// fully clickable. Wired via delegation on the tbody so it survives the full
// re-render that renderClipsTable() does after every change.
let dragId = null;

function clearDropMarkers() {
  els.clipsBody.querySelectorAll(".drop-before, .drop-after")
    .forEach(tr => tr.classList.remove("drop-before", "drop-after"));
}

// Where would a drop on `tr` land — before it (cursor in top half) or after?
function dropBefore(tr, clientY) {
  const r = tr.getBoundingClientRect();
  return (clientY - r.top) < r.height / 2;
}

els.clipsBody.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  const tr = e.target.closest("tr[data-id]");
  if (tr && e.target.closest(".drag-grip")) tr.draggable = true;
});

// A grip click that doesn't turn into a drag must clear the draggable flag,
// otherwise the row would swallow text selection in its inputs afterwards.
els.clipsBody.addEventListener("mouseup", (e) => {
  if (dragId !== null) return;
  const tr = e.target.closest("tr[data-id]");
  if (tr) tr.draggable = false;
});

els.clipsBody.addEventListener("dragstart", (e) => {
  const tr = e.target.closest("tr[data-id]");
  if (!tr) return;
  dragId = parseInt(tr.dataset.id, 10);
  tr.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  try { e.dataTransfer.setData("text/plain", String(dragId)); } catch (_) { /* Firefox needs data set */ }
});

els.clipsBody.addEventListener("dragover", (e) => {
  if (dragId === null) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  const tr = e.target.closest("tr[data-id]");
  clearDropMarkers();
  if (tr && parseInt(tr.dataset.id, 10) !== dragId) {
    tr.classList.add(dropBefore(tr, e.clientY) ? "drop-before" : "drop-after");
  }
});

els.clipsBody.addEventListener("drop", (e) => {
  if (dragId === null) return;
  e.preventDefault();
  const tr = e.target.closest("tr[data-id]");
  if (tr) {
    const targetId = parseInt(tr.dataset.id, 10);
    reorderClips(dragId, targetId, dropBefore(tr, e.clientY));
  }
  clearDropMarkers();
  dragId = null;
});

els.clipsBody.addEventListener("dragend", () => {
  dragId = null;
  clearDropMarkers();
  els.clipsBody.querySelectorAll("tr[data-id]").forEach(tr => {
    tr.classList.remove("dragging");
    tr.draggable = false;
  });
});

let previewWatchdog = null;
let _singleClipWatcher = null;
function clearSingleClipPreview() {
  if (previewWatchdog) { clearTimeout(previewWatchdog); previewWatchdog = null; }
  if (_singleClipWatcher) {
    els.player.removeEventListener("timeupdate", _singleClipWatcher);
    _singleClipWatcher = null;
  }
}
function previewClip(clip) {
  if (pvMode) pvExit();        // single-clip preview takes over from output preview
  clearSingleClipPreview();
  // If this clip belongs to a different source than the one loaded, switch the
  // player to that source first, then seek once the new media is ready.
  if (clip.video && clip.video !== currentVideo) {
    const onReady = () => {
      els.player.removeEventListener("loadeddata", onReady);
      _playClipRange(clip);
    };
    els.player.addEventListener("loadeddata", onReady);
    selectVideo(clip.video);
    return;
  }
  _playClipRange(clip);
}
function _playClipRange(clip) {
  els.player.currentTime = clip.start;
  els.player.play();
  const stopAt = clip.end;
  const watcher = () => {
    if ((els.player.currentTime || 0) >= stopAt) {
      els.player.pause();
      clearSingleClipPreview();
    }
  };
  _singleClipWatcher = watcher;
  els.player.addEventListener("timeupdate", watcher);
  previewWatchdog = setTimeout(() => {
    els.player.pause();
    clearSingleClipPreview();
  }, (clip.end - clip.start) * 1000 + 1500);
}

// ---- Preview output (play the assembled highlight in render order) --
// The render output is intro + for each event: a real-speed segment and,
// when slow-mo is on, a slow-motion replay of the same range. Preview plays
// that exact sequence in the existing <video>: it switches the player to each
// event's source (multi-source aware), seeks to the event's range, sets the
// playback rate (1× for real, slow_percent/100 for the replay), and advances
// to the next segment when the current one ends — so the operator watches only
// the kept footage, in order, with the dead-time between events skipped.
//
// This is a pure playback aid: it reads `clips`/slow/intro but never mutates
// them or the saved-project payload, so projects stay consistent.
let pvMode = false;
let pvPlan = [];      // [{clipIdx, kind:'real'|'slow', video, start, end, srcDur, rate, outDur, outStart}]
let pvPos = 0;        // index of the segment currently playing
let pvTotal = 0;      // total output duration of the previewed segments (excl. intro)
let pvWatcher = null; // timeupdate handler for the active segment
let pvWatchdog = null;
let pvSwitching = false; // true while awaiting a source switch (loadeddata)

// Build the segment plan from the current clips + slow setting. Mirrors what
// run_job renders: real segment per event, plus a slow replay when slowmo is on.
function buildPvPlan() {
  const v = parseInt(els.slowSlider.value, 10) || 100;
  const factor = 100 / v;          // e.g. 50% -> 2× longer in the output
  const rate = v / 100;            // playback speed of the replay (e.g. 0.5)
  const plan = [];
  let acc = 0;
  clips.forEach((c, idx) => {
    const srcDur = Math.max(0, c.end - c.start);
    plan.push({ clipIdx: idx, kind: "real", video: c.video, start: c.start, end: c.end,
                srcDur, rate: 1, outDur: srcDur, outStart: acc });
    acc += srcDur;
    if (c.slowmo !== false) {
      plan.push({ clipIdx: idx, kind: "slow", video: c.video, start: c.start, end: c.end,
                  srcDur, rate, outDur: srcDur * factor, outStart: acc });
      acc += srcDur * factor;
    }
  });
  pvTotal = acc;
  return plan;
}

function pvClearWatch() {
  if (pvWatcher) { els.player.removeEventListener("timeupdate", pvWatcher); pvWatcher = null; }
  if (pvWatchdog) { clearTimeout(pvWatchdog); pvWatchdog = null; }
}

function pvEnter() {
  if (!clips.length) { flashTopMessage("Add highlight events to preview"); return; }
  if (!clips.every(c => c.video)) { flashTopMessage("Some events have no source video"); return; }
  clearSingleClipPreview();
  pvPlan = buildPvPlan();
  pvMode = true;
  els.previewBar.classList.remove("hidden");
  els.textPanel.classList.remove("hidden");   // text editor lives in the preview context
  els.previewOutputBtn.classList.add("active");
  els.previewOutputBtn.textContent = "■ Stop preview";
  renderTextList();                            // (re)draw editor + overlays now visible
  const intro = parseFloat(els.introSeconds.value || "0");
  flashTopMessage(`Preview output — ${pvPlan.length} segment(s)${intro ? `, intro ${intro}s not shown` : ""}`);
  pvStartSegment(0, true);
}

function pvExit() {
  if (!pvMode) return;
  pvMode = false;
  pvSwitching = false;
  pvClearWatch();
  els.player.pause();
  els.player.playbackRate = parseFloat(els.speedSelect.value) || 1;
  els.previewBar.classList.add("hidden");
  els.textPanel.classList.add("hidden");
  els.previewOutputBtn.classList.remove("active");
  els.previewOutputBtn.textContent = "▶ Preview output";
  renderTextOverlays();   // pvMode now false -> clears the overlay layer
}

function pvStartSegment(i, autoplay, startAt) {
  if (i < 0 || i >= pvPlan.length) { pvFinish(); return; }
  pvPos = i;
  pvClearWatch();
  const seg = pvPlan[i];
  const at = (typeof startAt === "number") ? startAt : seg.start;
  const begin = () => {
    pvSwitching = false;
    els.player.currentTime = at;
    els.player.playbackRate = seg.rate;
    if (autoplay) els.player.play().catch(() => {});
    pvAttachWatch(seg);
    pvUpdateBar();
  };
  if (seg.video && seg.video !== currentVideo) {
    pvSwitching = true;
    const onReady = () => {
      els.player.removeEventListener("loadeddata", onReady);
      if (pvMode) begin();
    };
    els.player.addEventListener("loadeddata", onReady);
    selectVideo(seg.video);
  } else {
    begin();
  }
  pvUpdateBar();
}

function pvAttachWatch(seg) {
  const watcher = () => {
    if ((els.player.currentTime || 0) >= seg.end - 0.03) {
      pvAdvance();
    } else {
      pvUpdateBar();
    }
  };
  pvWatcher = watcher;
  els.player.addEventListener("timeupdate", watcher);
  // Wall-clock fallback: a real segment plays in srcDur seconds, a slow one in
  // srcDur/rate = outDur seconds. Add slack for buffering/source switching.
  pvWatchdog = setTimeout(pvAdvance, seg.outDur * 1000 + 2000);
}

function pvAdvance() {
  if (!pvMode) return;
  pvClearWatch();
  if (pvPos + 1 >= pvPlan.length) { pvFinish(); return; }
  pvStartSegment(pvPos + 1, true);
}

function pvFinish() {
  pvClearWatch();
  els.player.pause();
  pvSyncPlayBtn();
  flashTopMessage("Preview finished");
}

function pvPrev() { if (pvMode) pvStartSegment(Math.max(0, pvPos - 1), true); }
function pvNext() { if (pvMode && pvPos + 1 < pvPlan.length) pvStartSegment(pvPos + 1, true); }

// Current position on the output timeline (seconds, excludes intro).
function pvOutputPos() {
  const seg = pvPlan[pvPos];
  if (!seg) return 0;
  const ct = els.player.currentTime || 0;
  const within = Math.max(0, Math.min(seg.srcDur, ct - seg.start)) * (seg.outDur / (seg.srcDur || 1));
  return seg.outStart + within;
}

// Index of the segment that contains output time T.
function pvSegAt(T) {
  for (let i = 0; i < pvPlan.length; i++) {
    if (T < pvPlan[i].outStart + pvPlan[i].outDur) return i;
  }
  return pvPlan.length - 1;
}

// Seek to an absolute OUTPUT-timeline position T (seconds, intro excluded).
// Crosses segments/sources and skips dead-time. Stays inside [0, pvTotal].
function pvSeekToOutput(T) {
  if (!pvMode || !pvPlan.length) return;
  T = Math.max(0, Math.min(pvTotal, T));
  const j = pvSegAt(T);
  const seg = pvPlan[j];
  const withinOut = T - seg.outStart;
  const srcTime = seg.start + withinOut * (seg.srcDur / (seg.outDur || 1));
  const wasPlaying = !els.player.paused;
  if (j === pvPos && seg.video === currentVideo) {
    els.player.currentTime = srcTime;
    pvUpdateBar();
  } else {
    pvStartSegment(j, wasPlaying, srcTime);
  }
}
function pvSeekOutput(delta) { pvSeekToOutput(pvOutputPos() + delta); }

function pvUpdateBar() {
  if (!pvMode || !pvPlan.length) return;
  const seg = pvPlan[pvPos];
  els.pvPhase.textContent =
    `Event ${seg.clipIdx + 1}/${clips.length} · ${seg.kind === "slow" ? "Slow-mo" : "Real"}`;
  const ct = els.player.currentTime || 0;
  const within = Math.max(0, Math.min(seg.srcDur, ct - seg.start)) * (seg.outDur / (seg.srcDur || 1));
  els.pvTime.textContent = `${fmt(seg.outStart + within)} / ${fmt(pvTotal)}`;
  els.pvPrev.disabled = pvPos === 0;
  els.pvNext.disabled = pvPos + 1 >= pvPlan.length;
  syncTextOverlayTiming();
}

function pvSyncPlayBtn() {
  els.pvPlay.textContent = els.player.paused ? "▶" : "❚❚";
}

// ---- Text overlays --------------------------------------------------
// Editor list (CRUD) + a live, draggable WYSIWYG layer over the player.
// Pure render-time aid: stored in state/project, sent to /api/render, never
// touches the clip data. Positions are fractions of the player box (= the
// final 16:9 canvas for the common case).

function renderTextList() {
  const n = texts.length;
  els.textCount.textContent = n;
  if (!n) {
    els.textList.innerHTML = `<div class="text-empty">No text yet. Click <b>＋ Add text</b> to overlay a label on the final video.</div>`;
    renderTextOverlays();
    refreshRenderSummary();
    return;
  }
  const fontOpts = (sel) => FONT_OPTIONS
    .map(f => `<option value="${f.key}" ${f.key === sel ? "selected" : ""}>${f.label}</option>`)
    .join("");
  els.textList.innerHTML = "";
  texts.forEach((t) => {
    const noStyle = !!fontSpec(t.font).noStyle;
    const dis = noStyle ? "disabled" : "";
    const row = document.createElement("div");
    row.className = "text-row" + (t.id === selectedTextId ? " selected" : "");
    row.dataset.id = t.id;
    row.innerHTML = `
      <input class="tx-content" data-field="text" type="text" placeholder="Text…" value="${escapeAttr(t.text)}" />
      <select class="tx-font" data-field="font" title="Font">${fontOpts(t.font)}</select>
      <button class="tx-style ${t.bold ? "active" : ""}" data-act="bold" ${dis} title="Bold">B</button>
      <button class="tx-style ${t.italic ? "active" : ""}" data-act="italic" ${dis} title="Italic">I</button>
      <label class="tx-field">Size
        <input class="tx-size" data-field="sizePct" type="number" min="1" max="30" step="0.5" value="${t.sizePct}" title="Font size (% of frame height)" />
      </label>
      <input class="tx-color" data-field="color" type="color" value="${t.color}" title="Text color" />
      <span class="tx-window" title="Time window — set it on the timeline above">${windowLabel(t)}</span>
      <span class="tx-spacer"></span>
      <button class="tx-locate" data-act="locate" title="Find on timeline / player">⌖</button>
      <button class="tx-del" data-act="del" title="Delete">✕</button>
    `;
    els.textList.appendChild(row);
  });
  renderTextOverlays();
  renderTextTimeline();
  refreshRenderSummary();
}

// Compact "0:03 – 0:08" / "whole video" label for a text's time window.
function windowLabel(t) {
  if (t.start == null && t.end == null) return "∞ whole video";
  return `${t.start != null ? fmt(t.start) : "start"} – ${t.end != null ? fmt(t.end) : "end"}`;
}

function escapeAttr(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// (Re)build the draggable labels over the player. Font size is px relative to
// the player box height so it matches what the % size will render to.
function renderTextOverlays() {
  const layer = els.textOverlayLayer;
  if (!layer) return;
  layer.innerHTML = "";
  // Overlays live only in the Preview-output context (text editor is open then).
  if (!pvMode || !els.player.src) return;
  const boxH = layer.clientHeight || 1;
  texts.forEach((t) => {
    if (!(t.text || "").trim()) return;
    const fs = fontSpec(t.font);
    const el = document.createElement("div");
    el.className = "tx-overlay" + (t.id === selectedTextId ? " selected" : "");
    el.dataset.id = t.id;
    el.textContent = t.text;
    el.style.left = `${t.x * 100}%`;
    el.style.top = `${t.y * 100}%`;
    el.style.fontFamily = fs.css;
    el.style.fontWeight = t.bold ? 700 : 400;
    el.style.fontStyle = t.italic ? "italic" : "normal";
    el.style.color = t.color;
    el.style.fontSize = `${(t.sizePct / 100) * boxH}px`;
    el.style.textShadow = t.shadow
      ? "0 0 2px #000, 1px 1px 2px #000, -1px -1px 2px #000" : "none";
    layer.appendChild(el);
  });
  syncTextOverlayTiming();
}

// While the preview is PLAYING, show only overlays whose time window covers the
// current OUTPUT position (verify timing). While PAUSED (or not in preview),
// show them all so any label can be dragged/positioned. Times are output-
// relative (same scale as the timeline + pv-time readout); the backend adds
// the intro offset at render. Also moves the timeline playhead.
function syncTextOverlayTiming() {
  let pos = null;
  if (pvMode && pvPlan.length && !els.player.paused) {
    pos = pvOutputPos();
  }
  els.textOverlayLayer.querySelectorAll(".tx-overlay").forEach((node) => {
    const t = texts.find(x => String(x.id) === node.dataset.id);
    if (!t) return;
    let visible = true;
    if (pos !== null) {
      const s = t.start != null ? t.start : 0;
      const e = t.end != null ? t.end : Infinity;
      visible = pos >= s && pos <= e;
    }
    node.style.display = visible ? "" : "none";
  });
  updateTimelinePlayhead();
}

// Move the timeline playhead to the current output position.
function updateTimelinePlayhead() {
  const ph = els.textTimeline.querySelector(".txtl-playhead");
  if (!ph || !pvMode || !pvPlan.length || pvTotal <= 0) return;
  ph.style.left = `${(pvOutputPos() / pvTotal) * 100}%`;
}

function addText() {
  const t = normalizeText({
    id: nextTextId++, text: "Text", font: "arial", bold: true, italic: false,
    sizePct: 7, color: "#ffcc00", x: 0.5, y: 0.85, start: null, end: null, shadow: true,
  });
  texts.push(t);
  selectedTextId = t.id;
  renderTextList();
  saveState();
  // Focus the new row's text input for immediate typing.
  const row = els.textList.querySelector(`.text-row[data-id="${t.id}"] .tx-content`);
  if (row) { row.focus(); row.select(); }
}

function removeText(id) {
  texts = texts.filter(t => t.id !== id);
  if (selectedTextId === id) selectedTextId = null;
  renderTextList();
  saveState();
}

// ---- CapCut-style output timeline -----------------------------------
// A base "video track" (the kept segments) + one lane per text whose bar is
// its [start,end] window on the output timeline. Drag a bar to move, drag its
// edges to trim, click to select. Dragging a bar to span the full width snaps
// it to "whole video" (null window).
const roundT = (x) => Math.round(x * 100) / 100;

function txtlBarRect(t) {
  const s = Math.max(0, Math.min(pvTotal, t.start != null ? t.start : 0));
  const e = Math.max(0, Math.min(pvTotal, t.end != null ? t.end : pvTotal));
  return { left: (s / pvTotal) * 100, width: (Math.max(0, e - s) / pvTotal) * 100 };
}

function renderTextTimeline() {
  const tl = els.textTimeline;
  if (!tl) return;
  if (!pvMode || !pvPlan.length || pvTotal <= 0) { tl.innerHTML = ""; return; }
  const segs = pvPlan.map((s) => {
    const left = (s.outStart / pvTotal) * 100, w = (s.outDur / pvTotal) * 100;
    return `<div class="seg ${s.kind}" style="left:${left}%;width:${w}%" title="Event ${s.clipIdx + 1} ${s.kind}">E${s.clipIdx + 1}${s.kind === "slow" ? " ⏱" : ""}</div>`;
  }).join("");
  const lanes = texts.map((t) => {
    const r = txtlBarRect(t);
    const whole = (t.start == null && t.end == null);
    const sel = t.id === selectedTextId ? " selected" : "";
    const label = escapeAttr((t.text || "Text").slice(0, 28) || "Text");
    return `
      <div class="txtl-lane">
        <div class="txtl-bar${sel}${whole ? " whole" : ""}" data-id="${t.id}" style="left:${r.left}%;width:${r.width}%" title="${label}">
          <span class="txtl-h l" data-h="start"></span>
          <span class="txtl-label">${label}</span>
          <span class="txtl-h r" data-h="end"></span>
        </div>
      </div>`;
  }).join("");
  tl.innerHTML = `
    <div class="txtl-ruler"><span>0:00</span><span>${fmt(pvTotal / 2)}</span><span>${fmt(pvTotal)}</span></div>
    <div class="txtl-body">
      <div class="txtl-track">${segs}</div>
      ${lanes}
      <div class="txtl-playhead"></div>
    </div>`;
  updateTimelinePlayhead();
}

// Toggle selection classes without rebuilding the timeline DOM (keeps drags alive).
function selectText(id) {
  selectedTextId = id;
  els.textList.querySelectorAll(".text-row").forEach(r =>
    r.classList.toggle("selected", parseInt(r.dataset.id, 10) === id));
  els.textTimeline.querySelectorAll(".txtl-bar").forEach(b =>
    b.classList.toggle("selected", parseInt(b.dataset.id, 10) === id));
  renderTextOverlays();
}

let tlDrag = null;  // {mode:'seek'|'move'|'start'|'end', id, bar, rect, startX, origStart, origEnd}

function tlBodyRect() {
  const body = els.textTimeline.querySelector(".txtl-body");
  return body ? body.getBoundingClientRect() : null;
}
function tlTimeFromX(clientX, rect) {
  const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  return frac * pvTotal;
}

els.textTimeline.addEventListener("mousedown", (e) => {
  if (!pvMode || !pvPlan.length || pvTotal <= 0) return;
  const rect = tlBodyRect();
  if (!rect) return;
  const bar = e.target.closest(".txtl-bar");
  if (bar) {
    e.preventDefault();
    const id = parseInt(bar.dataset.id, 10);
    const t = texts.find(x => x.id === id);
    selectText(id);
    const handle = e.target.closest(".txtl-h");
    if (handle) {
      tlDrag = { mode: handle.dataset.h, id, bar, rect };
    } else {
      tlDrag = { mode: "move", id, bar, rect, startX: e.clientX, origStart: t.start, origEnd: t.end };
    }
    return;
  }
  // Empty area / ruler -> scrub the output
  e.preventDefault();
  tlDrag = { mode: "seek", rect };
  pvSeekToOutput(tlTimeFromX(e.clientX, rect));
});

window.addEventListener("mousemove", (e) => {
  if (!tlDrag) return;
  if (tlDrag.mode === "seek") { pvSeekToOutput(tlTimeFromX(e.clientX, tlDrag.rect)); return; }
  const t = texts.find(x => x.id === tlDrag.id);
  if (!t) return;
  const T = roundT(tlTimeFromX(e.clientX, tlDrag.rect));
  if (tlDrag.mode === "start") {
    const eMax = (t.end != null ? t.end : pvTotal) - 0.1;
    t.start = Math.min(T, eMax);
  } else if (tlDrag.mode === "end") {
    const sMin = (t.start != null ? t.start : 0) + 0.1;
    t.end = Math.max(T, sMin);
  } else if (tlDrag.mode === "move") {
    const oS = tlDrag.origStart != null ? tlDrag.origStart : 0;
    const oE = tlDrag.origEnd != null ? tlDrag.origEnd : pvTotal;
    const dur = oE - oS;
    const dx = ((e.clientX - tlDrag.startX) / tlDrag.rect.width) * pvTotal;
    let s = Math.max(0, Math.min(pvTotal - dur, oS + dx));
    t.start = s; t.end = s + dur;
  }
  const r = txtlBarRect(t);
  tlDrag.bar.style.left = `${r.left}%`;
  tlDrag.bar.style.width = `${r.width}%`;
});

window.addEventListener("mouseup", () => {
  if (!tlDrag) return;
  const editing = tlDrag.mode !== "seek";
  const id = tlDrag.id;
  tlDrag = null;
  if (!editing) return;
  const t = texts.find(x => x.id === id);
  if (t) {
    // Snap to the edges -> open-ended; both open = whole video.
    if (t.start != null && t.start <= 0.05) t.start = null;
    if (t.end != null && t.end >= pvTotal - 0.05) t.end = null;
  }
  renderTextList();      // rebuild rows (window label) + timeline with final values
  renderTextOverlays();
  saveState();
});

// Editor input handling (delegated)
els.textList.addEventListener("input", (e) => {
  const input = e.target.closest("[data-field]");
  if (!input) return;
  const row = input.closest(".text-row");
  const id = parseInt(row.dataset.id, 10);
  const t = texts.find(x => x.id === id);
  if (!t) return;
  const field = input.dataset.field;
  if (field === "font") {
    t.font = input.value;
    if (fontSpec(t.font).noStyle) { t.bold = false; t.italic = false; }
    renderTextList();   // refresh Bold/Italic enabled state for the new family
    saveState();
    return;
  }
  if (field === "text") { t.text = input.value; renderTextTimeline(); }
  else if (field === "sizePct") t.sizePct = clampNum(input.value, 1, 30, t.sizePct);
  else if (field === "color") t.color = input.value;
  renderTextOverlays();
  saveState();
});
els.textList.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const id = parseInt(btn.closest(".text-row").dataset.id, 10);
  const t = texts.find(x => x.id === id);
  if (!t) return;
  const act = btn.dataset.act;
  if (act === "del") removeText(id);
  else if (act === "locate") selectText(id);
  else if (act === "bold" || act === "italic") {
    if (fontSpec(t.font).noStyle) return;   // family has no bold/italic
    t[act] = !t[act];
    btn.classList.toggle("active", t[act]);
    renderTextOverlays();
    saveState();
  }
});
// Selecting a row's text input highlights its overlay
els.textList.addEventListener("focusin", (e) => {
  const row = e.target.closest(".text-row");
  if (!row) return;
  const id = parseInt(row.dataset.id, 10);
  if (selectedTextId !== id) selectText(id);
});

els.addTextBtn.addEventListener("click", addText);

// ---- Drag a label on the player to reposition it --------------------
let txDrag = null;  // {id, el}
els.textOverlayLayer.addEventListener("mousedown", (e) => {
  const el = e.target.closest(".tx-overlay");
  if (!el) return;
  e.preventDefault();
  const id = parseInt(el.dataset.id, 10);
  txDrag = { id, el };
  el.classList.add("dragging");
  selectedTextId = id;
  els.textList.querySelectorAll(".text-row").forEach(r =>
    r.classList.toggle("selected", parseInt(r.dataset.id, 10) === id));
});
window.addEventListener("mousemove", (e) => {
  if (!txDrag) return;
  const rect = els.textOverlayLayer.getBoundingClientRect();
  const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
  const t = texts.find(x2 => x2.id === txDrag.id);
  if (!t) return;
  t.x = x; t.y = y;
  txDrag.el.style.left = `${x * 100}%`;
  txDrag.el.style.top = `${y * 100}%`;
});
window.addEventListener("mouseup", () => {
  if (!txDrag) return;
  txDrag.el.classList.remove("dragging");
  txDrag = null;
  saveState();
});

// Keep overlay font sizes correct when the player box resizes.
window.addEventListener("resize", () => { if (texts.length) renderTextOverlays(); });

// ---- Render summary -------------------------------------------------
function refreshRenderSummary() {
  const slow = parseInt(els.slowSlider.value, 10);
  const intro = parseFloat(els.introSeconds.value || "0");
  const factor = 100 / slow;
  const totalReal = clips.reduce((a, c) => a + (c.end - c.start), 0);
  const totalSlow = clips
    .filter(c => c.slowmo !== false)
    .reduce((a, c) => a + (c.end - c.start) * factor, 0);
  const slowCount = clips.filter(c => c.slowmo !== false).length;
  const totalOut = intro + totalReal + totalSlow;
  const sources = sourceList();
  const allHaveSource = clips.length > 0 && clips.every(c => c.video);
  const ok = allHaveSource;
  els.renderBtn.disabled = !ok;
  if (els.previewOutputBtn) els.previewOutputBtn.disabled = !ok;

  if (!clips.length) {
    els.renderSummary.innerHTML = currentVideo
      ? `Ready — add highlight events to enable export.`
      : `Pick a source video to begin.`;
    return;
  }
  const srcLabel = sources.length > 1 ? ` • <b>${sources.length}</b> source videos` : "";
  const txtCount = texts.filter(t => (t.text || "").trim()).length;
  const txtLabel = txtCount ? ` • <b>${txtCount}</b> text` : "";
  els.renderSummary.innerHTML = `
    <b>${clips.length}</b> events (<b>${slowCount}</b> with slow-mo ${slow}%, ${factor.toFixed(2)}×)${srcLabel}${txtLabel} •
    intro <b>${intro}s</b> →
    real <b>${fmtClock(totalReal)}</b> + slow-mo <b>${fmtClock(totalSlow)}</b> =
    output ≈ <b>${fmtClock(totalOut)}</b> @ <b>${resShortLabel(outHeight)}</b>
  `;
}

// Map the editor overlays to the backend payload (drop blank-text ones).
function textsPayload() {
  return texts
    .filter(t => (t.text || "").trim())
    .map(t => ({
      text: t.text, font: t.font, bold: !!t.bold, italic: !!t.italic,
      size_pct: t.sizePct, color: t.color,
      x: t.x, y: t.y, start: t.start, end: t.end, shadow: t.shadow !== false,
    }));
}

// ---- Projects (server-side save/load) -------------------------------
function currentProjectPayload(name) {
  return {
    name,
    tournament: els.tournament.value,
    player1: els.player1.value,
    player2: els.player2.value,
    intro_seconds: parseFloat(els.introSeconds.value || "4"),
    slow_percent: parseInt(els.slowSlider.value, 10),
    video: currentVideo || (clips[0] && clips[0].video) || "",
    clips: clips.map(c => ({ start: c.start, end: c.end, slowmo: c.slowmo !== false, video: c.video || "" })),
    texts: texts.map(t => ({
      text: t.text, font: t.font, bold: !!t.bold, italic: !!t.italic,
      sizePct: t.sizePct, color: t.color,
      x: t.x, y: t.y, start: t.start, end: t.end, shadow: t.shadow !== false,
    })),
  };
}

function applyProjectPayload(p) {
  els.tournament.value = p.tournament || "";
  els.player1.value = p.player1 || "";
  els.player2.value = p.player2 || "";
  if (typeof p.intro_seconds === "number") els.introSeconds.value = p.intro_seconds;
  if (typeof p.slow_percent === "number") {
    els.slowSlider.value = p.slow_percent;
    updateSlowLabel();
  }
  clips = (p.clips || []).map(c => ({
    id: nextClipId++,
    start: c.start,
    end: c.end,
    slowmo: c.slowmo !== false,
    // Migration: old projects stored clips without `video` (single-source) -> backfill.
    video: c.video || p.video || "",
  }));
  // Text overlays (old projects without `texts` -> none).
  texts = (p.texts || []).map(normalizeText);
  selectedTextId = null;
  renderTextList();
  // Loading a project is a fresh context — leave preview and drop undo history.
  if (pvMode) pvExit();
  clipUndoStack = [];
  updateUndoBtn();
  renderClipsTable();
  refreshResolutionOptions();
  // Load the first source into the player so capture/preview has a context.
  const firstSource = (clips[0] && clips[0].video) || p.video || "";
  if (firstSource) {
    selectVideo(firstSource);  // resolves bare names (legacy) or absolute paths
  } else {
    updatePickLabel();
  }
  saveState();
}

async function loadProjectList() {
  try {
    const res = await fetch("/api/projects");
    const data = await res.json();
    const cur = els.projectSelect.value;
    els.projectSelect.innerHTML = '<option value="">— Load saved project —</option>';
    for (const p of data.projects) {
      const o = document.createElement("option");
      o.value = p.name;
      o.textContent = p.name;
      els.projectSelect.appendChild(o);
    }
    if (cur) els.projectSelect.value = cur;
    updateProjectButtons();
  } catch (e) { /* ignore */ }
}

function updateProjectButtons() {
  const has = !!els.projectSelect.value;
  els.loadProjectBtn.disabled = !has;
  els.deleteProjectBtn.disabled = !has;
}

async function saveProject() {
  const name = (els.projectName.value || "").trim();
  if (!name) {
    flashTopMessage("Enter a project name before saving");
    els.projectName.focus();
    return;
  }
  if (!/^[A-Za-z0-9 _\-\.]{1,80}$/.test(name)) {
    flashTopMessage("Project name: letters/numbers/space/_-. only (max 80)");
    return;
  }
  // Confirm overwrite if exists
  const existing = [...els.projectSelect.options].some(o => o.value === name);
  if (existing && !confirm(`Project "${name}" already exists. Overwrite?`)) return;

  try {
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(currentProjectPayload(name)),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(t);
    }
    flashTopMessage(`✓ Saved "${name}"`);
    await loadProjectList();
    els.projectSelect.value = name;
    updateProjectButtons();
  } catch (e) {
    flashTopMessage(`Save error: ${e.message || e}`);
  }
}

async function loadProject() {
  const name = els.projectSelect.value;
  if (!name) return;
  if (clips.length && !confirm(`Loading "${name}" will replace the current ${clips.length} events. Continue?`)) return;
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(await res.text());
    const p = await res.json();
    clips = []; // reset before applying
    applyProjectPayload(p);
    els.projectName.value = name;
    flashTopMessage(`✓ Loaded "${name}"`);
  } catch (e) {
    flashTopMessage(`Load error: ${e.message || e}`);
  }
}

async function deleteProject() {
  const name = els.projectSelect.value;
  if (!name) return;
  if (!confirm(`Delete project "${name}"?`)) return;
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(name)}`, { method: "DELETE" });
    if (!res.ok) throw new Error(await res.text());
    flashTopMessage(`✓ Deleted "${name}"`);
    await loadProjectList();
  } catch (e) {
    flashTopMessage(`Delete error: ${e.message || e}`);
  }
}

let _topMsgTimer = null;
function flashTopMessage(msg) {
  // Reuse capture-status as transient toast (no clip-recording context here)
  els.captureStatus.textContent = msg;
  if (_topMsgTimer) clearTimeout(_topMsgTimer);
  _topMsgTimer = setTimeout(() => {
    if (captureStart === null) els.captureStatus.textContent = "";
  }, 2200);
}

// ---- Render ---------------------------------------------------------
async function exportSingleClip(clip, includeSlowmo) {
  const clipVideo = clip.video || currentVideo;
  if (!clipVideo) {
    alert("Pick a source video first");
    return;
  }
  if (!(clip.end > clip.start)) {
    alert("Invalid clip");
    return;
  }
  els.renderBtn.disabled = true;
  els.progressBox.classList.remove("hidden");
  els.resultBox.classList.add("hidden");
  els.progressFill.style.width = "0%";
  els.progressFill.style.background = "";
  els.progressPct.textContent = "0%";
  const idx = clips.findIndex(c => c.id === clip.id) + 1;
  const modeLabel = includeSlowmo ? "Real + Slow-mo" : "Real-speed";
  els.progressStage.textContent = `Exporting clip ${idx} (${modeLabel})…`;
  els.progressMsg.textContent = "";
  els.progressBox.scrollIntoView({ behavior: "smooth", block: "nearest" });

  try {
    const body = {
      video: clipVideo,
      start: clip.start,
      end: clip.end,
      include_slowmo: !!includeSlowmo,
      slow_percent: parseInt(els.slowSlider.value, 10),
      label: `clip${idx}`,
      out_height: outHeight || 0,
    };
    const res = await fetch("/api/export-clip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(t || `HTTP ${res.status}`);
    }
    const data = await res.json();
    currentJobId = data.job_id;
    listenProgress(currentJobId);
  } catch (e) {
    showRenderError(e.message || String(e));
  }
}

async function startRender() {
  if (!clips.length) return;
  // Validate clips
  for (const c of clips) {
    if (!(c.end > c.start)) {
      alert("Invalid clip — check Start/End.");
      return;
    }
    if (!c.video) {
      alert("An event has no source video — delete it and mark again.");
      return;
    }
  }
  els.renderBtn.disabled = true;
  els.progressBox.classList.remove("hidden");
  els.resultBox.classList.add("hidden");
  els.progressFill.style.width = "0%";
  els.progressPct.textContent = "0%";
  els.progressStage.textContent = "Initializing…";
  els.progressMsg.textContent = "";

  try {
    const body = {
      video: currentVideo || (clips[0] && clips[0].video) || "",
      clips: clips.map(c => ({ start: c.start, end: c.end, slowmo: c.slowmo !== false, video: c.video })),
      slow_percent: parseInt(els.slowSlider.value, 10),
      intro_seconds: parseFloat(els.introSeconds.value || "0"),
      tournament: els.tournament.value,
      player1: els.player1.value,
      player2: els.player2.value,
      out_height: outHeight || 0,
      texts: textsPayload(),
    };
    const res = await fetch("/api/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(t || `HTTP ${res.status}`);
    }
    const data = await res.json();
    currentJobId = data.job_id;
    listenProgress(currentJobId);
  } catch (e) {
    showRenderError(e.message || String(e));
  }
}

function listenProgress(jobId) {
  if (currentEventSource) { currentEventSource.close(); currentEventSource = null; }
  const es = new EventSource(`/api/progress/${jobId}`);
  currentEventSource = es;
  es.onmessage = (ev) => {
    try {
      const p = JSON.parse(ev.data);
      els.progressFill.style.width = `${p.percent}%`;
      els.progressPct.textContent = `${p.percent.toFixed(1)}%`;
      els.progressStage.textContent = p.stage || p.status;
      els.progressMsg.textContent = p.message || "";
      if (p.status === "done") {
        es.close(); currentEventSource = null;
        showResult(p.output_file);
      } else if (p.status === "error") {
        es.close(); currentEventSource = null;
        showRenderError(p.error || p.message || "Unknown error");
      }
    } catch (e) { /* ignore */ }
  };
  es.onerror = () => { /* SSE will auto-retry; handled by status events */ };
}

function showResult(filename) {
  els.progressBox.classList.add("hidden");
  els.resultBox.classList.remove("hidden");
  els.resultFilename.textContent = filename;
  els.renderBtn.disabled = false;
}

async function openOutputFolder() {
  try {
    const res = await fetch("/api/open-folder/output", { method: "POST" });
    if (!res.ok) throw new Error(await res.text());
  } catch (e) {
    alert(`Cannot open folder: ${e.message || e}`);
  }
}

function showRenderError(msg) {
  els.progressStage.textContent = "❌ Error";
  els.progressMsg.textContent = msg;
  els.progressFill.style.background = "linear-gradient(90deg, #d83a3a 0%, #ff7a4a 100%)";
  els.renderBtn.disabled = false;
}

async function cancelRender() {
  if (!currentJobId) return;
  try {
    await fetch(`/api/job/${currentJobId}/cancel`, { method: "POST" });
  } catch (e) { /* ignore */ }
}

// ---- Wire up --------------------------------------------------------
// Source picker: open the filesystem browser modal.
els.pickVideoBtn.addEventListener("click", openBrowse);
els.browseClose.addEventListener("click", closeBrowse);
els.browseBackdrop.addEventListener("click", closeBrowse);
els.browseGo.addEventListener("click", () => loadBrowse(els.browsePath.value.trim()));
els.browsePath.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); loadBrowse(els.browsePath.value.trim()); }
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!els.browseModal.classList.contains("hidden")) closeBrowse();
  else if (pvMode) pvExit();
});

els.slowSlider.addEventListener("input", updateSlowLabel);
els.resolutionSelect.addEventListener("change", (e) => {
  outHeight = parseInt(e.target.value, 10) || 0;
  saveState();
  refreshRenderSummary();
});
els.introSeconds.addEventListener("change", () => { saveState(); refreshRenderSummary(); });
els.tournament.addEventListener("change", saveState);
els.player1.addEventListener("change", saveState);
els.player2.addEventListener("change", saveState);

els.highlightBtn.addEventListener("click", toggleHighlight);

// Preview-output transport
els.previewOutputBtn.addEventListener("click", () => { pvMode ? pvExit() : pvEnter(); });
els.pvPlay.addEventListener("click", () => {
  if (!els.player.src) return;
  if (els.player.paused) els.player.play(); else els.player.pause();
});
els.pvPrev.addEventListener("click", pvPrev);
els.pvNext.addEventListener("click", pvNext);
els.pvExit.addEventListener("click", pvExit);
els.previewBar.querySelectorAll("[data-pv-seek]").forEach(b =>
  b.addEventListener("click", () => pvSeekOutput(parseFloat(b.dataset.pvSeek))));

els.saveProjectBtn.addEventListener("click", saveProject);
els.loadProjectBtn.addEventListener("click", loadProject);
els.deleteProjectBtn.addEventListener("click", deleteProject);
els.projectSelect.addEventListener("change", updateProjectButtons);
els.projectName.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); saveProject(); }
});

els.clearClips.addEventListener("click", () => {
  if (!clips.length) return;
  if (!confirm("Clear all events?")) return;
  pushClipUndo();
  clips = []; renderClipsTable(); refreshResolutionOptions(); saveState();
});

els.undoClipBtn.addEventListener("click", undoClips);

els.renderBtn.addEventListener("click", startRender);
els.cancelBtn.addEventListener("click", cancelRender);
els.openFolderBtn.addEventListener("click", openOutputFolder);
els.newRenderBtn.addEventListener("click", () => {
  els.resultBox.classList.add("hidden");
  els.progressBox.classList.add("hidden");
  els.progressFill.style.background = "";
});

// ---- Keyboard shortcuts --------------------------------------------
document.addEventListener("keydown", (e) => {
  // Don't hijack while typing in inputs
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return;

  if (!els.player.src) return;

  switch (e.key) {
    case " ":
      e.preventDefault();
      if (els.player.paused) els.player.play(); else els.player.pause();
      break;
    case "ArrowLeft":
      e.preventDefault();
      els.player.currentTime = Math.max(0, els.player.currentTime - (e.shiftKey ? 10 : 5));
      break;
    case "ArrowRight":
      e.preventDefault();
      els.player.currentTime = Math.min(
        (els.player.duration || 1e9),
        els.player.currentTime + (e.shiftKey ? 10 : 5)
      );
      break;
    case ",":
      e.preventDefault();
      els.player.pause();
      els.player.currentTime = Math.max(0, els.player.currentTime - 1 / videoFps);
      break;
    case ".":
      e.preventDefault();
      els.player.pause();
      els.player.currentTime = Math.min(
        (els.player.duration || 1e9),
        els.player.currentTime + 1 / videoFps
      );
      break;
    case "i":
    case "I":
      e.preventDefault();
      markIn();
      break;
    case "o":
    case "O":
      e.preventDefault();
      markOut();
      break;
  }
});

// ---- Init -----------------------------------------------------------
(async function init() {
  loadState();
  updateSlowLabel();
  renderClipsTable();
  renderTextList();
  updatePlayBtn();
  updatePickLabel();
  updateUndoBtn();
  // Restore the last-used source video into the player, if any.
  if (currentVideo) selectVideo(currentVideo);
  await loadProjectList();
  refreshResolutionOptions();
  refreshRenderSummary();
})();

// Ctrl+S as a global save shortcut
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
    e.preventDefault();
    saveProject();
  }
});

// Ctrl+Z to undo the last highlight-event change (skip while typing in inputs)
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;
    e.preventDefault();
    undoClips();
  }
});
