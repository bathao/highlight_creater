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
  brightSlider: $("brightSlider"),
  brightLabel: $("brightLabel"),
  brightReset: $("brightReset"),
  brightAll: $("brightAll"),
  brightAllText: $("brightAllText"),
  brightHint: $("brightHint"),
  brightAuto: $("brightAuto"),
  brightAnalyze: $("brightAnalyze"),
  brightAutoBtn: $("brightAutoBtn"),
  brightAutoAll: $("brightAutoAll"),
  brightAutoAllText: $("brightAutoAllText"),
  volSlider: $("volSlider"),
  volBtn: $("volBtn"),
  fsBtn: $("fsBtn"),
  playerWrap: $("playerWrap"),
  playerControls: $("playerControls"),
  fxLin: $("fxLin"),
  fxGam: $("fxGam"),
  fxSat: $("fxSat"),
  cropBtn: $("cropBtn"),
  cropLabel: $("cropLabel"),
  cropEditor: $("cropEditor"),
  cropRegion: $("cropRegion"),
  cropFree: $("cropFree"),
  cropApply: $("cropApply"),
  cropClear: $("cropClear"),
  cropCancel: $("cropCancel"),

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

  // Background music
  musicPanel: $("musicPanel"),
  musicAudio: $("musicAudio"),
  musicTrack: $("musicTrack"),
  musicAuditionBtn: $("musicAuditionBtn"),
  musicClearBtn: $("musicClearBtn"),
  musicVol: $("musicVol"),
  musicVolVal: $("musicVolVal"),
  origVol: $("origVol"),
  origVolVal: $("origVolVal"),
  musicFadeIn: $("musicFadeIn"),
  musicFadeOut: $("musicFadeOut"),
  musicLoop: $("musicLoop"),
  musicDuck: $("musicDuck"),
  musicLaneFill: $("musicLaneFill"),

  // Project save/load
  projectName: $("projectName"),
  projectSelect: $("projectSelect"),
  saveProjectBtn: $("saveProjectBtn"),
  newProjectBtn: $("newProjectBtn"),
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
// Per-source brightness: video path -> percent (-50..+50, 0 = unchanged).
// Previewed live via a CSS filter on the player; the render maps the same
// value onto ffmpeg's eq filter, so what you see is what gets burned in.
let sourceAdjust = {};
// "Apply to all sources" brightness: null = off (per-source mode above);
// a number = every source without its own entry -- including sources
// picked later -- inherits this value. While it is on, `sourceAdjust` is
// kept empty so the global value is the single source of truth.
let brightnessAll = null;
// Per-source frame measurements for smart brightness: video path ->
// {p99, sat, mean} (99th-percentile luma, mean HSV saturation, mean luma,
// all 0..1) taken from the frame shown in the player. deriveColor() turns
// the brightness level + these into the gamma/contrast/saturation/gain the
// player previews and the export burns in. Missing = neutral profile.
let sourceStats = {};
// "Auto for all sources": when on, every source that has no level of its
// own gets measured (offscreen, at the middle of its first event) and its
// level picked by autoBrightnessLevel — including sources added later.
// sourceMode[path] = "auto" (level chosen by Auto) | "manual" (user moved
// the slider / reset); a manual source is never overwritten by the mode.
let brightnessAuto = false;
let sourceMode = {};
// Player (preview) volume 0..1 — persisted; the export mix is unaffected.
let playerVolume = 1;
// Per-source crop: video path -> {x,y,w,h} fractions of the source frame
// (top-left + size); absent = full frame. Previewed live via a CSS
// transform + clip-path on the player; the render maps the same fractions
// onto ffmpeg's crop filter, so what you see is what gets burned in.
let sourceCrop = {};
let cropEditing = false; // crop editor open (player shows the full frame)

// Text overlays burned onto the final video. Each: {id,text,font,sizePct,
// color,x,y,start,end,shadow}. x/y are the text CENTRE as a fraction of the
// final canvas; start/end are seconds on the final timeline (incl. intro),
// null = whole video.
let texts = [];
let nextTextId = 1;
let selectedTextId = null;
let txEditId = null;   // id of the overlay being edited inline (null = none)

// Background music mixed onto the final output (one global track). volume and
// originalVolume are linear gains (1.0 = unchanged). Persisted + sent to the
// render. `track` is a filename in the server's music library ("" = none).
let music = {
  track: "", volume: 0.35, originalVolume: 1.0,
  fadeIn: 0, fadeOut: 0, loop: true, duck: false,
};
let musicTracks = [];        // [{file,name,url,duration,size_mb}] from /api/music
let musicAuditioning = false; // standalone "Audition" playback is active

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
      music,
      sourceAdjust,
      brightnessAll,
      brightnessAuto,
      sourceMode,
      sourceStats,
      sourceCrop,
      playerVolume,
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
    if (s.music) music = normalizeMusic(s.music);
    if (s.sourceAdjust && typeof s.sourceAdjust === "object") {
      sourceAdjust = {};
      for (const [path, v] of Object.entries(s.sourceAdjust)) setBrightness(path, v);
    }
    brightnessAll = typeof s.brightnessAll === "number" ? clampBrightness(s.brightnessAll) : null;
    if (brightnessAll !== null) sourceAdjust = {};
    sourceStats = normalizeStatsMap(s.sourceStats);
    brightnessAuto = s.brightnessAuto === true;
    sourceMode = normalizeModeMap(s.sourceMode);
    if (typeof s.playerVolume === "number") playerVolume = Math.max(0, Math.min(1, s.playerVolume));
    if (s.sourceCrop && typeof s.sourceCrop === "object") {
      sourceCrop = {};
      for (const [path, c] of Object.entries(s.sourceCrop)) setCrop(path, c);
    }
  } catch (e) { /* ignore */ }
}

// Coerce a stored/loaded music config into the canonical shape with safe
// defaults (backward-compatible: missing fields fall back).
function normalizeMusic(m) {
  m = m || {};
  return {
    track: typeof m.track === "string" ? m.track : "",
    volume: clampNum(m.volume, 0, 2, 0.35),
    originalVolume: clampNum(m.originalVolume, 0, 2, 1.0),
    fadeIn: clampNum(m.fadeIn, 0, 15, 0),
    fadeOut: clampNum(m.fadeOut, 0, 15, 0),
    loop: m.loop !== false,
    duck: !!m.duck,
  };
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
    box: !!t.box,
    boxColor: /^#[0-9a-fA-F]{6}$/.test(t.boxColor || "") ? t.boxColor : "#000000",
    boxOpacity: clampNum(t.boxOpacity, 0, 1, 0.45),
    fade: clampNum(t.fade, 0, 10, 0),
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
  // Accept "12.34", "1:12.34" (m:s) or "1:02:03.5" (h:m:s)
  if (str === null || str === undefined) return NaN;
  str = String(str).trim();
  if (!str) return NaN;
  if (str.includes(":")) {
    return str.split(":")
      .map(p => parseFloat(p) || 0)
      .reduce((acc, p) => acc * 60 + p, 0);
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

// ---- Per-source brightness ------------------------------------------
function clampBrightness(v) {
  return Math.max(-50, Math.min(50, Math.round(Number(v) || 0)));
}

// A source's own value wins; otherwise the "apply to all" value (if on).
function getBrightness(path) {
  if (!path) return 0;
  if (Object.prototype.hasOwnProperty.call(sourceAdjust, path)) return sourceAdjust[path];
  return brightnessAll === null ? 0 : brightnessAll;
}

function setBrightness(path, v) {
  if (!path) return;
  v = clampBrightness(v);
  if (v) sourceAdjust[path] = v; else delete sourceAdjust[path];
}

// Every source path the project currently knows about (events + the one
// in the player) -- used when leaving "apply to all" mode so each source
// keeps the value it was showing.
function knownSourcePaths() {
  const set = new Set(clips.map(c => c.video).filter(Boolean));
  if (currentVideo) set.add(currentVideo);
  return [...set];
}

// Switch "apply to all sources" on/off without changing what any source
// currently shows: on = the current source's value becomes the global one;
// off = the global value is written into every known source.
function setBrightnessAllMode(on) {
  if (on) {
    if (brightnessAll !== null) return;
    brightnessAuto = false;
    brightnessAll = getBrightness(currentVideo);
    sourceAdjust = {};
  } else {
    if (brightnessAll === null) return;
    const v = brightnessAll;
    brightnessAll = null;
    sourceAdjust = {};
    knownSourcePaths().forEach(p => setBrightness(p, v));
  }
}

// ---- Smart brightness: one level -> a whole look ------------------------
// The user picks ONE number by eye. From it (and two measurements of the
// footage) we derive: gain = a multiplicative lift, only as much as the
// highlights can take without clipping; gamma = midtone/shadow lift for the
// rest, never clips white; contrast = a touch so the gamma lift does not
// look hazy; saturation = compensates the desaturation every lift causes,
// less on footage that is already vivid. backend/render.py:derive_color is a
// line-for-line port; the derived numbers are sent with every clip so the
// export burns in exactly what the player showed.
const NEUTRAL_STATS = { p99: 0.85, sat: 0.35 };
const HIST_BINS = 32;
const AUTO_TARGET_MEAN = 0.48; // post-look mean luma Auto brightness aims for (well-exposed mid-tones)

function clamp01(v, d) { v = Number(v); return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d; }

function normalizeStats(st) {
  if (!st || typeof st !== "object") return null;
  const p99 = clamp01(st.p99, NaN), sat = clamp01(st.sat, NaN);
  if (!Number.isFinite(p99) || !Number.isFinite(sat)) return null;
  const r3 = n => Math.round(n * 1000) / 1000;
  const out = { p99: r3(p99), sat: r3(sat), mean: r3(clamp01(st.mean, 0.5)) };
  // Coarse luma histogram (HIST_BINS fractions) — lets Auto brightness predict
  // the post-look mean exactly instead of guessing from the mean alone.
  if (Array.isArray(st.hist) && st.hist.length === HIST_BINS) {
    const h = st.hist.map(v => Math.max(0, Number(v) || 0));
    const tot = h.reduce((a, b) => a + b, 0);
    // Raw counts get normalised to fractions; an already-normalised histogram
    // (sum ~1 up to rounding) is kept as is, so re-normalising on every load
    // never drifts the stored values.
    if (tot > 0) out.hist = Math.abs(tot - 1) < 0.01 ? h.map(v => Math.round(v * 10000) / 10000)
                                                     : h.map(v => Math.round(v / tot * 10000) / 10000);
  }
  return out;
}

function normalizeStatsMap(m) {
  const out = {};
  if (m && typeof m === "object") {
    for (const [path, st] of Object.entries(m)) { const n = normalizeStats(st); if (path && n) out[path] = n; }
  }
  return out;
}

function deriveColor(level, stats) {
  const v = clampBrightness(level);
  if (Math.abs(v) < 0.5) return null;
  const t = v / 50;
  const st = stats || {};
  const p99 = clamp01(st.p99, NEUTRAL_STATS.p99);
  const sat = clamp01(st.sat, NEUTRAL_STATS.sat);
  const satScale = Math.max(0.4, Math.min(1, 1.2 - sat));
  let gain, gamma, contrast, saturation;
  if (t > 0) {
    const headroom = Math.max(0, Math.min(0.5, 1 - p99));
    const gainMax = 1 + Math.min(0.35, headroom * 0.9);
    gain = 1 + (gainMax - 1) * t;
    gamma = 1 + t * (0.7 - 0.5 * (gainMax - 1));
    contrast = 1 + 0.08 * t;
    saturation = 1 + 0.55 * t * satScale;
  } else {
    const u = -t;
    gain = 1 - 0.30 * u;
    gamma = 1 - 0.25 * u;
    contrast = 1 + 0.10 * u;
    saturation = 1 - 0.12 * u * satScale;
  }
  const r4 = n => Math.round(n * 10000) / 10000;
  return { gain: r4(gain), gamma: r4(gamma), contrast: r4(contrast), saturation: r4(saturation) };
}

// The look for a source: its brightness level (own or "apply to all") run
// through deriveColor with that source's own frame stats. null = untouched.
function getColorParams(path) {
  return deriveColor(getBrightness(path), path ? sourceStats[path] : null);
}

// Luma percentile + mean HSV saturation of an RGBA buffer (any size).
function computeFrameStats(data) {
  const hist = new Uint32Array(256);
  let n = 0, lumaSum = 0, satSum = 0, satN = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const y = Math.min(255, Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b));
    hist[y]++; lumaSum += y; n++;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx >= 26) { satSum += (mx - mn) / mx; satN++; }
  }
  if (!n) return null;
  let acc = 0, p99 = 255;
  const target = n * 0.99;
  for (let y = 0; y < 256; y++) { acc += hist[y]; if (acc >= target) { p99 = y; break; } }
  const coarse = new Array(HIST_BINS).fill(0);
  for (let y = 0; y < 256; y++) coarse[Math.floor(y * HIST_BINS / 256)] += hist[y];
  return normalizeStats({ p99: p99 / 255, sat: satN ? satSum / satN : 0, mean: lumaSum / (n * 255), hist: coarse });
}

