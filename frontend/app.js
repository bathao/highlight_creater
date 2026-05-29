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
  reloadVideos: $("reloadVideos"),
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
  timelineMarkers: $("timelineMarkers"),
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
let clips = [];          // [{id, start, end}]
let captureStart = null; // number | null
let currentVideo = null;
let videoFps = 30;
let currentJobId = null;
let currentEventSource = null;
let nextClipId = 1;

// ---- Persistence ----------------------------------------------------
const STORAGE_KEY = "highlight-creator-state-v1";
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      tournament: els.tournament.value,
      player1: els.player1.value,
      player2: els.player2.value,
      introSeconds: els.introSeconds.value,
      slow: els.slowSlider.value,
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
    if (Array.isArray(s.clips)) {
      clips = s.clips;
      nextClipId = Math.max(0, ...clips.map(c => c.id || 0)) + 1;
    }
    if (s.currentVideo) currentVideo = s.currentVideo;
  } catch (e) { /* ignore */ }
}

// ---- Helpers --------------------------------------------------------
function fmt(seconds) {
  if (!isFinite(seconds) || seconds < 0) return "00:00.00";
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
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
async function loadVideos(autoSelect = true) {
  els.videoSelect.innerHTML = '<option value="">— Đang tải… —</option>';
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
    if (autoSelect && currentVideo && data.videos.some(v => v.name === currentVideo)) {
      els.videoSelect.value = currentVideo;
      await selectVideo(currentVideo);
    }
  } catch (e) {
    els.videoSelect.innerHTML = `<option value="">(lỗi tải danh sách)</option>`;
  }
}

async function selectVideo(name) {
  if (!name) {
    els.player.removeAttribute("src");
    els.player.load();
    els.overlay.classList.remove("hidden");
    els.playerInfo.textContent = "Chưa chọn video";
    return;
  }
  currentVideo = name;
  els.player.src = `/api/stream/${encodeURIComponent(name)}`;
  els.player.playbackRate = parseFloat(els.speedSelect.value) || 1;
  els.player.load();
  els.overlay.classList.add("hidden");
  // Probe for fps / resolution
  try {
    const res = await fetch(`/api/probe/${encodeURIComponent(name)}`);
    const info = await res.json();
    videoFps = info.fps || 30;
    els.playerInfo.textContent = `${info.width}×${info.height} @ ${videoFps} fps`;
  } catch (e) {
    els.playerInfo.textContent = "";
  }
  saveState();
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

function renderTimelineMarkers() {
  const d = els.player.duration || 0;
  if (!d) { els.timelineMarkers.innerHTML = ""; return; }
  els.timelineMarkers.innerHTML = clips.map(c => {
    const left = (c.start / d) * 100;
    const width = ((c.end - c.start) / d) * 100;
    return `<span class="clip-marker" style="left:${left}%;width:${width}%"></span>`;
  }).join("");
}

els.player.addEventListener("timeupdate", updatePlayerTime);
els.player.addEventListener("loadedmetadata", () => {
  updatePlayerTime();
  updateBuffered();
  renderTimelineMarkers();
});
els.player.addEventListener("durationchange", () => {
  updatePlayerTime();
  renderTimelineMarkers();
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
  clips.push({ id: nextClipId++, start, end, slowmo: true });
  renderClipsTable();
  saveState();
}

function removeClip(id) {
  clips = clips.filter(c => c.id !== id);
  renderClipsTable();
  saveState();
}

function moveClip(id, dir) {
  const i = clips.findIndex(c => c.id === id);
  if (i < 0) return;
  const j = i + dir;
  if (j < 0 || j >= clips.length) return;
  [clips[i], clips[j]] = [clips[j], clips[i]];
  renderClipsTable();
  saveState();
}

function renderClipsTable() {
  els.clipCount.textContent = clips.length;
  if (!clips.length) {
    els.clipsBody.innerHTML = `<tr class="empty"><td colspan="6">Chưa có pha nào. Bấm <b>Highlight start/end</b> để đánh dấu.</td></tr>`;
    renderTimelineMarkers();
    refreshRenderSummary();
    return;
  }
  els.clipsBody.innerHTML = "";
  renderTimelineMarkers();
  clips.forEach((c, idx) => {
    const tr = document.createElement("tr");
    const checked = c.slowmo === false ? "" : "checked";
    tr.innerHTML = `
      <td class="cell-check">
        <input type="checkbox" data-id="${c.id}" data-field="slowmo" ${checked}
               title="Có slow-motion cho pha này (uncheck = chỉ render real-speed)" />
      </td>
      <td>${idx + 1}</td>
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
  const ok = clips.length > 0 && currentVideo;
  els.renderBtn.disabled = !ok;

  if (!currentVideo) {
    els.renderSummary.innerHTML = `Chọn video nguồn để bắt đầu.`;
    return;
  }
  if (!clips.length) {
    els.renderSummary.innerHTML = `Sẵn sàng — thêm pha bóng để bật xuất video.`;
    return;
  }
  els.renderSummary.innerHTML = `
    <b>${clips.length}</b> pha (<b>${slowCount}</b> có slow-mo ${slow}%, ${factor.toFixed(2)}×) •
    intro <b>${intro}s</b> →
    real <b>${totalReal.toFixed(1)}s</b> + slow-mo <b>${totalSlow.toFixed(1)}s</b> =
    output ≈ <b>${totalOut.toFixed(1)}s</b>
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
    video: currentVideo || "",
    clips: clips.map(c => ({ start: c.start, end: c.end, slowmo: c.slowmo !== false })),
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
  }));
  renderClipsTable();
  if (p.video) {
    const opt = [...els.videoSelect.options].find(o => o.value === p.video);
    if (opt) {
      els.videoSelect.value = p.video;
      selectVideo(p.video);
    } else {
      flashTopMessage(`Video "${p.video}" không có trong workspace/raw`);
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
  if (!currentVideo) {
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
      video: currentVideo,
      start: clip.start,
      end: clip.end,
      include_slowmo: !!includeSlowmo,
      slow_percent: parseInt(els.slowSlider.value, 10),
      label: `clip${idx}`,
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
  if (!currentVideo || !clips.length) return;
  // Validate clips
  for (const c of clips) {
    if (!(c.end > c.start)) {
      alert("Clip không hợp lệ — kiểm tra Start/End.");
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
      video: currentVideo,
      clips: clips.map(c => ({ start: c.start, end: c.end, slowmo: c.slowmo !== false })),
      slow_percent: parseInt(els.slowSlider.value, 10),
      intro_seconds: parseFloat(els.introSeconds.value || "0"),
      tournament: els.tournament.value,
      player1: els.player1.value,
      player2: els.player2.value,
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
els.reloadVideos.addEventListener("click", () => loadVideos(false));
els.videoSelect.addEventListener("change", (e) => selectVideo(e.target.value));
els.slowSlider.addEventListener("input", updateSlowLabel);
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
  clips = []; renderClipsTable(); saveState();
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
  refreshRenderSummary();
})();

// Ctrl+S as a global save shortcut
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
    e.preventDefault();
    saveProject();
  }
});
