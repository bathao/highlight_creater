# TODO — Highlight Creator

> Open work items, ordered by priority. Last synced against the code: 2026-08-25 (v1.8, uncommitted — manual crop checklist pending).
> See [progress.md](progress.md) for everything already done.

---

## P0 — Important / Blocking

- [ ] **Write README.md** with install guide + screenshots + a workflow demo GIF
  - Requirements: Python 3.10+, FFmpeg on PATH, NVIDIA GPU (NVENC)
  - How to pick a source video (native dialog / in-app browser), mark in/out, render
  - Link to [progress.md](progress.md) and this file

- [ ] **Finish the `start` shell script** for Linux/macOS
  - The file is still empty (0 bytes)
  - Mirror the logic of [start.bat](start.bat): venv → deps → free port → uvicorn → open browser
  - Use `xdg-open` (Linux) / `open` (macOS)

- [x] ~~**Fix concat-list cleanup race condition**~~ — DONE v1.7.1: all temp files (segments, text files, concat lists) carry the `job_id` prefix; cleanup is strictly per-job

---

## P1 — Do soon

### Backend
- [x] ~~**Cap input resolution**~~ — Largely DONE v1.2: the Setup card has an output-resolution picker (720p / 1080p / 2K, never upscales) wired through `RenderJob.out_height`. Remaining nuance (optional): no *automatic* default downscale when the source is > 2560 px wide — the user has to pick a tier

- [ ] **Job history** persisted to `workspace/jobs/{job_id}.json`
  - Job state currently lives only in RAM (`_JOBS` dict) — closing the tab loses it
  - List the 10 most recent jobs in the UI, click to open the output
  - 💡 Quickest first step: the backend already has `GET /api/outputs` ([backend/main.py:483](backend/main.py#L483)) listing rendered files — the frontend **still doesn't call it**. Wire that into the UI before building full job history

- [ ] **Audio normalize** with the `loudnorm` filter
  - `sounds/slow_motion.mp3` can be much louder/quieter than the source audio — normalize both to the same LUFS
  - Optional flag on `RenderRequest`
  - Note: the v1.6 *output* background music has volume sliders + ducking, but no loudness normalize either (per-track normalize is on the music roadmap in progress.md § 6)

- [ ] **Fade in/out for the slow-mo music** (~0.2 s)
  - The track still starts/stops hard — can pop at real → slow → real transitions
  - Use `afade=t=in:d=0.2` + `afade=t=out:st={out_duration-0.2}:d=0.2` on the music input
  - (v1.6 added `afade` for the *output* background music only — the slow-mo track path is untouched)

- [ ] **Slow-mo music picker** in the Setup card
  - Still hardcoded to `sounds/slow_motion.mp3` (`SLOWMO_AUDIO`, [backend/render.py:47](backend/render.py#L47))
  - New endpoint `GET /api/sounds` (or reuse the v1.6 `/api/music` library pattern), dropdown in the frontend, saved in the project payload

- [ ] **Fade transition** between segments (0.2–0.3 s crossfade)
  - Segments are still hard-cut concat — can pop between real-speed and slow-mo
  - Use `xfade` + `acrossfade` (forces dropping `-c copy` at the concat step → slower)

### Frontend
- [ ] **Thumbnail per event** in the table
  - Small JPEG at the middle frame (`(start+end)/2`) via ffmpeg `-ss … -frames:v 1`
  - Cache in `workspace/temp/thumb_{video}_{ms}.jpg`
  - New endpoint `/api/thumb?video=…&t=…`

- [ ] **Dedicated toast/notification component**
  - `captureStatus` is still reused as the flash-message slot (`flashTopMessage`)
  - Conflicts when a capture is running while a flash fires — the message disappears early

- [ ] **Drag-and-drop a video onto the page** to add it as a source
  - Lower priority since v1.2: sources can already be picked from anywhere on disk via the native dialog / in-app browser

---

## P2 — Quality improvements

- [ ] **Player-name overlay** on slow-mo segments
  - Player 1 / Player 2 in a lower corner (like the "SLOW MOTION" badge, different corner)
  - Reuse the existing `drawtext` machinery

- [ ] **More accurate clip preview stop** ([frontend/app.js](frontend/app.js))
  - `previewClip` watchdog uses `timeupdate` (~250 ms granularity) — can overshoot the clip end by ~0.2 s
  - Try `requestVideoFrameCallback` (Chrome) or a 50 ms interval

- [ ] **Export presets**: Instagram (9:16), YouTube (16:9), TikTok (9:16 + 60 s cap)
  - Auto crop/letterbox per preset

- [ ] **Redo** in the event table (Ctrl+Y) — Undo (Ctrl+Z + button) is DONE since v1.2; redo is not

---

## P3 — Testing & DevX

- [ ] **pytest** for the backend
  - `render._atempo_chain` (edge cases: ratio=0.01, ratio=2.0, ratio=0.5)
  - `render._expected_total_duration`
  - `main._safe_project_path` / `_safe_source_path` / `_safe_music_path` (path-traversal attempts)

- [ ] **GitHub Actions CI**: lint (ruff) + pytest on push
  - The git repo now exists (`master`, clean) — but **no remote is configured yet**; set one up + push first

- [ ] **Dockerfile** (optional) for users who don't want a local Python install
  - Needs GPU passthrough — NVIDIA Container Toolkit

- [ ] **Structured (JSON) logging** instead of print
  - `_run_ffmpeg` keeps only the last ~40 log lines in RAM — hard to debug a failed job

- [ ] **Type hints & mypy** check
  - Dataclasses + Pydantic are in use, but some raw `dict`s remain

---

## Done — archive

> Full details in [progress.md § 2 Completed features](progress.md#2-completed-features).

Summary: full render pipeline (intro + real + slow-mo + concat), NVENC, byte-range streaming, SSE progress, project CRUD, custom timeline + control bar, keyboard shortcuts, auto-persisted state, single-clip export, 1-click `start.bat` launcher.

- **v1.8.1 (2026-08-25):** text overlays — deterministic wrap shared by preview + export, one drawtext per line (ffmpeg 8 newline-glyph bug), CRLF/LF fix, block-aware position pad
- **v1.8 (2026-08-25):** per-source crop / zoom-to-region (aspect-locked by default, free-aspect toggle, live WYSIWYG preview, burned into all exports); fix: native file picker crashed on filenames with Vietnamese diacritics (UTF-8 subprocess)

- **v1.7 / v1.7.1 (2026-07-23):** per-source brightness (live CSS preview + ffmpeg `eq` in the export); full bug-fix sweep — per-job concat/temp naming (the old P0 race), `apad` music-truncation fix, `_JOBS` pruning, VFR-safe fps, Host-header allowlist, SSE stream-loss recovery, projects no longer drop `texts`/`music`
- **v1.6 / v1.6.1 (2026-06-29):** background music on the final output (library, live audition, volumes, fades, loop, auto-ducking), clean cancel, Remove music, New project
- **v1.4 / v1.5 (2026-06-16):** text overlays burned into the output with a CapCut-style output timeline; box/fade/outline, position pad, inline edit, per-text sliders
- **v1.2 / v1.3 (2026-06-15):** pick source from anywhere on disk (native dialog + browser fallback), selectable output resolution, undo, English UI, preview output playback, drag-and-drop reordering
- **v1.1 (2026-05-29 → 05-31):** multi-source input (per-clip `video`, letterbox scaling, uniform audio, V1/V2 badges), localStorage v1→v2 migration, explicit `0:v:0`/`0:a:0` stream mapping