// Per-channel tone curve of a look (the gamma-encoded luma goes through the
// same curve; the saturate matrix is luma-preserving so it is ignored here).
function lookCurve(p, x) {
  if (!p) return x;
  const C = p.gain * p.contrast, B = (p.gain - 1) / 2;
  return Math.pow(Math.max(0, Math.min(1, C * (x - 0.5) + 0.5 + B)), 1 / p.gamma);
}

// Auto brightness: the slider level (step 5) whose derived look brings the
// frame's mean luma closest to AUTO_TARGET_MEAN, predicted from the stored
// luma histogram (falls back to the mean alone for old stats). Ties go to
// the smaller change.
function autoBrightnessLevel(stats) {
  if (!stats) return 0;
  const bins = Array.isArray(stats.hist) && stats.hist.length === HIST_BINS
    ? stats.hist.map((w, i) => [(i + 0.5) / HIST_BINS, w])
    : [[clamp01(stats.mean, 0.5), 1]];
  let best = 0, bestErr = Infinity;
  for (let v = -50; v <= 50; v += 5) {
    const p = deriveColor(v, stats);
    const mean = bins.reduce((acc, [x, w]) => acc + w * lookCurve(p, x), 0);
    const err = Math.abs(mean - AUTO_TARGET_MEAN);
    if (err < bestErr - 1e-9 || (Math.abs(err - bestErr) <= 1e-9 && Math.abs(v) < Math.abs(best))) { best = v; bestErr = err; }
  }
  return best;
}

// Measure the frame the player is showing for the current source. Returns
// true when stats were (re)recorded. A frame that is not decoded yet, or
// is essentially black (fade-in), is skipped so a bad sample never sticks.
function analyzeCurrentFrame() {
  const p = els.player;
  if (!currentVideo || p.readyState < 2 || !p.videoWidth) return false;
  try {
    const cw = 160, ch = Math.max(2, Math.round(160 * p.videoHeight / p.videoWidth));
    const c = document.createElement("canvas");
    c.width = cw; c.height = ch;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(p, 0, 0, cw, ch);
    const st = computeFrameStats(ctx.getImageData(0, 0, cw, ch).data);
    if (!st || st.mean < 0.02) return false;
    sourceStats[currentVideo] = st;
    return true;
  } catch (e) { return false; }
}

// A frame can only be sampled once Chrome has actually painted it, which
// lags loadeddata / readyState by a frame or two. When an immediate attempt
// finds nothing, retry as frames get presented (a few times, then give up —
// the next slider touch tries again).
let frameAnalysisPending = null;
function analyzeWhenPainted() {
  const path = currentVideo;
  if (!path || sourceStats[path] || frameAnalysisPending === path) return;
  frameAnalysisPending = path;
  let tries = 0;
  const attempt = () => {
    if (frameAnalysisPending !== path) return;
    if (currentVideo !== path || sourceStats[path]) { frameAnalysisPending = null; return; }
    if (analyzeCurrentFrame()) {
      frameAnalysisPending = null;
      applyPlayerBrightness();
      updateBrightnessControl();
      saveState();
      return;
    }
    if (++tries >= 10) { frameAnalysisPending = null; return; }
    setTimeout(attempt, 100);
  };
  const p = els.player;
  if (typeof p.requestVideoFrameCallback === "function") p.requestVideoFrameCallback(() => attempt());
  setTimeout(attempt, 60);
}

function normalizeModeMap(m) {
  const out = {};
  if (m && typeof m === "object") {
    for (const [path, mode] of Object.entries(m)) if (path && (mode === "auto" || mode === "manual")) out[path] = mode;
  }
  return out;
}

// Measure a source without disturbing the player: a hidden <video> seeks to
// `t` and its painted frame is sampled. Resolves to stats or null (decode
// error, timeout, or only black frames).
function analyzeSourceOffscreen(path, t) {
  return new Promise(resolve => {
    const v = document.createElement("video");
    v.muted = true; v.preload = "auto"; v.playsInline = true;
    v.style.cssText = "position:fixed;left:-9999px;top:0;width:160px;height:90px;opacity:0;pointer-events:none";
    let done = false, tries = 0;
    const finish = st => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      v.removeAttribute("src"); v.load(); v.remove();
      resolve(st);
    };
    const timer = setTimeout(() => finish(null), 20000);
    const grab = () => {
      if (done) return;
      let st = null;
      try {
        if (v.readyState >= 2 && v.videoWidth) {
          const cw = 160, ch = Math.max(2, Math.round(160 * v.videoHeight / v.videoWidth));
          const c = document.createElement("canvas"); c.width = cw; c.height = ch;
          const ctx = c.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(v, 0, 0, cw, ch);
          st = computeFrameStats(ctx.getImageData(0, 0, cw, ch).data);
        }
      } catch (e) { st = null; }
      if (st && st.mean >= 0.02) return finish(st);
      if (++tries >= 15) return finish(null);
      setTimeout(grab, 120);
    };
    v.addEventListener("loadedmetadata", () => {
      const dur = Number.isFinite(v.duration) ? v.duration : 0;
      const target = Math.max(0, Math.min(t || 0, dur > 1 ? dur - 0.5 : 0));
      if (Math.abs(v.currentTime - target) < 0.05) grab(); else v.currentTime = target;
    });
    v.addEventListener("seeked", () => {
      if (typeof v.requestVideoFrameCallback === "function") v.requestVideoFrameCallback(() => grab());
      setTimeout(grab, 150);
    });
    v.addEventListener("error", () => finish(null));
    document.body.appendChild(v);
    v.src = `/api/source-stream?path=${encodeURIComponent(path)}`;
  });
}

// Representative time for measuring a source: the middle of its first event
// (gameplay, not a fade-in), else the player position if it is showing, else 3 s.
function representativeTime(path) {
  const c = clips.find(k => k.video === path && k.end > k.start);
  if (c) return (c.start + c.end) / 2;
  if (path === currentVideo && els.player.currentTime > 0) return els.player.currentTime;
  return 3;
}

const autoPending = new Set();
// Under "auto for all": give `path` its own level if it has none yet
// (neither auto nor manual). Resolves when done; safe to call repeatedly.
async function ensureAutoLevel(path) {
  if (!brightnessAuto || !path || sourceMode[path] || autoPending.has(path)) return false;
  autoPending.add(path);
  try {
    let st = sourceStats[path] || null;
    if (!st) st = await analyzeSourceOffscreen(path, representativeTime(path));
    if (!brightnessAuto || sourceMode[path]) return false; // mode changed / user intervened meanwhile
    if (!st) return false;
    sourceStats[path] = st;
    setBrightness(path, autoBrightnessLevel(st));
    sourceMode[path] = "auto";
    if (path === currentVideo) { applyPlayerBrightness(); updateBrightnessControl(); }
    saveState();
    return true;
  } finally {
    autoPending.delete(path);
  }
}

// Every known source (events + the one in the player) that still lacks a
// level, one after another (one hidden decoder at a time). Render / export
// await this so no source goes out untouched.
async function ensureAllAutoLevels() {
  if (!brightnessAuto) return;
  const todo = knownSourcePaths().filter(p => !sourceMode[p]);
  if (!todo.length) return;
  flashTopMessage(`Auto brightness — analysing ${todo.length} source${todo.length > 1 ? "s" : ""}…`);
  let ok = 0;
  for (const p of todo) if (await ensureAutoLevel(p)) ok++;
  const failed = todo.length - ok;
  flashTopMessage(failed
    ? `Auto brightness — ${ok} source${ok !== 1 ? "s" : ""} set, ${failed} could not be analysed (left unchanged)`
    : `Auto brightness — ${ok} source${ok !== 1 ? "s" : ""} set`);
  updateBrightnessControl();
}

// Switch the mode. On: turns "apply to all" off (the two are exclusive —
// one global level vs one level per source) and analyses every known
// source. Off: every source keeps the level it has.
function setBrightnessAutoMode(on) {
  on = !!on;
  if (on === brightnessAuto) return;
  if (on && brightnessAll !== null) setBrightnessAllMode(false);
  brightnessAuto = on;
  if (on) ensureAllAutoLevels();
}

// Slider/reset target: the global value in "all" mode, else the current source.
function setBrightnessFromControl(v) {
  if (brightnessAll !== null) {
    brightnessAll = clampBrightness(v);
    sourceAdjust = {};
  } else {
    if (!currentVideo) return;
    setBrightness(currentVideo, v);
    sourceMode[currentVideo] = "manual";
  }
}

// Live preview of the adjustment on whatever source the player is showing —
// selectVideo routes every source switch (capture, event preview, preview
// output segments) through here, so the filter always tracks the source.
// The look is previewed with an SVG filter (#colorFx in index.html) because
// CSS filter functions have no gamma step: a per-channel linear pass
// (contrast+gain), a per-channel gamma pass, then the standard saturate()
// matrix — the same three steps, in the same order, as the ffmpeg chain.
function applyPlayerBrightness() {
  const p = getColorParams(currentVideo);
  if (!p) { els.player.style.filter = ""; return; }
  const C = p.gain * p.contrast, B = (p.gain - 1) / 2;
  const intercept = 0.5 - 0.5 * C + B;
  for (const fn of els.fxLin.children) { fn.setAttribute("slope", C.toFixed(4)); fn.setAttribute("intercept", intercept.toFixed(4)); }
  for (const fn of els.fxGam.children) fn.setAttribute("exponent", (1 / p.gamma).toFixed(4));
  els.fxSat.setAttribute("values", p.saturation.toFixed(4));
  els.player.style.filter = "url(#colorFx)";
}

function describeColor(p) {
  const pct = k => `${k >= 1 ? "+" : ""}${Math.round((k - 1) * 100)}%`;
  return `gamma ${p.gamma.toFixed(2)} · contrast ${pct(p.contrast)} · colour ${pct(p.saturation)} · gain ${pct(p.gain)}`;
}

