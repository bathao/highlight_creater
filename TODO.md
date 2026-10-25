# TODO — Highlight Creator

> Open work items, ordered by priority. Last synced against the code: 2026-10-25 (v1.14 + v1.14.1 — timeline hover thumbnails + auto-mute at speed ≠ 1×, `872eb85`; v1.13 — Export full source, `0fde39d`; both pushed to GitHub 2026-10-25; before that no code changes since v1.12 `bfcbfe9` / docs `92d733d`, 2026-10-10; v1.12 in use — a 720p full render on 2026-10-15 + two 1080p per-event exports on 2026-10-24, earlier outputs deleted by hand again; before that no code changes since v1.11 `2783163` / docs `9cfee99`, 2026-09-27; v1.11 in production use 2026-09-27 → 2026-10-09 (5 full renders + 2 per-event exports, 1080p tier, crop visibly in use); v1.10 `f04ec61` used 2026-09-26 (two 720p renders); v1.9 `e35d43b`; v1.8.1 used 2026-09-11 → 2026-09-23; manual crop checklist still pending; pushed to GitHub `origin` = https://github.com/bathao/highlight_creater on 2026-10-10).
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
  - 💡 Quickest first step: the backend already has `GET /api/outputs` ([backend/main.py:487](backend/main.py#L487)) listing rendered files — the frontend **still doesn't call it**. Wire that into the UI before building full job history
  - 📈 Still relevant: 19 rendered files (~3.6 GB) had piled up by 2026-09-24 and were deleted by hand in Explorer on/before 2026-09-27 — the UI still cannot list, open or delete outputs. Growing again: 9 files / 2.5 GB on 2026-10-10, then 7 of them deleted by hand in Explorer; 5 files / 2.0 GB as of 2026-10-25 (3 full renders + 2 per-event exports) — the second manual cleanup since September

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
  - 💡 v1.14's hidden-decoder thumbnail path (`thumbVideo` + canvas) can produce these client-side too — no ffmpeg/thumb cache needed for a first version
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
  - ~~No remote configured~~ — `origin` = https://github.com/bathao/highlight_creater, `master` pushed 2026-10-10; CI can be added now

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

- **v1.14.1 (2026-10-25):** preview auto-mutes whenever the playback speed is not 1× (speed select and preview slow-mo segments); the slider keeps its value and sound returns at 1×. Fixed on the way: a source switch reset the speed to 1× while the select still showed the old value (`defaultPlaybackRate`). 11/11 headless checks. Committed `872eb85`.
- **v1.14 (2026-10-25):** timeline hover thumbnails — hovering the raw-source timeline shows a live 192×108 frame (hidden `<video>` + canvas, crop region + brightness filter, coalesced seeks); feasibility measured on the real DJI HEVC source (28 ms median seek) before choosing client-side over server frames / sprite sheets. Not on the Preview-output timeline (user's decision). 13/13 headless checks. Committed `872eb85`.
- **v1.13 (2026-10-25):** Export full source — ⤓ button under ✂ Crop in the Setup card exports the whole source now viewing with its brightness + crop burned in, at the chosen output resolution (`POST /api/export-source`, single-clip pipeline with one clip 0 → duration, file `<source>_full_<ts>.mp4`). 16/16 E2E checks through the live server. Committed `0fde39d`.
- **v1.12 (2026-10-10):** fullscreen for the video box — ⛶ button / F / double-click puts `.player-wrap` into browser fullscreen; timeline + control bar + preview bar are reparented into an auto-hiding bottom chrome and restored on exit; overlays, crop and brightness keep their geometry; theatre-mode fallback when the API is refused. 32/32 headless checks + brightness-in-fullscreen luma check. Committed `bfcbfe9`.
- **v1.11 (2026-09-27):** "Auto for all sources" brightness mode (offscreen per-source analysis + auto level, manual takeover, exclusive with apply-to-all, render/export wait for pending levels) + 🔊 preview volume/mute in the player bar; fixed the double busy-guard and idempotent histogram normalisation. 21/21 new + 40/40 regression headless checks. Committed `2783163`. Wider slider range (±100) was proposed and **declined by the user** — stays ±50.
- **v1.10 (2026-09-25):** smart brightness — one level, auto-derived gain/gamma/contrast/saturation from per-source frame analysis, plus ✨ Auto (picks the level from the frame's luma histogram); preview (SVG filter) and export (RGB `lutrgb`+`colorchannelmixer`) now run identical maths, fixing the pale colours the luma-only `eq` export produced. Verified synthetic + real 10-bit BT.709 frames, 20/20 + 11/11 headless checks, live export. Committed `f04ec61`.
- **v1.9 (2026-09-24):** "Apply to all sources" brightness checkbox — one value inherited by every current and later-added source; persisted (`brightnessAll` / project `brightness_all`); 20/20 headless UI checks. Committed `e35d43b`.
- **v1.8.1 (2026-08-25):** text overlays — deterministic wrap shared by preview + export, one drawtext per line (ffmpeg 8 newline-glyph bug), CRLF/LF fix, block-aware position pad
- **v1.8 (2026-08-25):** per-source crop / zoom-to-region (aspect-locked by default, free-aspect toggle, live WYSIWYG preview, burned into all exports); fix: native file picker crashed on filenames with Vietnamese diacritics (UTF-8 subprocess)

- **v1.7 / v1.7.1 (2026-07-23):** per-source brightness (live CSS preview + ffmpeg `eq` in the export); full bug-fix sweep — per-job concat/temp naming (the old P0 race), `apad` music-truncation fix, `_JOBS` pruning, VFR-safe fps, Host-header allowlist, SSE stream-loss recovery, projects no longer drop `texts`/`music`
- **v1.6 / v1.6.1 (2026-06-29):** background music on the final output (library, live audition, volumes, fades, loop, auto-ducking), clean cancel, Remove music, New project
- **v1.4 / v1.5 (2026-06-16):** text overlays burned into the output with a CapCut-style output timeline; box/fade/outline, position pad, inline edit, per-text sliders
- **v1.2 / v1.3 (2026-06-15):** pick source from anywhere on disk (native dialog + browser fallback), selectable output resolution, undo, English UI, preview output playback, drag-and-drop reordering
- **v1.1 (2026-05-29 → 05-31):** multi-source input (per-clip `video`, letterbox scaling, uniform audio, V1/V2 badges), localStorage v1→v2 migration, explicit `0:v:0`/`0:a:0` stream mapping
