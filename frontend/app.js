// =====================================================================
//  Highlight Creator — frontend logic
// =====================================================================

const $ = (id) => document.getElementById(id);

const els = {
  tournament: $("tournament"),
  player1: $("player1"),
  player2: $("player2"),
  introSeconds: $("introSeconds"),
  videoSelect: $("videoSelect"),
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

  clipsBody: $("clipsBody"),
  clipCount: $("clipCount"),
  clearClips: $("clearClips"),

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
};

// ---- State ----------------------------------------------------------
let clips = [];          // [{id, start, end, slowmo, video}] — each clip carries its source
let captureStart = null; // number | null
let currentVideo = null; // video currently loaded in the player (source for NEW clips)
let videoFps = 30;
let currentJobId = null;
let currentEventSource = null;
let nextClipId = 1;
let outHeight = 0;        // target output height (px); 0 = native source height
const probeCache = {};   // video name -> probe info {width,height,fps,...}

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
      currentVideo,
      clips,
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
  } catch (e) { /* ignore */ }
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

// ---- Video list -----------------------------------------------------
// quiet=true skips the "loading" placeholder and avoids flicker — used when
// silently re-fetching the list as the user opens the dropdown.
async function loadVideos(autoSelect = true, quiet = false) {
  if (!quiet) els.videoSelect.innerHTML = '<option value="">— Đang tải… —</option>';
  try {
    const res = await fetch("/api/videos");
    const data = await res.json();
    els.videoSelect.innerHTML = "";
    if (!data.videos.length) {
      els.videoSelect.innerHTML = `<option value="">(thư mục raw trống — bỏ video vào ${data.raw_dir})</option>`;
      return;
    }
    const opt0 = document.createElement("option");
    opt0.value = ""; opt0.textContent = "— Chọn video —";
    els.videoSelect.appendChild(opt0);
    for (const v of data.videos) {
      const o = document.createElement("option");
      o.value = v.name;
      o.textContent = `${v.name}  (${v.size_mb} MB)`;
      els.videoSelect.appendChild(o);
    }
    // Keep the dropdown showing the current video. Only reload the player when
    // explicitly asked (autoSelect), so a silent refresh doesn't interrupt playback.
    if (currentVideo && data.videos.some(v => v.name === currentVideo)) {
      els.videoSelect.value = currentVideo;
      if (autoSelect) await selectVideo(currentVideo);
    }
  } catch (e) {
    if (!quiet) els.videoSelect.innerHTML = `<option value="">(lỗi tải danh sách)</option>`;
  }
}

// Probe a video's metadata, caching the result so repeated lookups (resolution
// menu, summary) don't re-hit the server.
async function probeVideo(name) {
  if (!name) return null;
  if (probeCache[name]) return probeCache[name];
  try {
    const res = await fetch(`/api/probe/${encodeURIComponent(name)}`);
    const info = await res.json();
    probeCache[name] = info;
    return info;
  } catch (e) {
    return null;
  }
}

async function selectVideo(name) {
  if (!name) {
    els.player.removeAttribute("src");
    els.player.load();
    els.overlay.classList.remove("hidden");
    els.playerInfo.textContent = "Chưa chọn video";
    refreshResolutionOptions();
    return;
  }
  currentVideo = name;
  els.player.src = `/api/stream/${encodeURIComponent(name)}`;
  els.player.playbackRate = parseFloat(els.speedSelect.value) || 1;
  els.player.load();
  els.overlay.classList.add("hidden");
  // Probe for fps / resolution
  const info = await probeVideo(name);
  if (info) {
    videoFps = info.fps || 30;
    els.playerInfo.textContent = `${info.width}×${info.height} @ ${videoFps} fps`;
  } else {
    els.playerInfo.textContent = "";
  }
  refreshResolutionOptions();
  saveState();
}

// The canvas source = first clip's video (run_job uses clip[0] for the canvas),
// or the currently loaded video when no clips exist yet.
function canvasSourceVideo() {
  return (clips[0] && clips[0].video) || currentVideo || "";
}

// Short label for a target height, used in the render summary.
function resShortLabel(h) {
  if (!h) return "gốc";
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
    sel.innerHTML = `<option value="0">Auto — chọn video nguồn</option>`;
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
    o.textContent = srcH ? `Auto · gốc ${srcH}p` : "Auto · gốc";
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
    o.textContent = t.h >= srcH ? `${t.label} · gốc` : t.label;
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
els.player.addEventListener("play",  updatePlayBtn);
els.player.addEventListener("pause", updatePlayBtn);
els.player.addEventListener("ended", updatePlayBtn);

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
  els.slowHint.textContent = `Phát ở ${v}% tốc độ thực (chậm ${factor.toFixed(2)}×)`;
  saveState();
  refreshRenderSummary();
}