function updateBrightnessControl() {
  const all = brightnessAll !== null;
  const v = all ? brightnessAll : getBrightness(currentVideo);
  els.brightSlider.disabled = !all && !currentVideo;
  els.brightSlider.value = v;
  els.brightLabel.textContent = v > 0 ? `+${v}%` : `${v}%`;
  els.brightReset.classList.toggle("hidden", !v);
  els.brightAll.checked = all;
  els.brightSlider.title = all
    ? "Brighten or darken every source video (current and added later)"
    : "Brighten or darken the current source video";
  els.brightHint.textContent = all
    ? "All sources — one level for every source video, including videos you pick later; gamma, contrast and colour are set per source from its own footage. Live in the player, burned into the export."
    : "Per source video — pick the level by eye; gamma, contrast, colour and gain are set automatically from the footage. Live in the player, burned into the export.";
  const p = getColorParams(currentVideo);
  const st = currentVideo ? sourceStats[currentVideo] : null;
  els.brightAutoAll.checked = brightnessAuto;
  let modeNote = "";
  if (brightnessAuto && currentVideo) {
    const m = sourceMode[currentVideo];
    modeNote = m === "auto" ? "this source: auto level · " : m === "manual" ? "this source: manual level · "
      : autoPending.has(currentVideo) ? "this source: analysing… · " : "this source: not analysed yet · ";
  }
  els.brightAuto.textContent = p
    ? `${modeNote}Auto: ${describeColor(p)} — ${st ? "from the analysed frame" : "default profile (no frame analysed yet)"}`
    : `${modeNote}Auto: gamma, contrast, colour and gain follow the slider`;
  if (brightnessAuto) {
    els.brightHint.textContent = "Auto for all sources — every source video (including ones you pick later) is measured and gets its own level; move the slider on a source to take it over by hand. Live in the player, burned into the export.";
  }
  els.brightAnalyze.disabled = !currentVideo;
  els.brightAutoBtn.disabled = !currentVideo;
}

// ---- Per-source crop --------------------------------------------------
const MIN_CROP_FRAC = 0.15; // smallest crop side (fraction of the source)

function getCrop(path) {
  return (path && sourceCrop[path]) || null;
}

// Clamp + store a crop; a ~full-frame crop deletes the key (mirrors
// brightness deleting at 0) so the map stays sparse and old behaviour is
// byte-identical when nothing is cropped.
function setCrop(path, c) {
  if (!path) return;
  if (!c || typeof c !== "object") { delete sourceCrop[path]; return; }
  let w = clampNum(c.w, MIN_CROP_FRAC, 1, 1);
  let h = clampNum(c.h, MIN_CROP_FRAC, 1, 1);
  let x = clampNum(c.x, 0, 1, 0);
  let y = clampNum(c.y, 0, 1, 0);
  x = Math.min(x, 1 - w);
  y = Math.min(y, 1 - h);
  const r4 = n => Math.round(n * 10000) / 10000;
  if (w >= 0.999 && h >= 0.999) { delete sourceCrop[path]; return; }
  sourceCrop[path] = { x: r4(x), y: r4(y), w: r4(w), h: r4(h) };
}

// ---- Geometry helpers (letterbox math) --------------------------------
// Aspect-fit-center a box of innerW x innerH into boxW x boxH -> px rect.
function fitRect(innerW, innerH, boxW, boxH, boxX = 0, boxY = 0) {
  if (!innerW || !innerH || !boxW || !boxH) return null;
  const k = Math.min(boxW / innerW, boxH / innerH);
  const w = innerW * k, h = innerH * k;
  return { x: boxX + (boxW - w) / 2, y: boxY + (boxH - h) / 2, w, h };
}

// Where the source picture actually shows inside the wrapper (the <video>
// letterboxes via object-fit: contain). Needs loadedmetadata (videoWidth).
function videoContentRect() {
  const wrap = els.player.parentElement;
  return fitRect(els.player.videoWidth, els.player.videoHeight,
                 wrap.clientWidth, wrap.clientHeight);
}

// Aspect of the final output canvas = the FIRST clip's source, after its
// crop (mirrors run_job). Probe comes from the cache (sync); 16:9 fallback
// until the probe lands.
function canvasAspect() {
  const src = canvasSourceVideo();
  const info = src && probeCache[src];
  if (!info || !info.width || !info.height) return 16 / 9;
  const c = getCrop(src);
  return c ? (info.width * c.w) / (info.height * c.h) : info.width / info.height;
}

// The canvas' fit rect inside the wrapper — the target box for the crop
// preview and the text-overlay layer.
function canvasFitRect() {
  const wrap = els.player.parentElement;
  const a = canvasAspect();
  return fitRect(a, 1, wrap.clientWidth, wrap.clientHeight);
}

// Live WYSIWYG crop preview: clip the source to the crop region (clip-path
// works in the element's pre-transform box) and transform that region onto
// its aspect-fit rect inside the canvas fit rect. The wrapper is already
// black + overflow:hidden, so a free-aspect crop letterboxes for free.
// Coexists with the brightness CSS filter (different properties). Cleared
// while the crop editor is open (it must show the full frame).
function applyPlayerCrop() {
  const p = els.player;
  const crop = getCrop(currentVideo);
  const C = videoContentRect();
  if (!crop || !C || cropEditing) {
    p.style.transform = "";
    p.style.transformOrigin = "";
    p.style.clipPath = "";
    return;
  }
  const rx = C.x + crop.x * C.w, ry = C.y + crop.y * C.h;
  const rw = crop.w * C.w, rh = crop.h * C.h;
  const T = canvasFitRect();
  if (!T || rw < 2 || rh < 2) return;
  const k = Math.min(T.w / rw, T.h / rh);
  const tx = T.x + (T.w - rw * k) / 2, ty = T.y + (T.h - rh * k) / 2;
  const W = p.clientWidth, H = p.clientHeight;
  p.style.transformOrigin = "0 0";
  p.style.transform = `translate(${(tx - rx * k).toFixed(2)}px, ${(ty - ry * k).toFixed(2)}px) scale(${k.toFixed(5)})`;
  p.style.clipPath = `inset(${ry.toFixed(2)}px ${(W - rx - rw).toFixed(2)}px ${(H - ry - rh).toFixed(2)}px ${rx.toFixed(2)}px)`;
}

function updateCropControl() {
  const c = getCrop(currentVideo);
  els.cropBtn.disabled = !currentVideo;
  els.cropLabel.textContent = c
    ? `${Math.round(c.w * 100)}% × ${Math.round(c.h * 100)}% @ (${Math.round(c.x * 100)}%, ${Math.round(c.y * 100)}%)`
    : "full frame";
}

// One pending "source finished loading" callback. Every source switch
// invalidates it, so a rapid series of switches (preview segment skips,
// event previews) can never leave stale loadeddata handlers behind that
// would later double-play or re-seek the wrong range.
let sourceReadyHandler = null;
function cancelSourceReady() {
  if (sourceReadyHandler) {
    els.player.removeEventListener("loadeddata", sourceReadyHandler);
    sourceReadyHandler = null;
  }
}
function onSourceReady(fn) {
  cancelSourceReady();
  const h = () => { cancelSourceReady(); fn(); };
  sourceReadyHandler = h;
  els.player.addEventListener("loadeddata", h);
}

async function selectVideo(path) {
  cancelSourceReady();
  // A crop draft belongs to the source it was opened on — switching sources
  // (event preview, project load, ...) closes the editor without committing.
  if (cropEditing && path !== currentVideo) exitCropMode(false);
  // An I-mark taken on one source must not pair with an O-mark on another —
  // switching videos mid-capture cancels the capture.
  if (captureStart !== null && path !== currentVideo) {
    setCaptureState(false);
    flashTopMessage("Capture cancelled — the source video changed");
  }
  if (!path) {
    currentVideo = null;
    els.player.removeAttribute("src");
    els.player.load();
    els.overlay.classList.remove("hidden");
    els.playerInfo.textContent = "No video selected";
    updatePickLabel();
    applyPlayerBrightness();
    updateBrightnessControl();
    applyPlayerCrop();
    updateCropControl();
    refreshResolutionOptions();
    layoutOverlayLayer();
    renderTextOverlays();
    return;
  }
  currentVideo = path;
  els.player.src = `/api/source-stream?path=${encodeURIComponent(path)}`;
  els.player.playbackRate = parseFloat(els.speedSelect.value) || 1;
  els.player.load();
  els.overlay.classList.add("hidden");
  updatePickLabel();
  applyPlayerBrightness();
  updateBrightnessControl();
  // Crop transform needs videoWidth (loadedmetadata); clear it now so a
  // rapid source switch can never flash the previous source's crop, then
  // re-apply once this source's metadata lands.
  applyPlayerCrop();
  updateCropControl();
  layoutOverlayLayer();
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
  if (brightnessAuto) ensureAutoLevel(path);
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
  // Effective canvas height = probe height x the canvas source's crop (the
  // backend derives the canvas from the cropped first source the same way).
  const crop = getCrop(src);
  const srcH = (info && info.height)
    ? Math.round(info.height * (crop ? crop.h : 1)) : 0;
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
  // In preview, mirror the OUTPUT position so the (dimmed) raw bar tracks the
  // assembled output smoothly instead of jumping with each source segment.
  if (pvMode && pvPlan.length && pvTotal > 0) {
    const op = pvOutputPos();
    els.playerTime.textContent = `${fmt(op)} / ${fmt(pvTotal)}`;
    const pct = (op / pvTotal) * 100;
    els.timelineProgress.style.width = `${pct}%`;
    els.timelineThumb.style.left = `${pct}%`;
    return;
  }
  const c = els.player.currentTime || 0;
  const d = els.player.duration || 0;
  els.playerTime.textContent = `${fmt(c)} / ${fmt(d)}`;
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

// Keep both transports (main control + preview transport) in lockstep with the
// element's real paused state. Call after any explicit play()/pause() so the
// icon never lags the actual state (the play/pause events alone can be raced
// by a seek that switches segments right after).
function syncPlayButtons() { updatePlayBtn(); pvSyncPlayBtn(); }

els.player.addEventListener("timeupdate", updatePlayerTime);
els.player.addEventListener("loadedmetadata", () => {
  updatePlayerTime();
  updateBuffered();
  // Crop preview + overlay layout depend on videoWidth/videoHeight, which
  // only exist from this event on.
  applyPlayerCrop();
  layoutOverlayLayer();
  renderTextOverlays();
});
els.player.addEventListener("durationchange", () => {
  updatePlayerTime();
});
els.player.addEventListener("progress", updateBuffered);
els.player.addEventListener("play",  () => { updatePlayBtn(); pvSyncPlayBtn(); syncTextOverlayTiming(); syncMusicPlayback(); if (pvMode) pvArmWatchdog(pvPlan[pvPos]); });
els.player.addEventListener("pause", () => { updatePlayBtn(); pvSyncPlayBtn(); syncTextOverlayTiming(); syncMusicPlayback(); if (pvWatchdog) { clearTimeout(pvWatchdog); pvWatchdog = null; } });
els.player.addEventListener("ended", () => { updatePlayBtn(); pvSyncPlayBtn(); syncTextOverlayTiming(); });
// Extra safety nets so the play/pause icon always matches reality, even when a
// state change rides in on a seek/stall rather than a clean play/pause event.
["playing", "seeked", "waiting", "canplay"].forEach(ev =>
  els.player.addEventListener(ev, syncPlayButtons));

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

function timelineFracFromEvent(e) {
  const rect = els.timeline.getBoundingClientRect();
  const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
  return Math.max(0, Math.min(1, x / rect.width));
}

function timelineSeekFromEvent(e) {
  // The raw-source timeline is disabled during preview (the CapCut output
  // timeline is the only scrubber then) — see the `pv-disabled` guard.
  if (pvMode) return;
  const d = els.player.duration || 0;
  if (!d) return;
  els.player.currentTime = timelineFracFromEvent(e) * d;
}

function timelineHoverFromEvent(e) {
  if (pvMode) { els.timelineTooltip.style.opacity = "0"; return; }
  const d = els.player.duration || 0;
  if (!d) { els.timelineTooltip.style.opacity = "0"; return; }
  const pct = timelineFracFromEvent(e);
  els.timelineTooltip.textContent = fmt(pct * d);
  els.timelineTooltip.style.left = `${pct * 100}%`;
}

els.timeline.addEventListener("mousedown", (e) => {
  if (!els.player.src || pvMode) return;   // raw timeline is disabled in preview
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
  // The preview plan bakes in the slow-mo rate — changing it invalidates the
  // plan (segment rates/durations), so leave preview like structural edits do.
  if (pvMode) pvExit();
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
      // Adding/removing a slow-mo replay changes the segment plan — leave
      // preview (same policy as structural edits) instead of playing stale.
      if (pvMode) pvExit();
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
  cancelSourceReady();
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
    selectVideo(clip.video);                       // invalidates older callbacks
    onSourceReady(() => _playClipRange(clip));
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
  // Wall-clock fallback: scale by the playback rate, otherwise previewing at
  // 0.25-0.5× would be cut off partway through.
  const rate = els.player.playbackRate || 1;
  previewWatchdog = setTimeout(() => {
    els.player.pause();
    clearSingleClipPreview();
  }, ((clip.end - clip.start) / rate) * 1000 + 1500);
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
  cancelSourceReady();   // drop a pending cross-source segment start, if any
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
  els.musicPanel.classList.remove("hidden");  // music strip too — audition the mix here
  renderMusicPanel();
  els.previewOutputBtn.classList.add("active");
  els.previewOutputBtn.textContent = "■ Stop preview";
  els.timeline.classList.add("pv-disabled");   // raw scrubber off; use the output timeline
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
  els.musicPanel.classList.add("hidden");
  // Stop any music audition and restore the player's own audio level.
  musicAuditioning = false;
  if (els.musicAudio) els.musicAudio.pause();
  els.player.volume = effectivePlayerVolume();
  updateAuditionBtn();
  els.previewOutputBtn.classList.remove("active");
  els.previewOutputBtn.textContent = "▶ Preview output";
  els.timeline.classList.remove("pv-disabled");
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
    syncPlayButtons();
  };
  if (seg.video && seg.video !== currentVideo) {
    pvSwitching = true;
    selectVideo(seg.video);                        // invalidates older callbacks
    onSourceReady(() => { if (pvMode) begin(); });
  } else {
    begin();
  }
  pvUpdateBar();
}

function pvAttachWatch(seg) {
  const watcher = () => {
    if (els.player.paused) return;   // ignore seek-driven timeupdates while paused
    if ((els.player.currentTime || 0) >= seg.end - 0.03) {
      pvAdvance();
    } else {
      pvUpdateBar();
    }
  };
  pvWatcher = watcher;
  els.player.addEventListener("timeupdate", watcher);
  pvArmWatchdog(seg);
}

// Wall-clock fallback that auto-advances to the next segment. Only armed while
// actually PLAYING — otherwise a paused scrub/seek into a segment would
// schedule a spurious jump, which felt like the timeline "jerking".
function pvArmWatchdog(seg) {
  if (pvWatchdog) { clearTimeout(pvWatchdog); pvWatchdog = null; }
  if (!pvMode || !seg || els.player.paused) return;
  // A real segment plays in srcDur seconds, a slow one in srcDur/rate = outDur.
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
  syncPlayButtons();
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

// Coalesced scrub for dragging the output timeline: while a seek is still in
// flight, just remember the latest target instead of queuing more seeks (a
// 2.6K/60fps source can't decode a new keyframe per mousemove) — the pending
// one is applied when the current seek finishes. Keeps the scrub smooth.
let pvSeekPending = null;
function pvScrubTo(T) {
  if (els.player.seeking) { pvSeekPending = T; return; }
  pvSeekToOutput(T);
}
els.player.addEventListener("seeked", () => {
  if (pvSeekPending == null) return;
  const t = pvSeekPending;
  pvSeekPending = null;
  pvScrubTo(t);
});

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
  syncMusicPlayback();
}

function pvSyncPlayBtn() {
  els.pvPlay.textContent = els.player.paused ? "▶" : "❚❚";
}

// ---- Background music ----------------------------------------------
// One global track mixed onto the final output. The strip lives in the
// preview context (like the text panel); while previewing, the track is
// slaved to the assembled output so the mix can be auditioned live.

async function loadMusicLibrary() {
  let loaded = false;
  try {
    const res = await fetch("/api/music");
    const data = await res.json();
    musicTracks = Array.isArray(data.tracks) ? data.tracks : [];
    loaded = true;
  } catch (e) { musicTracks = []; }
  // Drop a stored selection whose file was removed from the library — but only
  // when the library actually loaded; a transient fetch failure (server still
  // starting up) must not wipe the user's saved choice.
  if (loaded && music.track && !musicTracks.some(t => t.file === music.track)) music.track = "";
  renderMusicPanel();
  refreshRenderSummary();
}

function selectedTrack() { return musicTracks.find(t => t.file === music.track) || null; }

// Estimated output duration in seconds (intro excluded — matches the preview
// timeline). Used to draw the music lane's fade ramps when not previewing.
function outputDurationSecs() {
  if (pvMode && pvTotal) return pvTotal;
  const factor = 100 / (parseInt(els.slowSlider.value, 10) || 50);
  let total = 0;
  clips.forEach(c => {
    const d = Math.max(0, c.end - c.start);
    total += d + (c.slowmo !== false ? d * factor : 0);
  });
  return total;
}

function renderMusicPanel() {
  const sel = els.musicTrack;
  if (sel) {
    sel.innerHTML = "";
    const none = document.createElement("option");
    none.value = ""; none.textContent = "— No music —";
    sel.appendChild(none);
    musicTracks.forEach(t => {
      const o = document.createElement("option");
      o.value = t.file;
      o.textContent = t.name + (t.duration ? ` (${fmtClock(t.duration)})` : "");
      sel.appendChild(o);
    });
    sel.value = music.track || "";
  }
  if (els.musicVol) { els.musicVol.value = Math.round(music.volume * 100); els.musicVolVal.textContent = `${Math.round(music.volume * 100)}%`; }
  if (els.origVol) { els.origVol.value = Math.round(music.originalVolume * 100); els.origVolVal.textContent = `${Math.round(music.originalVolume * 100)}%`; }
  if (els.musicFadeIn) els.musicFadeIn.value = music.fadeIn;
  if (els.musicFadeOut) els.musicFadeOut.value = music.fadeOut;
  if (els.musicLoop) els.musicLoop.checked = music.loop;
  if (els.musicDuck) els.musicDuck.checked = music.duck;

  // Keep the <audio> element's source in step with the chosen track. Guard on
  // the *resolved* track (empty until the library has loaded) so the src is set
  // once the track actually exists, not prematurely when only the id is known.
  const tr = selectedTrack();
  const a = els.musicAudio;
  if (a) {
    const wantTrack = tr ? music.track : "";
    if ((a.getAttribute("data-track") || "") !== wantTrack) {
      a.src = tr ? encodeURI(tr.url) : "";
      a.setAttribute("data-track", wantTrack);
      musicAuditioning = false;
    }
    a.loop = music.loop;
  }
  renderMusicLane();
  updateAuditionBtn();
}

function renderMusicLane() {
  const fill = els.musicLaneFill;
  if (!fill) return;
  const tr = selectedTrack();
  if (!tr) {
    fill.className = "music-lane-fill empty";
    fill.style.background = "";
    fill.textContent = "No music — pick a track to add a soundtrack";
    return;
  }
  fill.className = "music-lane-fill";
  const total = outputDurationSecs();
  const fi = total > 0 ? Math.min(0.45, music.fadeIn / total) : 0;
  const fo = total > 0 ? Math.min(0.45, music.fadeOut / total) : 0;
  const a = (fi * 100).toFixed(1), b = (100 - fo * 100).toFixed(1);
  fill.style.background =
    `linear-gradient(90deg, rgba(56,139,253,0.12) 0%, #388bfd ${a}%, #1f6feb ${b}%, rgba(31,111,235,0.12) 100%)`;
  fill.textContent = `${tr.name}${music.loop ? " · loops" : ""}${music.duck ? " · duck" : ""}`;
}

function updateAuditionBtn() {
  if (els.musicClearBtn) els.musicClearBtn.classList.toggle("hidden", !music.track);
  if (!els.musicAuditionBtn) return;
  els.musicAuditionBtn.disabled = !selectedTrack();
  els.musicAuditionBtn.textContent = musicAuditioning ? "■ Stop" : "▶ Audition";
}

// Standalone "listen to the track" toggle (pauses the video to avoid double audio).
function toggleAudition() {
  const a = els.musicAudio;
  if (!selectedTrack() || !a) { flashTopMessage("Pick a music track first"); return; }
  if (musicAuditioning) {
    musicAuditioning = false;
    a.pause();
  } else {
    if (pvMode && !els.player.paused) els.player.pause();
    musicAuditioning = true;
    a.loop = music.loop;
    a.volume = Math.min(1, music.volume);
    try { a.currentTime = 0; } catch (e) { /* not seekable yet */ }
    a.play().catch(() => {});
  }
  updateAuditionBtn();
}

// Clear the chosen track (the "Remove music" button). Mirrors picking
// "— No music —", but as one obvious click. Stops any audition first.
function clearMusic() {
  if (musicAuditioning && els.musicAudio) els.musicAudio.pause();
  musicAuditioning = false;
  music.track = "";
  renderMusicPanel();
  saveState(); refreshRenderSummary(); syncMusicPlayback();
  flashTopMessage("Background music removed.");
}

// Slave the music element to the preview output while previewing + playing, so
// the mix is heard live. Also applies the original-audio gain to the player.
// Called from pvUpdateBar (frequent) and the play/pause handlers.
function syncMusicPlayback() {
  const a = els.musicAudio;
  if (!a) return;
  els.player.volume = effectivePlayerVolume();
  if (musicAuditioning) { a.volume = Math.min(1, music.volume); return; }
  const tr = selectedTrack();
  if (!pvMode || !tr) { if (!a.paused) a.pause(); return; }
  a.volume = Math.min(1, music.volume);
  a.loop = music.loop;
  if (els.player.paused) { if (!a.paused) a.pause(); return; }
  const dur = a.duration || tr.duration || 0;
  let t = pvOutputPos();
  if (dur > 0) t = music.loop ? (t % dur) : Math.min(t, dur - 0.05);
  if (t >= 0 && Math.abs((a.currentTime || 0) - t) > 0.35) {
    try { a.currentTime = t; } catch (e) { /* ignore */ }
  }
  if (a.paused && (music.loop || (a.currentTime || 0) < dur)) a.play().catch(() => {});
}

// Map the music config to the render payload (null = no music).
function musicPayload() {
  if (!music.track) return null;
  return {
    track: music.track,
    volume: music.volume,
    original_volume: music.originalVolume,
    fade_in: music.fadeIn,
    fade_out: music.fadeOut,
    loop: music.loop,
    duck: music.duck,
  };
}

// Wire the music controls (called once at init).
function wireMusicControls() {
  if (els.musicTrack) els.musicTrack.addEventListener("change", () => {
    music.track = els.musicTrack.value || "";
    musicAuditioning = false;
    renderMusicPanel();
    saveState(); refreshRenderSummary(); syncMusicPlayback();
  });
  if (els.musicAuditionBtn) els.musicAuditionBtn.addEventListener("click", toggleAudition);
  if (els.musicClearBtn) els.musicClearBtn.addEventListener("click", clearMusic);
  if (els.musicVol) els.musicVol.addEventListener("input", () => {
    music.volume = (parseInt(els.musicVol.value, 10) || 0) / 100;
    els.musicVolVal.textContent = `${Math.round(music.volume * 100)}%`;
    saveState(); syncMusicPlayback();
  });
  if (els.origVol) els.origVol.addEventListener("input", () => {
    music.originalVolume = (parseInt(els.origVol.value, 10) || 0) / 100;
    els.origVolVal.textContent = `${Math.round(music.originalVolume * 100)}%`;
    saveState(); syncMusicPlayback();
  });
  if (els.musicFadeIn) els.musicFadeIn.addEventListener("change", () => {
    music.fadeIn = clampNum(parseFloat(els.musicFadeIn.value), 0, 15, 0);
    els.musicFadeIn.value = music.fadeIn; renderMusicLane(); saveState();
  });
  if (els.musicFadeOut) els.musicFadeOut.addEventListener("change", () => {
    music.fadeOut = clampNum(parseFloat(els.musicFadeOut.value), 0, 15, 0);
    els.musicFadeOut.value = music.fadeOut; renderMusicLane(); saveState();
  });
  if (els.musicLoop) els.musicLoop.addEventListener("change", () => {
    music.loop = els.musicLoop.checked;
    if (els.musicAudio) els.musicAudio.loop = music.loop;
    renderMusicLane(); saveState(); syncMusicPlayback();
  });
  if (els.musicDuck) els.musicDuck.addEventListener("change", () => {
    music.duck = els.musicDuck.checked; renderMusicLane(); saveState();
  });
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
  // Slider range = the whole output duration (intro excluded, like the timeline).
  const pvMax = pvTotal > 0 ? roundT(pvTotal) : 0;
  // 3x3 quick-position pad (data-pos = "<row><col>", row t/m/b, col l/c/r).
  const posGrid = `<div class="tx-posgrid" title="Quick position">` +
    [["tl","↖"],["tc","↑"],["tr","↗"],["ml","←"],["mc","⊙"],["mr","→"],["bl","↙"],["bc","↓"],["br","↘"]]
      .map(([p, g]) => `<button class="tx-pos" data-act="pos" data-pos="${p}">${g}</button>`).join("") +
    `</div>`;
  els.textList.innerHTML = "";
  texts.forEach((t) => {
    const noStyle = !!fontSpec(t.font).noStyle;
    const dis = noStyle ? "disabled" : "";
    const row = document.createElement("div");
    row.className = "text-row" + (t.id === selectedTextId ? " selected" : "");
    row.dataset.id = t.id;
    row.innerHTML = `
      <div class="tx-main">
        <textarea class="tx-content" data-field="text" rows="1" placeholder="Text… (Enter = new line)">${escapeAttr(t.text)}</textarea>
        <select class="tx-font" data-field="font" title="Font">${fontOpts(t.font)}</select>
        <button class="tx-style ${t.bold ? "active" : ""}" data-act="bold" ${dis} title="Bold">B</button>
        <button class="tx-style ${t.italic ? "active" : ""}" data-act="italic" ${dis} title="Italic">I</button>
        <label class="tx-field">Size
          <input class="tx-size" data-field="sizePct" type="number" min="1" max="30" step="0.5" value="${t.sizePct}" title="Font size (% of frame height)" />
        </label>
        <input class="tx-color" data-field="color" type="color" value="${t.color}" title="Text color" />
        <span class="tx-spacer"></span>
        <button class="tx-icon" data-act="dup" title="Duplicate">⧉</button>
        <button class="tx-icon" data-act="locate" title="Find on timeline / player">⌖</button>
        <button class="tx-icon tx-del" data-act="del" title="Delete">✕</button>
      </div>
      <div class="tx-style-row">
        ${posGrid}
        <span class="tx-group">
          <button class="tx-toggle ${t.box ? "active" : ""}" data-act="box" title="Background box behind the text">BG</button>
          <input class="tx-color tx-boxcolor" data-field="boxColor" type="color" value="${t.boxColor}" title="Box color" />
          <input class="tx-op" data-field="boxOpacity" type="range" min="0" max="1" step="0.05" value="${t.boxOpacity}" title="Box opacity" />
          <span class="tx-op-readout">${Math.round(t.boxOpacity * 100)}%</span>
        </span>
        <label class="tx-field tx-fade" title="Fade in/out duration (seconds) — 0 = hard cut">Fade
          <input class="tx-num" data-field="fade" type="number" min="0" max="10" step="0.1" value="${t.fade}" />s
        </label>
        <button class="tx-toggle ${t.shadow ? "active" : ""}" data-act="shadow" title="Outline for legibility">Outline</button>
      </div>
      <div class="tx-timing">
        <label class="tx-slider" title="Drag to set when the text appears — full left = from the very start">
          <span class="tx-slabel">Start</span>
          <input type="range" class="tx-range" data-field="start" min="0" max="${pvMax}" step="0.05" value="${t.start != null ? t.start : 0}" />
          <span class="tx-time-readout" data-for="start">${t.start != null ? fmt(t.start) : "start"}</span>
          <button class="tx-icon tx-setpos" data-act="setStart" title="Set start = current preview position">⤓</button>
        </label>
        <label class="tx-slider" title="Drag to set when the text disappears — full right = until the very end">
          <span class="tx-slabel">End</span>
          <input type="range" class="tx-range" data-field="end" min="0" max="${pvMax}" step="0.05" value="${t.end != null ? t.end : pvMax}" />
          <span class="tx-time-readout" data-for="end">${t.end != null ? fmt(t.end) : "end"}</span>
          <button class="tx-icon tx-setpos" data-act="setEnd" title="Set end = current preview position">⤓</button>
        </label>
      </div>
    `;
    els.textList.appendChild(row);
    // Auto-size the (possibly multi-line) text box to its content.
    const ta = row.querySelector("textarea.tx-content");
    if (ta) { ta.style.height = "auto"; ta.style.height = `${ta.scrollHeight}px`; }
  });
  renderTextOverlays();
  renderTextTimeline();
  refreshRenderSummary();
}

function escapeAttr(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// "#rrggbb" + alpha (0..1) -> "rgba(r,g,b,a)" for the WYSIWYG box preview.
function hexToRgba(hex, a) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex || "");
  const n = m ? parseInt(m[1], 16) : 0;
  const al = Math.max(0, Math.min(1, parseFloat(a)));
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${isFinite(al) ? al : 0.45})`;
}

// Pin the overlay layer to the CANVAS' fit rect inside the wrapper (px), so
// label fractions keep meaning "fraction of the final canvas" even when the
// canvas isn't 16:9 (free-aspect crop, odd first source). Inline styles win
// over the stylesheet's inset:0.
function layoutOverlayLayer() {
  const layer = els.textOverlayLayer;
  if (!layer) return;
  const T = canvasFitRect();
  if (!T) {
    // Drop all inline positioning -> the stylesheet's inset:0 takes over.
    layer.style.inset = "";
    layer.style.width = layer.style.height = "";
    return;
  }
  layer.style.inset = "auto";
  layer.style.left = `${T.x.toFixed(2)}px`;
  layer.style.top = `${T.y.toFixed(2)}px`;
  layer.style.width = `${T.w.toFixed(2)}px`;
  layer.style.height = `${T.h.toFixed(2)}px`;
}

// Deterministic word-wrap shared by the preview AND the export. ffmpeg's
// drawtext never wraps, and an absolutely-positioned label wraps wherever the
// browser runs out of room — two different results. So we compute the line
// breaks ourselves (canvas measureText with the same family/weight; Windows
// Arial in the browser is the same arial.ttf ffmpeg draws with) and hand both
// sides text with explicit "\n". Max width = the widest line that still fits
// inside the frame when centred at t.x (the label can only extend to the
// nearer edge), so wrapped text can never leave the picture.
let _measureCtx = null;
const TEXT_WRAP_FRAC = 0.96;   // max line width as a fraction of the canvas width
const TEXT_LINE_HEIGHT = 1.15; // matches .tx-overlay line-height

// Reference canvas (H = 1000 px, W from the canvas aspect) + the 2D context's
// font set for this overlay. Returns {W, H, fontPx}.
function textMeasureSetup(t, ctx) {
  const H = 1000, W = H * canvasAspect();
  const fontPx = (t.sizePct / 100) * H;
  const fs = fontSpec(t.font);
  ctx.font = `${t.italic ? "italic " : ""}${t.bold ? "bold " : ""}${fontPx}px ${fs.css}`;
  return { W, H, fontPx };
}

// Size of the rendered (wrapped) text block as fractions of the canvas —
// used by the position pad so a corner placement keeps the whole block
// inside the frame instead of parking its CENTRE near the edge.
function textBlockSize(t) {
  if (!_measureCtx) _measureCtx = document.createElement("canvas").getContext("2d");
  const ctx = _measureCtx;
  if (!ctx) return { w: 0, h: 0 };
  const { W, H, fontPx } = textMeasureSetup(t, ctx);
  const lines = wrapTextForRender(t).split("\n");
  const wPx = Math.max(0, ...lines.map(l => ctx.measureText(l).width));
  return { w: Math.min(1, wPx / W), h: Math.min(1, (lines.length * fontPx * TEXT_LINE_HEIGHT) / H) };
}

function wrapTextForRender(t) {
  const raw = String(t.text || "");
  if (!raw.trim()) return raw;
  if (!_measureCtx) _measureCtx = document.createElement("canvas").getContext("2d");
  const ctx = _measureCtx;
  if (!ctx) return raw;
  const { W } = textMeasureSetup(t, ctx);
  // A line may run almost the full frame width before it wraps (the user
  // places the block; the preview shows exactly what the export will do).
  const maxW = TEXT_WRAP_FRAC * W;
  const out = [];
  for (const para of raw.split("\n")) {              // keep manual breaks
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(""); continue; }
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
      const cand = `${line} ${words[i]}`;
      if (ctx.measureText(cand).width <= maxW) line = cand;
      else { out.push(line); line = words[i]; }    // over-long words stay whole
    }
    out.push(line);
  }
  return out.join("\n");
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
    el.textContent = wrapTextForRender(t);   // same line breaks as the export
    el.style.left = `${t.x * 100}%`;
    el.style.top = `${t.y * 100}%`;
    el.style.fontFamily = fs.css;
    el.style.fontWeight = t.bold ? 700 : 400;
    el.style.fontStyle = t.italic ? "italic" : "normal";
    el.style.color = t.color;
    el.style.fontSize = `${(t.sizePct / 100) * boxH}px`;
    el.style.whiteSpace = "pre";        // explicit newlines only — never auto-wrap
    el.style.textAlign = "center";
    el.style.textShadow = t.shadow
      ? "0 0 2px #000, 1px 1px 2px #000, -1px -1px 2px #000" : "none";
    if (t.box) {
      el.style.backgroundColor = hexToRgba(t.boxColor, t.boxOpacity);
      const padY = Math.max(2, (t.sizePct / 100) * boxH * 0.18);
      const padX = Math.max(4, (t.sizePct / 100) * boxH * 0.3);
      el.style.padding = `${padY}px ${padX}px`;
    } else {
      el.style.backgroundColor = "transparent";
      el.style.padding = "0";
    }
    layer.appendChild(el);
  });
  syncTextOverlayTiming();
}

// Show an overlay only when the current OUTPUT position falls inside its time
// window — so the player is a faithful preview of that frame, whether playing
// OR paused. Exception: the currently-SELECTED text is always shown so it can
// still be dragged/positioned even when the playhead sits outside its window.
// Times are output-relative (same scale as the timeline + pv-time readout);
// the backend adds the intro offset at render. Also moves the timeline playhead.
function syncTextOverlayTiming() {
  const pos = (pvMode && pvPlan.length) ? pvOutputPos() : null;
  els.textOverlayLayer.querySelectorAll(".tx-overlay").forEach((node) => {
    const t = texts.find(x => String(x.id) === node.dataset.id);
    if (!t) return;
    let visible = true;
    // Visibility strictly follows the time window so the player mirrors the
    // current frame. Only a label being edited inline is force-shown (selecting
    // a text instead moves the playhead to its start — see selectText).
    if (pos !== null && t.id !== txEditId) {
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

// Clone a text (style + timing) right below the original, nudged down a touch
// so the copy isn't hidden under it.
function duplicateText(id) {
  const src = texts.find(t => t.id === id);
  if (!src) return;
  const copy = normalizeText({ ...src, id: nextTextId++ });
  copy.y = clampNum(src.y + 0.06, 0, 1, src.y);
  const idx = texts.findIndex(t => t.id === id);
  texts.splice(idx + 1, 0, copy);
  selectedTextId = copy.id;
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
  // Move the output playhead to this text's start so the preview shows exactly
  // it (others outside their window hide). Skip if already inside its window
  // (so editing fields on an already-revealed text doesn't keep re-seeking).
  const t = texts.find(x => x.id === id);
  if (t && pvMode && pvPlan.length && pvTotal > 0) {
    const s = t.start != null ? t.start : 0;
    const e = t.end != null ? t.end : pvTotal;
    const pos = pvOutputPos();
    if (pos < s || pos > e) pvSeekToOutput(s);
  }
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
  // Empty area / ruler -> scrub the output, preserving the play state: seek to
  // the clicked point and keep playing if it was playing (pvSeekToOutput reads
  // wasPlaying), or stay put if paused.
  e.preventDefault();
  tlDrag = { mode: "seek", rect };
  pvScrubTo(tlTimeFromX(e.clientX, rect));
});

window.addEventListener("mousemove", (e) => {
  if (!tlDrag) return;
  if (tlDrag.mode === "seek") { pvScrubTo(tlTimeFromX(e.clientX, tlDrag.rect)); return; }
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
  // Start/End range sliders: update live as you drag. The final value is
  // committed (and a slider parked at the very edge snapped to "open") on
  // `change`. Keep start < end throughout the drag.
  if (field === "start" || field === "end") {
    let v = roundT(parseFloat(input.value));
    if (!isFinite(v)) return;
    if (field === "start") {
      const eMax = (t.end != null ? t.end : pvTotal) - 0.1;
      v = Math.max(0, Math.min(v, eMax));
    } else {
      const sMin = (t.start != null ? t.start : 0) + 0.1;
      v = Math.min(pvTotal, Math.max(v, sMin));
    }
    input.value = v;
    t[field] = v;
    const ro = input.parentElement.querySelector(".tx-time-readout");
    if (ro) ro.textContent = fmt(v);
    renderTextTimeline();   // live-move the bar on the CapCut timeline
    renderTextOverlays();   // show/hide the player label by the new window
    return;
  }
  if (field === "font") {
    t.font = input.value;
    if (fontSpec(t.font).noStyle) { t.bold = false; t.italic = false; }
    renderTextList();   // refresh Bold/Italic enabled state for the new family
    saveState();
    return;
  }
  if (field === "boxOpacity") {
    t.boxOpacity = clampNum(input.value, 0, 1, 0.45);
    const ro = input.parentElement.querySelector(".tx-op-readout");
    if (ro) ro.textContent = `${Math.round(t.boxOpacity * 100)}%`;
    renderTextOverlays();
    saveState();
    return;
  }
  if (field === "boxColor") { t.boxColor = input.value; renderTextOverlays(); saveState(); return; }
  if (field === "fade") { t.fade = clampNum(input.value, 0, 10, 0); renderTextOverlays(); saveState(); return; }
  if (field === "text") {
    t.text = input.value;
    if (input.tagName === "TEXTAREA") { input.style.height = "auto"; input.style.height = `${input.scrollHeight}px`; }
    renderTextTimeline();
  }
  else if (field === "sizePct") t.sizePct = clampNum(input.value, 1, 30, t.sizePct);
  else if (field === "color") t.color = input.value;
  renderTextOverlays();
  saveState();
});
// Commit a start/end slider when the drag ends (`change` fires on release).
// A slider parked at its far edge means "open" (start=0 -> from the very
// start; end=pvTotal -> until the very end); both open = whole video. This
// mirrors the CapCut-timeline snap so the two stay consistent.
els.textList.addEventListener("change", (e) => {
  const input = e.target.closest("input.tx-range[data-field]");
  if (!input) return;
  const id = parseInt(input.closest(".text-row").dataset.id, 10);
  const t = texts.find(x => x.id === id);
  if (!t) return;
  if (t.start != null && t.start <= 0.05) t.start = null;
  if (t.end != null && t.end >= pvTotal - 0.05) t.end = null;
  renderTextList();   // rebuild rows + timeline with the snapped values
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
  if (act === "del") return removeText(id);
  if (act === "locate") return selectText(id);
  if (act === "dup") return duplicateText(id);
  if (act === "bold" || act === "italic") {
    if (fontSpec(t.font).noStyle) return;   // family has no bold/italic
    t[act] = !t[act];
    btn.classList.toggle("active", t[act]);
    renderTextOverlays();
    saveState();
    return;
  }
  if (act === "box" || act === "shadow") {
    t[act] = !t[act];
    btn.classList.toggle("active", t[act]);
    renderTextOverlays();
    saveState();
    return;
  }
  if (act === "pos") {
    const p = btn.dataset.pos;  // "<row><col>", row t/m/b, col l/c/r
    // Place the block so its EDGE sits `m` from the frame edge (x/y are the
    // centre, so offset by half the measured block size) — a wide title sent
    // to a corner stays fully inside the picture.
    const m = 0.03;
    const { w, h } = textBlockSize(t);
    const yMap = { t: m + h / 2, m: 0.5, b: 1 - m - h / 2 };
    const xMap = { l: m + w / 2, c: 0.5, r: 1 - m - w / 2 };
    t.y = Math.max(h / 2, Math.min(1 - h / 2, yMap[p[0]]));
    t.x = Math.max(w / 2, Math.min(1 - w / 2, xMap[p[1]]));
    renderTextOverlays();
    saveState();
    return;
  }
  if (act === "setStart" || act === "setEnd") {
    if (!pvMode || pvTotal <= 0) { flashTopMessage("Play the preview to grab a position"); return; }
    const pos = roundT(Math.max(0, Math.min(pvTotal, pvOutputPos())));
    if (act === "setStart") {
      t.start = pos <= 0.05 ? null : pos;
      if (t.start != null && t.end != null && t.end - t.start < 0.1) t.start = Math.max(0, t.end - 0.1);
    } else {
      t.end = pos >= pvTotal - 0.05 ? null : pos;
      if (t.start != null && t.end != null && t.end - t.start < 0.1) t.end = Math.min(pvTotal, t.start + 0.1);
    }
    renderTextList();
    renderTextOverlays();
    saveState();
    return;
  }
});
// Selecting a row's text input highlights its overlay
els.textList.addEventListener("focusin", (e) => {
  const row = e.target.closest(".text-row");
  if (!row) return;
  const id = parseInt(row.dataset.id, 10);
  // Always (re)reveal — selectText seeks to the text's start only if the
  // playhead is outside its window, so focusing fields on an already-revealed
  // text is a no-op but clicking a text whose moment has passed re-reveals it.
  selectText(id);
});

els.addTextBtn.addEventListener("click", addText);

// ---- Drag a label on the player to reposition it --------------------
let txDrag = null;  // {id, el}
els.textOverlayLayer.addEventListener("mousedown", (e) => {
  const el = e.target.closest(".tx-overlay");
  if (!el) return;
  if (el.classList.contains("editing")) return;  // inline editing — let the mouse select text
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
  let x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  let y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
  // Snap to the centre lines (hold Shift to position freely).
  if (!e.shiftKey) {
    if (Math.abs(x - 0.5) < 0.02) x = 0.5;
    if (Math.abs(y - 0.5) < 0.02) y = 0.5;
  }
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

// ---- Double-click a label on the player to edit its text inline -----
// The overlay becomes contenteditable in place; Enter (or click away / Esc)
// commits, Shift+Enter adds a line. While editing, dragging is suppressed so
// the mouse can place the caret / select text.
els.textOverlayLayer.addEventListener("dblclick", (e) => {
  const el = e.target.closest(".tx-overlay");
  if (!el) return;
  e.preventDefault();
  startInlineEdit(parseInt(el.dataset.id, 10), el);
});

function startInlineEdit(id, el) {
  if (txDrag) { txDrag.el.classList.remove("dragging"); txDrag = null; }
  selectedTextId = id;
  txEditId = id;
  el.classList.add("editing");
  const t = texts.find(x => x.id === id);
  if (t) el.textContent = t.text;     // raw text: auto-wrap breaks are display-only
  try { el.contentEditable = "plaintext-only"; }
  catch (_) { el.contentEditable = "true"; }
  el.focus();
  // Select all existing text so typing replaces it.
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  els.textList.querySelectorAll(".text-row").forEach(r =>
    r.classList.toggle("selected", parseInt(r.dataset.id, 10) === id));
}

function commitInlineEdit() {
  if (txEditId == null) return;
  const el = els.textOverlayLayer.querySelector(`.tx-overlay[data-id="${txEditId}"]`);
  const t = texts.find(x => x.id === txEditId);
  if (el && t) {
    t.text = el.innerText.replace(/\n$/, "");   // drop the trailing-<br> artifact
    el.contentEditable = "false";
    el.classList.remove("editing");
  }
  txEditId = null;
  renderTextList();      // refresh the row's textarea + timeline bar label
  renderTextOverlays();  // normalize the overlay (size / box / time window)
  saveState();
}

// Live-sync the edited text into the row + timeline without rebuilding the
// layer (which would blow away the element being edited).
els.textOverlayLayer.addEventListener("input", (e) => {
  if (txEditId == null) return;
  const el = e.target.closest(".tx-overlay");
  if (!el) return;
  const t = texts.find(x => x.id === txEditId);
  if (!t) return;
  t.text = el.innerText.replace(/\n$/, "");
  const ta = els.textList.querySelector(`.text-row[data-id="${txEditId}"] textarea.tx-content`);
  if (ta) { ta.value = t.text; ta.style.height = "auto"; ta.style.height = `${ta.scrollHeight}px`; }
  renderTextTimeline();
});
els.textOverlayLayer.addEventListener("keydown", (e) => {
  if (txEditId == null) return;
  if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey)) {
    e.preventDefault();
    // Don't let the Escape bubble to the document handler — it would also
    // exit the whole preview instead of just committing this inline edit.
    e.stopPropagation();
    commitInlineEdit();
  }
});
// Commit when focus leaves the editable label (focusout bubbles; blur doesn't).
els.textOverlayLayer.addEventListener("focusout", () => {
  if (txEditId != null) commitInlineEdit();
});

// Keep overlay font sizes correct when the player box resizes.
window.addEventListener("resize", () => {
  applyPlayerCrop();          // px-based transform tracks the wrapper size
  layoutOverlayLayer();
  if (cropEditing) positionCropRegion();
  if (texts.length) renderTextOverlays();
});

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
  const mTrack = selectedTrack();
  const musicLabel = (music.track && mTrack) ? ` • 🎵 <b>${mTrack.name}</b>` : "";
  els.renderSummary.innerHTML = `
    <b>${clips.length}</b> events (<b>${slowCount}</b> with slow-mo ${slow}%, ${factor.toFixed(2)}×)${srcLabel}${txtLabel}${musicLabel} •
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
      text: wrapTextForRender(t), font: t.font, bold: !!t.bold, italic: !!t.italic,
      size_pct: t.sizePct, color: t.color,
      x: t.x, y: t.y, start: t.start, end: t.end, shadow: t.shadow !== false,
      box: !!t.box, box_color: t.boxColor, box_opacity: t.boxOpacity, fade: t.fade,
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
    clips: clips.map(c => ({ start: c.start, end: c.end, slowmo: c.slowmo !== false, video: c.video || "", brightness: getBrightness(c.video), color: getColorParams(c.video), crop: getCrop(c.video) })),
    brightness_all: brightnessAll,
    brightness_auto: brightnessAuto,
    source_modes: { ...sourceMode },
    source_stats: { ...sourceStats },
    texts: texts.map(t => ({
      text: t.text, font: t.font, bold: !!t.bold, italic: !!t.italic,
      sizePct: t.sizePct, color: t.color,
      x: t.x, y: t.y, start: t.start, end: t.end, shadow: t.shadow !== false,
      box: !!t.box, boxColor: t.boxColor, boxOpacity: t.boxOpacity, fade: t.fade,
    })),
    music: { ...music },
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
  // Rebuild the per-source brightness + crop maps from the clips' stored
  // values (old projects without `brightness`/`crop` -> no adjustment).
  sourceAdjust = {};
  sourceCrop = {};
  (p.clips || []).forEach(c => {
    const src = c.video || p.video || "";
    setBrightness(src, c.brightness);
    if (c.crop) setCrop(src, c.crop);
  });
  // "Apply to all" brightness (old projects without it -> per-source mode).
  brightnessAll = typeof p.brightness_all === "number" ? clampBrightness(p.brightness_all) : null;
  if (brightnessAll !== null) sourceAdjust = {};
  sourceStats = normalizeStatsMap(p.source_stats);
  brightnessAuto = p.brightness_auto === true && brightnessAll === null;
  sourceMode = normalizeModeMap(p.source_modes);
  if (brightnessAuto) ensureAllAutoLevels();
  // Text overlays (old projects without `texts` -> none).
  texts = (p.texts || []).map(normalizeText);
  selectedTextId = null;
  // Background music (old projects without `music` -> none).
  music = normalizeMusic(p.music);
  renderMusicPanel();
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