// ---- Capture (single toggle button) ---------------------------------
function setCaptureState(active, t = null) {
  if (active) {
    captureStart = t;
    els.highlightBtn.classList.add("recording");
    els.highlightText.textContent = `End highlight @ ${fmt(t)}`;
    els.captureStatus.textContent = `● Đang bắt — start @ ${fmt(t)}`;
  } else {
    captureStart = null;
    els.highlightBtn.classList.remove("recording");
    els.highlightText.textContent = "Highlight start/end";
    els.captureStatus.textContent = "";
  }
}

function markIn() {
  if (!currentVideo) { flashMsg("Hãy chọn video trước"); return; }
  setCaptureState(true, els.player.currentTime || 0);
}

function markOut() {
  if (captureStart === null) return;
  const end = els.player.currentTime || 0;
  if (end <= captureStart + 0.05) {
    flashMsg("Thời điểm kết thúc phải sau thời điểm bắt đầu");
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
function addClip(start, end) {
  if (!currentVideo) { flashTopMessage("Chọn video nguồn trước khi đánh dấu pha"); return; }
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
  [clips[i], clips[j]] = [clips[j], clips[i]];
  renderClipsTable();
  refreshResolutionOptions();  // reorder may change clip[0] = the canvas source
  saveState();
}

function renderClipsTable() {
  els.clipCount.textContent = clips.length;
  if (!clips.length) {
    els.clipsBody.innerHTML = `<tr class="empty"><td colspan="7">Chưa có pha nào. Bấm <b>Highlight start/end</b> để đánh dấu.</td></tr>`;
    refreshRenderSummary();
    return;
  }
  els.clipsBody.innerHTML = "";
  clips.forEach((c, idx) => {
    const tr = document.createElement("tr");
    const checked = c.slowmo === false ? "" : "checked";
    const srcVideo = c.video || "";
    tr.innerHTML = `
      <td class="cell-check">
        <input type="checkbox" data-id="${c.id}" data-field="slowmo" ${checked}
               title="Có slow-motion cho pha này (uncheck = chỉ render real-speed)" />
      </td>
      <td>${idx + 1}</td>
      <td class="src"><span class="src-badge" title="${srcVideo.replace(/"/g, "&quot;")}">${sourceBadge(srcVideo)}</span></td>
      <td><input class="t-input" data-id="${c.id}" data-field="start" value="${fmt(c.start)}" /></td>
      <td><input class="t-input" data-id="${c.id}" data-field="end" value="${fmt(c.end)}" /></td>
      <td class="dur">${(c.end - c.start).toFixed(1)}s</td>
      <td class="actions">
        <button data-act="preview" data-id="${c.id}" title="Preview pha bóng">▶</button>
        <button data-act="up" data-id="${c.id}" title="Lên">↑</button>
        <button data-act="down" data-id="${c.id}" title="Xuống">↓</button>
        <button data-act="del" data-id="${c.id}" class="del" title="Xoá">✕</button>
        <span class="actions-sep"></span>
        <button data-act="export" data-id="${c.id}" class="btn-exp real"
                title="Xuất raw pha này (file riêng, chỉ tốc độ thực)">Export</button>
        <button data-act="exportSlow" data-id="${c.id}" class="btn-exp slow"
                title="Xuất raw + slow-motion replay (badge SLOW MOTION ở góc trên phải)">Export + Replay</button>
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
  clip[field] = v;
  if (clip.end <= clip.start) clip.end = clip.start + 0.5;
  renderClipsTable();
  saveState();
});

let previewWatchdog = null;
function previewClip(clip) {
  if (previewWatchdog) { clearTimeout(previewWatchdog); previewWatchdog = null; }
  // If this clip belongs to a different source than the one loaded, switch the
  // player to that source first, then seek once the new media is ready.
  if (clip.video && clip.video !== currentVideo) {
    const onReady = () => {
      els.player.removeEventListener("loadeddata", onReady);
      _playClipRange(clip);
    };
    els.player.addEventListener("loadeddata", onReady);
    selectVideo(clip.video);
    if (els.videoSelect) els.videoSelect.value = clip.video;
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
      els.player.removeEventListener("timeupdate", watcher);
    }
  };
  els.player.addEventListener("timeupdate", watcher);
  previewWatchdog = setTimeout(() => {
    els.player.pause();
    els.player.removeEventListener("timeupdate", watcher);
  }, (clip.end - clip.start) * 1000 + 1500);
}

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

  if (!clips.length) {
    els.renderSummary.innerHTML = currentVideo
      ? `Sẵn sàng — thêm pha bóng để bật xuất video.`
      : `Chọn video nguồn để bắt đầu.`;
    return;
  }
  const srcLabel = sources.length > 1 ? ` • <b>${sources.length}</b> video nguồn` : "";
  els.renderSummary.innerHTML = `
    <b>${clips.length}</b> pha (<b>${slowCount}</b> có slow-mo ${slow}%, ${factor.toFixed(2)}×)${srcLabel} •
    intro <b>${intro}s</b> →
    real <b>${fmtClock(totalReal)}</b> + slow-mo <b>${fmtClock(totalSlow)}</b> =
    output ≈ <b>${fmtClock(totalOut)}</b> @ <b>${resShortLabel(outHeight)}</b>
  `;
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
  renderClipsTable();
  refreshResolutionOptions();
  // Load the first source into the player so capture/preview has a context.
  const firstSource = (clips[0] && clips[0].video) || p.video || "";
  if (firstSource) {
    const opt = [...els.videoSelect.options].find(o => o.value === firstSource);
    if (opt) {
      els.videoSelect.value = firstSource;
      selectVideo(firstSource);
    } else {
      flashTopMessage(`Video "${firstSource}" không có trong workspace/raw`);
    }
  }
  saveState();
}

async function loadProjectList() {
  try {
    const res = await fetch("/api/projects");
    const data = await res.json();
    const cur = els.projectSelect.value;
    els.projectSelect.innerHTML = '<option value="">— Load project đã lưu —</option>';
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
    flashTopMessage("Nhập tên project trước khi save");
    els.projectName.focus();
    return;
  }
  if (!/^[A-Za-z0-9 _\-\.]{1,80}$/.test(name)) {
    flashTopMessage("Tên project chỉ dùng chữ/số/space/_-. (max 80)");
    return;
  }
  // Confirm overwrite if exists
  const existing = [...els.projectSelect.options].some(o => o.value === name);
  if (existing && !confirm(`Project "${name}" đã tồn tại. Ghi đè?`)) return;

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
    flashTopMessage(`✓ Đã lưu "${name}"`);
    await loadProjectList();
    els.projectSelect.value = name;
    updateProjectButtons();
  } catch (e) {
    flashTopMessage(`Lỗi save: ${e.message || e}`);
  }
}

async function loadProject() {
  const name = els.projectSelect.value;
  if (!name) return;
  if (clips.length && !confirm(`Load "${name}" sẽ thay thế ${clips.length} pha hiện tại. Tiếp tục?`)) return;
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(await res.text());
    const p = await res.json();
    clips = []; // reset before applying
    applyProjectPayload(p);
    els.projectName.value = name;
    flashTopMessage(`✓ Đã load "${name}"`);
  } catch (e) {
    flashTopMessage(`Lỗi load: ${e.message || e}`);
  }
}

async function deleteProject() {
  const name = els.projectSelect.value;
  if (!name) return;
  if (!confirm(`Xoá project "${name}"?`)) return;
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(name)}`, { method: "DELETE" });
    if (!res.ok) throw new Error(await res.text());
    flashTopMessage(`✓ Đã xoá "${name}"`);
    await loadProjectList();
  } catch (e) {
    flashTopMessage(`Lỗi xoá: ${e.message || e}`);
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
    alert("Hãy chọn video trước");
    return;
  }
  if (!(clip.end > clip.start)) {
    alert("Clip không hợp lệ");
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
      alert("Clip không hợp lệ — kiểm tra Start/End.");
      return;
    }
    if (!c.video) {
      alert("Có pha chưa gắn video nguồn — xoá và đánh dấu lại.");
      return;
    }
  }
  els.renderBtn.disabled = true;
  els.progressBox.classList.remove("hidden");
  els.resultBox.classList.add("hidden");
  els.progressFill.style.width = "0%";
  els.progressPct.textContent = "0%";
  els.progressStage.textContent = "Đang khởi tạo…";
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
        showRenderError(p.error || p.message || "Lỗi không xác định");
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
    alert(`Không mở được folder: ${e.message || e}`);
  }
}

function showRenderError(msg) {
  els.progressStage.textContent = "❌ Lỗi";
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
// Auto-refresh the source list each time the dropdown is opened (no manual button).
els.videoSelect.addEventListener("mousedown", () => loadVideos(false, true));
els.videoSelect.addEventListener("change", (e) => selectVideo(e.target.value));
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

els.saveProjectBtn.addEventListener("click", saveProject);
els.loadProjectBtn.addEventListener("click", loadProject);
els.deleteProjectBtn.addEventListener("click", deleteProject);
els.projectSelect.addEventListener("change", updateProjectButtons);
els.projectName.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); saveProject(); }
});

els.clearClips.addEventListener("click", () => {
  if (!clips.length) return;
  if (!confirm("Xoá tất cả các pha?")) return;
  clips = []; renderClipsTable(); refreshResolutionOptions(); saveState();
});

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
  updatePlayBtn();
  await Promise.all([loadVideos(true), loadProjectList()]);
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