// Start from scratch: wipe every per-project field (events, text, music) and
// disconnect the source video, so a fresh session has nothing carried over from
// the previous project / the persisted localStorage state.
function newProject() {
  const hasWork = clips.length || texts.length || music.track || currentVideo;
  if (hasWork && !confirm("Start a new project? This clears the current events, text overlays, music and source video. (Save first if you want to keep them.)")) return;

  if (pvMode) pvExit();

  // Setup fields back to their defaults.
  els.tournament.value = "";
  els.player1.value = "";
  els.player2.value = "";
  els.introSeconds.value = 4;
  els.slowSlider.value = 50; updateSlowLabel();
  outHeight = 0;

  // Clear all per-project collections.
  clips = [];
  texts = []; selectedTextId = null; txEditId = null;
  music = normalizeMusic({});
  musicAuditioning = false;
  clipUndoStack = [];
  sourceAdjust = {};
  brightnessAll = null;
  brightnessAuto = false;
  sourceMode = {};
  sourceStats = {};
  sourceCrop = {};

  // Project name + selection.
  els.projectName.value = "";
  els.projectSelect.value = "";
  updateProjectButtons();

  // Disconnect the source video (also re-renders overlays / resolution list).
  selectVideo("");

  // Repaint everything that depends on the cleared state.
  renderMusicPanel();
  renderTextList();
  renderClipsTable();
  refreshResolutionOptions();
  updateUndoBtn();
  refreshRenderSummary();
  saveState();
  flashTopMessage("Started a new project.");
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
// One export at a time: a second concurrent job would hijack the progress UI
// (Cancel then only reaches the newest job) and two same-second exports could
// even write the same output filename.
let renderBusy = false;
function guardRenderBusy() {
  if (renderBusy) {
    flashTopMessage("An export is already running — wait or cancel it first");
    return true;
  }
  renderBusy = true;
  return false;
}

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
  // Under "auto for all", sources never shown in the player may still be
  // waiting for their level — finish that before taking the busy flag
  // (guardRenderBusy both checks and sets it, so it must run once).
  await ensureAllAutoLevels();
  if (guardRenderBusy()) return;
  els.renderBtn.disabled = true;
  els.cancelBtn.disabled = false;
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
      brightness: getBrightness(clipVideo),
      color: getColorParams(clipVideo),
      crop: getCrop(clipVideo),
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
  // Under "auto for all", sources never shown in the player may still be
  // waiting for their level — finish that before taking the busy flag
  // (guardRenderBusy both checks and sets it, so it must run once).
  await ensureAllAutoLevels();
  if (guardRenderBusy()) return;
  els.renderBtn.disabled = true;
  els.cancelBtn.disabled = false;
  els.progressBox.classList.remove("hidden");
  els.resultBox.classList.add("hidden");
  els.progressFill.style.width = "0%";
  els.progressFill.style.background = "";
  els.progressPct.textContent = "0%";
  els.progressStage.textContent = "Initializing…";
  els.progressMsg.textContent = "";

  try {
    const body = {
      video: currentVideo || (clips[0] && clips[0].video) || "",
      clips: clips.map(c => ({ start: c.start, end: c.end, slowmo: c.slowmo !== false, video: c.video, brightness: getBrightness(c.video), color: getColorParams(c.video), crop: getCrop(c.video) })),
      slow_percent: parseInt(els.slowSlider.value, 10),
      intro_seconds: parseFloat(els.introSeconds.value || "0"),
      tournament: els.tournament.value,
      player1: els.player1.value,
      player2: els.player2.value,
      out_height: outHeight || 0,
      texts: textsPayload(),
      music: musicPayload(),
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
      } else if (p.status === "cancelled") {
        es.close(); currentEventSource = null;
        showRenderCancelled();
      } else if (p.status === "error") {
        es.close(); currentEventSource = null;
        showRenderError(p.error || p.message || "Unknown error");
      }
    } catch (e) { /* ignore */ }
  };
  es.onerror = () => {
    // Transient drops auto-retry (readyState CONNECTING). A CLOSED stream
    // never retries — e.g. the dev server restarted mid-render and the job
    // registry is gone (404) — so resolve the UI instead of hanging forever.
    if (es.readyState !== EventSource.CLOSED) return;
    if (currentEventSource === es) currentEventSource = null;
    resolveJobAfterStreamLoss(jobId);
  };
}

// The progress stream died for good: poll the job once and settle the UI —
// show the final state if the job finished, re-attach if it's still running,
// or surface an error if the job is gone (server restart kills the render).
async function resolveJobAfterStreamLoss(jobId) {
  if (currentJobId !== jobId) return;   // a newer job took over the UI
  try {
    const res = await fetch(`/api/job/${jobId}`);
    if (res.ok) {
      const p = await res.json();
      if (p.status === "done") return showResult(p.output_file);
      if (p.status === "cancelled") return showRenderCancelled();
      if (p.status === "error") return showRenderError(p.error || p.message || "Render failed");
      setTimeout(() => { if (currentJobId === jobId) listenProgress(jobId); }, 1000);
      return;
    }
  } catch (e) { /* server unreachable — fall through */ }
  showRenderError("Render job lost (server restarted?) — check the output folder, then export again.");
}

function showResult(filename) {
  renderBusy = false;
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
  renderBusy = false;
  els.progressStage.textContent = "❌ Error";
  els.progressMsg.textContent = msg;
  els.progressFill.style.background = "linear-gradient(90deg, #d83a3a 0%, #ff7a4a 100%)";
  els.renderBtn.disabled = false;
  els.cancelBtn.disabled = false;
}

// A clean cancel: hide the progress box and return to a ready state so the user
// can adjust and re-export (not a failure — no red error left on screen).
function showRenderCancelled() {
  renderBusy = false;
  els.progressBox.classList.add("hidden");
  els.progressFill.style.background = "";
  els.progressFill.style.width = "0%";
  els.renderBtn.disabled = false;
  els.cancelBtn.disabled = false;
  currentJobId = null;
  flashTopMessage("Export cancelled.");
}

async function cancelRender() {
  if (!currentJobId) return;
  // Immediate feedback — the backend kills ffmpeg within a beat, then the SSE
  // "cancelled" status resets the UI via showRenderCancelled().
  els.cancelBtn.disabled = true;
  els.progressStage.textContent = "Cancelling…";
  els.progressMsg.textContent = "";
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
  if (fsFallback) toggleFullscreen();   // mirrors the browser: Esc leaves fullscreen first
  else if (cropEditing) exitCropMode(false);
  else if (!els.browseModal.classList.contains("hidden")) closeBrowse();
  else if (pvMode) pvExit();
});

els.slowSlider.addEventListener("input", updateSlowLabel);
els.brightSlider.addEventListener("input", (e) => {
  if (brightnessAll === null && !currentVideo) return;
  setBrightnessFromControl(e.target.value);
  // First touch on a source: measure the frame the user is looking at so
  // the derived look fits this footage (re-measure any time with Analyze).
  if (currentVideo && !sourceStats[currentVideo] && !analyzeCurrentFrame()) analyzeWhenPainted();
  applyPlayerBrightness();
  updateBrightnessControl();
  saveState();
});
// ✨ Auto: measure the frame shown (fresh, so it reflects what the user is
// looking at), pick the level that lands the mid-tones on target, and set it
// exactly like a slider move (respects "apply to all"). Still just a level —
// the user can nudge it afterwards.
els.brightAutoBtn.addEventListener("click", () => {
  if (!currentVideo) return;
  if (!analyzeCurrentFrame() && !sourceStats[currentVideo]) {
    flashTopMessage("Pause the player on a representative (not black) frame first");
    return;
  }
  const st = sourceStats[currentVideo];
  const level = autoBrightnessLevel(st);
  setBrightnessFromControl(level);
  if (brightnessAll === null) sourceMode[currentVideo] = "auto";
  applyPlayerBrightness();
  updateBrightnessControl();
  saveState();
  const shown = level > 0 ? `+${level}%` : `${level}%`;
  flashTopMessage(level
    ? `Auto brightness: ${shown} (frame mid-tones ${Math.round(st.mean * 100)}% → target ${Math.round(AUTO_TARGET_MEAN * 100)}%)`
    : `Auto brightness: 0% — this frame is already well exposed (mid-tones ${Math.round(st.mean * 100)}%)`);
});
els.brightAnalyze.addEventListener("click", () => {
  if (!currentVideo) return;
  if (analyzeCurrentFrame()) {
    applyPlayerBrightness();
    updateBrightnessControl();
    saveState();
    const st = sourceStats[currentVideo];
    flashTopMessage(`Frame analysed — highlights at ${Math.round(st.p99 * 100)}%, colour ${Math.round(st.sat * 100)}%`);
  } else {
    flashTopMessage("Pause the player on a representative (not black) frame first");
  }
});
// A source that inherits a level (own or "apply to all") but was never
// measured gets measured on its first decoded frame, so a video picked later
// under "apply to all" also gets a look fitted to its own footage.
els.player.addEventListener("loadeddata", () => {
  if (!currentVideo || sourceStats[currentVideo] || !getBrightness(currentVideo)) return;
  analyzeWhenPainted();
});
els.brightReset.addEventListener("click", () => {
  if (brightnessAll === null && !currentVideo) return;
  setBrightnessFromControl(0);
  applyPlayerBrightness();
  updateBrightnessControl();
  saveState();
});
els.brightAll.addEventListener("change", (e) => {
  setBrightnessAllMode(e.target.checked);
  applyPlayerBrightness();
  updateBrightnessControl();
  saveState();
});
els.brightAutoAll.addEventListener("change", (e) => {
  setBrightnessAutoMode(e.target.checked);
  applyPlayerBrightness();
  updateBrightnessControl();
  saveState();
});
els.brightAutoAllText.addEventListener("click", (e) => {
  e.preventDefault();
  els.brightAutoAll.checked = !els.brightAutoAll.checked;
  els.brightAutoAll.dispatchEvent(new Event("change"));
});

// ---- Player volume (preview only) --------------------------------------
function effectivePlayerVolume() {
  return Math.max(0, Math.min(1, playerVolume * (pvMode ? Math.min(1, music.originalVolume) : 1)));
}
function updateVolumeControl() {
  els.volSlider.value = Math.round(playerVolume * 100);
  els.volBtn.textContent = playerVolume === 0 ? "🔇" : playerVolume < 0.5 ? "🔉" : "🔊";
  els.volBtn.title = playerVolume === 0 ? "Unmute" : "Mute";
  els.volSlider.title = `Preview volume ${Math.round(playerVolume * 100)}% (export audio is not affected)`;
  els.player.volume = effectivePlayerVolume();
}
let volumeBeforeMute = 1;
els.volSlider.addEventListener("input", (e) => {
  playerVolume = Math.max(0, Math.min(1, (parseInt(e.target.value, 10) || 0) / 100));
  if (playerVolume > 0) volumeBeforeMute = playerVolume;
  updateVolumeControl();
  saveState();
});
els.volBtn.addEventListener("click", () => {
  if (playerVolume > 0) { volumeBeforeMute = playerVolume; playerVolume = 0; }
  else playerVolume = volumeBeforeMute || 1;
  updateVolumeControl();
  saveState();
});
// ---- Fullscreen (the video box only, like a normal video player) -----
// The WRAPPER goes fullscreen, not the bare <video>: the text-overlay layer,
// the crop preview/editor and the brightness filter all live in (and are
// sized by) the wrapper, so WYSIWYG holds. For the duration, the timeline,
// control bar and preview bar are moved INTO the wrapper as an auto-hiding
// bottom chrome (their listeners travel with the nodes) and moved back on
// exit. Keyboard shortcuts are document-level, so they keep working; Esc is
// consumed by the browser (exits fullscreen only). If the Fullscreen API is
// unavailable or refused, a fixed-position "theatre mode" is used instead.
const fsHome = new Map();   // moved node -> comment marking its original slot
let fsChrome = null;
let fsIdleTimer = null;
let fsFallback = false;
const FS_IDLE_MS = 2500;

function isFullscreen() {
  return document.fullscreenElement === els.playerWrap || fsFallback;
}
function fsMoveIn() {
  if (fsChrome) return;
  fsChrome = document.createElement("div");
  fsChrome.className = "fs-chrome";
  for (const node of [els.previewBar, els.timeline, els.playerControls]) {
    const ph = document.createComment("fs-home");
    node.parentNode.insertBefore(ph, node);
    fsHome.set(node, ph);
    fsChrome.appendChild(node);
  }
  els.playerWrap.appendChild(fsChrome);
}
function fsMoveOut() {
  if (!fsChrome) return;
  for (const [node, ph] of fsHome) ph.parentNode.replaceChild(node, ph);
  fsHome.clear();
  fsChrome.remove();
  fsChrome = null;
}
// Sizes are only right after the fullscreen layout pass -> next frame.
function fsRelayout() {
  requestAnimationFrame(() => {
    applyPlayerCrop();
    layoutOverlayLayer();
    if (cropEditing) positionCropRegion();
    if (texts.length) renderTextOverlays();
  });
}
// Show the chrome and re-arm the idle timer (never hides while paused or
// while the pointer rests on the chrome itself).
function fsPoke() {
  els.playerWrap.classList.remove("idle");
  clearTimeout(fsIdleTimer);
  if (!isFullscreen() || els.player.paused) return;
  fsIdleTimer = setTimeout(() => {
    if (isFullscreen() && !els.player.paused && !(fsChrome && fsChrome.matches(":hover"))) {
      els.playerWrap.classList.add("idle");
    }
  }, FS_IDLE_MS);
}
function syncFullscreen() {
  const on = isFullscreen();
  els.playerWrap.classList.toggle("is-fs", on);
  els.playerWrap.classList.toggle("fs-fallback", on && fsFallback);
  if (on) fsMoveIn();
  else { fsMoveOut(); els.playerWrap.classList.remove("idle"); clearTimeout(fsIdleTimer); }
  els.fsBtn.textContent = on ? "⛶ Exit" : "⛶";
  els.fsBtn.title = on ? "Exit fullscreen (F / Esc)" : "Fullscreen (F)";
  els.fsBtn.classList.toggle("active", on);
  fsRelayout();
  if (on) fsPoke();
}
async function toggleFullscreen() {
  els.fsBtn.blur();   // so the next Space plays/pauses instead of re-clicking
  if (isFullscreen()) {
    if (fsFallback) { fsFallback = false; syncFullscreen(); }
    else if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    return;
  }
  if (els.playerWrap.requestFullscreen) {
    try { await els.playerWrap.requestFullscreen(); return; } catch (e) { /* fall through */ }
  }
  fsFallback = true;
  syncFullscreen();
}
document.addEventListener("fullscreenchange", syncFullscreen);
els.fsBtn.addEventListener("click", toggleFullscreen);
els.player.addEventListener("dblclick", toggleFullscreen);
els.playerWrap.addEventListener("mousemove", fsPoke);
els.player.addEventListener("play", fsPoke);
els.player.addEventListener("pause", fsPoke);

// The checkbox sits inside the Brightness <label>, whose implicit control is
// the slider -- so clicking its caption must toggle the box by hand.
els.brightAllText.addEventListener("click", (e) => {
  e.preventDefault();
  els.brightAll.checked = !els.brightAll.checked;
  els.brightAll.dispatchEvent(new Event("change"));
});

// ---- Crop editor ------------------------------------------------------
// A draggable/resizable rectangle over the paused FULL frame. The draft
// lives in source fractions and is only committed on Apply. "Locked" keeps
// the region at the source's own aspect — equal width/height FRACTIONS —
// so an applied crop is a pure zoom+pan (no letterbox). Free aspect (the
// checkbox, or holding Shift) allows any rectangle; the render letterboxes.
let cropDraft = null;   // {x,y,w,h} fractions of the source frame
let cropDrag = null;    // {mode:"move"|handle, mx, my, start:{...}}

function positionCropRegion() {
  const C = videoContentRect();
  if (!C || !cropDraft) return;
  const r = els.cropRegion.style;
  r.left = `${(C.x + cropDraft.x * C.w).toFixed(1)}px`;
  r.top = `${(C.y + cropDraft.y * C.h).toFixed(1)}px`;
  r.width = `${(cropDraft.w * C.w).toFixed(1)}px`;
  r.height = `${(cropDraft.h * C.h).toFixed(1)}px`;
}

function enterCropMode() {
  if (!currentVideo) return;
  if (pvMode) pvExit();               // editing mid-preview would be ambiguous
  if (!videoContentRect()) {
    flashTopMessage("Video is still loading — try again in a moment");
    return;
  }
  els.player.pause();
  cropEditing = true;
  applyPlayerCrop();                  // clears the zoom -> full frame visible
  const c = getCrop(currentVideo);
  cropDraft = c ? { ...c } : { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
  els.cropFree.checked = !!c && Math.abs(c.w - c.h) > 0.001;
  els.cropEditor.classList.remove("hidden");
  positionCropRegion();
}

function exitCropMode(commit) {
  if (!cropEditing) return;
  if (commit) setCrop(currentVideo, cropDraft);
  cropEditing = false;
  cropDraft = null;
  cropDrag = null;
  els.cropEditor.classList.add("hidden");
  applyPlayerCrop();
  updateCropControl();
  if (commit) {
    refreshResolutionOptions();       // effective height may have changed
    layoutOverlayLayer();
    renderTextOverlays();
    refreshRenderSummary();
    saveState();
  }
}

// Resize the draft by a handle drag. fx/fy = mouse delta in source fractions;
// s = rect at drag start. Locked = equal w/h fractions (source aspect).
function resizeCropDraft(hdl, fx, fy, locked, s) {
  let L = s.x, T = s.y, R = s.x + s.w, B = s.y + s.h;
  if (hdl.includes("w")) L = Math.min(Math.max(0, L + fx), R - MIN_CROP_FRAC);
  if (hdl.includes("e")) R = Math.max(Math.min(1, R + fx), L + MIN_CROP_FRAC);
  if (hdl.includes("n")) T = Math.min(Math.max(0, T + fy), B - MIN_CROP_FRAC);
  if (hdl.includes("s")) B = Math.max(Math.min(1, B + fy), T + MIN_CROP_FRAC);
  if (locked) {
    const horiz = hdl === "e" || hdl === "w";
    const vert = hdl === "n" || hdl === "s";
    let v = horiz ? (R - L) : vert ? (B - T)
      : (Math.abs(fx) > Math.abs(fy) ? (R - L) : (B - T));
    if (horiz || vert) {
      // Edge handle: size the perpendicular axis around its centre.
      const cx = (L + R) / 2, cy = (T + B) / 2;
      if (horiz) v = Math.min(v, 2 * Math.min(cy, 1 - cy));
      else v = Math.min(v, 2 * Math.min(cx, 1 - cx));
      v = Math.max(MIN_CROP_FRAC, v);
      if (horiz) {
        if (hdl === "w") L = R - v; else R = L + v;
        T = cy - v / 2; B = cy + v / 2;
      } else {
        if (hdl === "n") T = B - v; else B = T + v;
        L = cx - v / 2; R = cx + v / 2;
      }
    } else {
      // Corner handle: the opposite corner stays anchored.
      const ax = hdl.includes("w") ? R : L;
      const ay = hdl.includes("n") ? B : T;
      v = Math.min(v,
        hdl.includes("w") ? ax : 1 - ax,
        hdl.includes("n") ? ay : 1 - ay);
      v = Math.max(MIN_CROP_FRAC, v);
      L = hdl.includes("w") ? ax - v : ax; R = L + v;
      T = hdl.includes("n") ? ay - v : ay; B = T + v;
    }
  }
  return { x: L, y: T, w: R - L, h: B - T };
}

els.cropEditor.addEventListener("mousedown", (e) => {
  if (!cropEditing || e.button !== 0) return;
  const hdl = e.target.dataset && e.target.dataset.h;
  const onRegion = e.target === els.cropRegion;
  if (!hdl && !onRegion) return;      // toolbar / empty area
  e.preventDefault();
  cropDrag = { mode: hdl || "move", mx: e.clientX, my: e.clientY, start: { ...cropDraft } };
});
window.addEventListener("mousemove", (e) => {
  if (!cropDrag || !cropEditing) return;
  const C = videoContentRect();
  if (!C) return;
  const fx = (e.clientX - cropDrag.mx) / C.w;
  const fy = (e.clientY - cropDrag.my) / C.h;
  const s = cropDrag.start;
  if (cropDrag.mode === "move") {
    cropDraft = {
      ...s,
      x: Math.max(0, Math.min(1 - s.w, s.x + fx)),
      y: Math.max(0, Math.min(1 - s.h, s.y + fy)),
    };
  } else {
    const locked = !els.cropFree.checked && !e.shiftKey;
    cropDraft = resizeCropDraft(cropDrag.mode, fx, fy, locked, s);
  }
  positionCropRegion();
});
window.addEventListener("mouseup", () => { cropDrag = null; });

els.cropBtn.addEventListener("click", () => {
  if (cropEditing) exitCropMode(false); else enterCropMode();
});
els.cropApply.addEventListener("click", () => exitCropMode(true));
els.cropClear.addEventListener("click", () => {
  cropDraft = null;                   // commit "no crop"
  exitCropMode(true);
});
els.cropCancel.addEventListener("click", () => exitCropMode(false));
// Re-snap to the source aspect when the user locks back.
els.cropFree.addEventListener("change", () => {
  if (!cropEditing || els.cropFree.checked || !cropDraft) return;
  const v = Math.max(MIN_CROP_FRAC, Math.min(cropDraft.w, cropDraft.h));
  const cx = Math.min(Math.max(cropDraft.x + cropDraft.w / 2, v / 2), 1 - v / 2);
  const cy = Math.min(Math.max(cropDraft.y + cropDraft.h / 2, v / 2), 1 - v / 2);
  cropDraft = { x: cx - v / 2, y: cy - v / 2, w: v, h: v };
  positionCropRegion();
});

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
els.newProjectBtn.addEventListener("click", newProject);
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
  // Don't hijack while typing in inputs (incl. an inline-edited overlay label)
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return;
  if (e.target.isContentEditable) return;
  if (e.key === "f" || e.key === "F") { e.preventDefault(); toggleFullscreen(); return; }
  if (cropEditing) return;  // the crop editor owns the keyboard (Esc handled above)

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
  wireMusicControls();
  renderMusicPanel();
  updatePlayBtn();
  updatePickLabel();
  updateUndoBtn();
  updateVolumeControl();
  updateBrightnessControl();
  // Restore the last-used source video into the player, if any.
  if (currentVideo) selectVideo(currentVideo);
  // Sources known from a restored session that still lack an auto level.
  if (brightnessAuto) ensureAllAutoLevels();
  await loadProjectList();
  loadMusicLibrary();   // fetch the library, then refresh the summary
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
