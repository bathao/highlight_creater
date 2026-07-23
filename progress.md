# Highlight Creator — Project Status

> Updated: 2026-07-23 (v1.7.1 — **bug-fix sweep** after a full-project review; all fixes verified (E2E: music-truncation regression test, live-server export + SSE through the new Host middleware). Backend: silent-source + non-loop music no longer truncates the output (`apad`); per-job concat-list names (no cross-job cleanup); `_JOBS` pruned; fps prefers `avg_frame_rate` (VFR-safe); Host-header allowlist (pure-ASGI, anti DNS-rebinding); ns cache-bust. Frontend: capture cancelled on source switch; stale-preview-plan fixes (SLO toggle / slow slider exit preview); Esc during inline text edit no longer exits preview; shortcuts ignore contenteditable; single-export-at-a-time guard; preview watchdog respects playback rate; centralized `onSourceReady` (no stale loadeddata handlers); SSE stream-loss recovery (no more stuck "rendering"); transient `/api/music` failure keeps the chosen track; `parseTime` accepts h:mm:ss. Committed `86c13b6` on `master` (one commit with v1.7 — changes interleave in the same files))
> Previous: 2026-07-23 (v1.7 — **per-source brightness**: a ☀ Brightness slider in Setup (−50%..+50%, per source video) that brightens dark footage live in the player (CSS filter) and burns the same gain into the export (ffmpeg `eq`, multiplicative so letterbox bars stay black); applies to the main render AND per-event Export / Export + Replay; persisted to `localStorage` + projects. Also **fixed**: server-side projects were silently dropping `texts` + `music` on save (`ProjectPayload` didn't declare them — pydantic ignored the extras), so save/load lost overlays and music. E2E verified (luma 57→78 at +40%). Committed `86c13b6` on `master`)
> Previous: 2026-06-29 (v1.6.1 — UX fixes: **clean cancel** (cancelling an export is now its own terminal status, not a red error — the progress UI resets to ready and Cancel gives immediate "Cancelling…" feedback), **Remove music** button (one-click clear of the chosen track), and a **New project** button (clears events/text/music + disconnects the source video for a fresh start). Committed `4de2753` on `master`)
> Earlier: 2026-06-29 (v1.6 — background music on the final output: a royalty-free music library, a music strip in the Preview context with live audition synced to the assembled output, music/original volume, fade in/out, loop-to-fill, and CapCut-style auto-ducking. Committed `2e562a1` on `master`; automated E2E passed; **manual UI test PASSED 2026-06-29** — all 8 checklist steps verified)
> Earlier: 2026-06-16 (v1.5 — richer text editing: per-text Start/End sliders, background box, fade in/out, scalable outline, 9-cell position pad + centre snap, duplicate, multi-line, inline edit on the player; plus a smoother preview output timeline. Commits `e18f0b1`, `5cd6ca4` on `master`; no git remote configured)
> Earlier: 2026-06-16 (v1.4 — text overlays burned into the final video, with a CapCut-style output timeline, committed `6db33b8`; docs `024fd67`)
> Earlier: 2026-06-15 (v1.3 — preview output playback + drag-and-drop event reordering, commit `8c80dd7`)
> Earlier: 2026-06-15 (v1.2 — pick source from anywhere on disk, native file dialog, selectable output resolution, undo, English UI)
> Earlier: 2026-05-31 (v1.1 — multi-source input + UI refinements, commit `ed85265`)
> Earlier: 2026-05-29 (multi-source input — stitch events from several source videos into one output)
> Earlier: 2026-05-14 (background music for slow-motion)
> Local web app (FastAPI + Vanilla JS) for building highlight videos from source footage, with an intro card and slow-motion replay, using NVENC (RTX) for fast rendering.

---

## 1. Overall architecture

```
highlight_creator/
├── backend/
│   ├── main.py        # FastAPI app — routes, SSE progress, project CRUD, file picker/browser
│   └── render.py      # ffmpeg pipeline: probe → intro → real/slow → concat
├── frontend/
│   ├── index.html     # 4 cards: Setup · Player · Highlight Events · Render
│   ├── app.js         # State, capture (I/O), timeline, projects, SSE, undo, file browser
│   └── style.css      # Dark theme, responsive 3-column grid
├── workspace/
│   ├── raw/           # Optional source location (sources can now live anywhere on disk)
│   ├── output/        # Rendered highlight files
│   ├── projects/      # Saved projects (JSON)
│   └── temp/          # Intermediate segments (auto-cleaned after each job)
├── sounds/
│   ├── slow_motion.mp3  # Background music for every slow-motion segment (auto-loop)
│   └── library/         # Background-music library for the final output (user-droppable mp3/m4a/wav) + CREDITS.md
├── requirements.txt   # fastapi, uvicorn, pillow, jinja2, python-multipart
└── start.bat          # 1-click launcher: venv → deps → uvicorn :8770
```

**Stack:** Python 3.10+ · FastAPI 0.115 · Uvicorn · Pillow · FFmpeg (NVENC h264) · Vanilla JS (no framework)

---

## 2. Completed features

### Backend
- [x] FastAPI app with static mount for frontend + mtime-based cache-bust ([backend/main.py:51-64](backend/main.py#L51-L64))
- [x] **Source path resolution** — `_safe_source_path` resolves any absolute path (local-only app); bare filenames still resolve under `workspace/raw` for backward compat ([backend/main.py:106](backend/main.py#L106))
- [x] **Native file dialog** — `POST /api/pick-file` opens the real OS "Open file" dialog via a short-lived tkinter subprocess (sync endpoint → Starlette threadpool so the blocking wait never stalls the event loop; `CREATE_NO_WINDOW` hides the console). Returns `""` on cancel, 501 if no GUI. DPI-aware (per-monitor-v2, fallback system-aware) so it renders crisp on high-DPI displays ([backend/main.py:230-266](backend/main.py#L230-L266))
- [x] **In-app filesystem browser** — `GET /api/browse` lists drives + folders + video files as a fallback when the native dialog is unavailable ([backend/main.py:308](backend/main.py#L308))
- [x] **Serve any path by byte-range** — `GET /api/source-stream` + `GET /api/source-probe` serve any absolute source path (HTTP 206) for smooth scrubbing on 2K/4K video ([backend/main.py:203-209](backend/main.py#L203-L209))
- [x] Probe video (width/height/fps/duration/has_audio) via ffprobe ([backend/render.py:142-172](backend/render.py#L142-L172))
- [x] **Render pipeline** intro + (real, slow)*N + concat `-c copy` ([backend/render.py:474-582](backend/render.py#L474-L582))
- [x] **Selectable output resolution** — `RenderJob.out_height` downscales the canvas (aspect preserved, even dims) before each segment is scaled onto it; `0` = native. Wired through both `/api/render` and `/api/export-clip` ([backend/main.py:497-507](backend/main.py#L497-L507), [backend/render.py:597-598](backend/render.py#L597-L598))
- [x] **Multi-source input** — each clip carries its own `video_path`; `run_job` probes every source, canvas = first video, scales keeping aspect + letterbox (`force_original_aspect_ratio=decrease` + `pad` + `setsar=1`) so sources of different resolution/fps/ratio stitch cleanly ([backend/render.py:285-292](backend/render.py#L285-L292), [557-590](backend/render.py#L557-L590))
- [x] **Uniform multi-source audio** — `need_audio = any(source has audio)`; silent sources get an `anullsrc` track so `concat -c copy` doesn't break ([backend/render.py:365-410](backend/render.py#L365-L410))
- [x] **Intro card** PNG generated with Pillow (tournament + Player 1 vs Player 2) ([backend/render.py:188-238](backend/render.py#L188-L238))
- [x] **Slow-motion** with `setpts` + `atempo` chain (fallback when no music), "SLOW MOTION" badge top-right ([backend/render.py:297-318](backend/render.py#L297-L318))
- [x] **Slow-motion background music** — replaces original audio with `sounds/slow_motion.mp3`, auto-loops if the segment is longer than the track, capped to `out_duration` ([backend/render.py:391-468](backend/render.py#L391-L468))
- [x] **NVENC h264** preset p5, CQ 20 — tuned for RTX 5060 Ti ([backend/render.py:54-62](backend/render.py#L54-L62))
- [x] **SSE progress stream** real-time per job ([backend/main.py:429-461](backend/main.py#L429-L461))
- [x] **Job cancel** via `threading.Event` ([backend/main.py:408-414](backend/main.py#L408-L414)) — (v1.6.1) cancellation is now a distinct terminal status `cancelled` (the `except` checks `job.cancel.is_set()` so a user stop isn't reported as `error`); the SSE stream terminates on `cancelled` too ([backend/render.py](backend/render.py), [backend/main.py](backend/main.py))
- [x] **Export single clip** (real-only or real + slow-mo replay) ([backend/main.py:332-365](backend/main.py#L332-L365))
- [x] **Project CRUD** save/load/list/delete (JSON in `workspace/projects`) ([backend/main.py:256-301](backend/main.py#L256-L301))
- [x] **List outputs** endpoint `GET /api/outputs` with `size_mb`/`mtime` ([backend/main.py:213-224](backend/main.py#L213-L224)) — ⚠️ not yet wired in the frontend (ready for a Job history view)
- [x] **Open folder** in File Explorer (Windows/macOS/Linux) ([backend/main.py:188-210](backend/main.py#L188-L210))
- [x] Path validation against traversal ([backend/main.py:96-111](backend/main.py#L96-L111))
- [x] Auto-clean `workspace/temp` on startup/shutdown ([backend/main.py:467-475](backend/main.py#L467-L475))
- [x] **English server messages** — error messages + native dialog title that surface in the UI are all English
- [x] **Text overlays on the final video** (v1.4) — `TextOverlay` model + `drawtext` chain burned in a final re-encode pass (`concat_with_text`); when no text, the fast `-c copy` concat path is kept. Text content is written to a UTF-8 file and referenced via `textfile=` (no filtergraph escaping; Vietnamese diacritics safe). Color `#rrggbb`→`0x`, size = % of canvas height, position = centre fraction (`x=w*..-text_w/2`), black border for legibility ([backend/render.py](backend/render.py))
- [x] **Font families + Bold/Italic** (v1.4) — `FONT_FAMILIES` (Arial / Segoe UI / Impact / Times / Consolas) resolve to the right Windows variant file (e.g. `arialbi.ttf` for bold+italic); falls back to regular when a family lacks the variant (Impact). Legacy keys (`arial-bold`) still resolve ([backend/render.py](backend/render.py))
- [x] **Output-relative text timing + intro offset** (v1.4) — overlay start/end are seconds on the preview/output timeline (intro excluded); `_enable_expr(start,end,offset)` shifts them onto the final timeline (adds the intro) via `enable='between(t,..)'`. Blank window = always on ([backend/render.py](backend/render.py))
- [x] **`/api/render` accepts `texts`** — `TextOverlayModel` validated (≤20, drops blank) and mapped to `TextOverlay` ([backend/main.py](backend/main.py))
- [x] **Text styling: background box + fade + scalable outline** (v1.5) — `TextOverlay`/`TextOverlayModel` gain `box`/`box_color`/`box_opacity`/`fade`; `_build_text_filters` emits `box=1:boxcolor=…@a:boxborderw`, an `alpha='…'` fade in/out expression (`_fade_alpha_expr`; fade-out only when `end` is set, since total length isn't known there), and a `borderw` scaled to font size so the outline stays visible at 1080p/1440p ([backend/render.py](backend/render.py), [backend/main.py](backend/main.py))
- [x] **Background music on the final output** (v1.6) — `MusicTrack` model + `mix_background_music` final pass: video is **stream-copied** (`-c:v copy`, fast remux) while the music is laid down via `-filter_complex`. Music is an extra input (`-stream_loop -1` when loop) mixed with the original via `amix=…:normalize=0` (gains honoured). `volume`/`original_volume` linear gains, `fade_in`/`fade_out` (`afade`, fade-out anchored to total length), `loop`. Handles the **silent-source** case (music becomes the soundtrack, no `[0:a]` ref). The video is assembled to a temp file first; the music pass writes the real output ([backend/render.py](backend/render.py)) — verified E2E across no-text/with-text/duck/silent paths
- [x] **Auto-ducking** (v1.6) — `duck=True` side-chain-compresses the music with the original audio as the key (`sidechaincompress`), so commentary/crowd stays on top — the CapCut-style "auto" ducking ([backend/render.py](backend/render.py))
- [x] **Per-source brightness** (v1.7) — `Clip.brightness` (percent −50..+50) flows into every real/slow segment via `_brightness_filter`: ffmpeg `eq=contrast=k:brightness=(k-1)/2` (k = 1 + pct/100), a purely **multiplicative** luma gain matching the frontend's CSS `brightness(k)` preview — black (and the letterbox pad) stays black. Wired through `/api/render` (`ClipModel.brightness`), `/api/export-clip` (`ExportClipRequest.brightness`) and `ProjectClip` ([backend/render.py](backend/render.py), [backend/main.py](backend/main.py))
- [x] **Fix: projects no longer drop `texts`/`music`** (v1.7) — `ProjectPayload` now declares `texts: List[dict]` + `music: dict` (stored as-is in the frontend's camelCase shape), so saving a project keeps overlays and music; previously pydantic silently ignored the extra keys and save/load lost them ([backend/main.py](backend/main.py))
- [x] **Music library API** (v1.6) — `GET /api/music` lists `sounds/library/` (file, prettified display name, duration via ffprobe, size); `sounds/library` mounted at `/music-files` (static) for in-browser audition. `_safe_music_path` sandboxes the chosen track (no traversal); `_prettify_music_name` strips uploader prefixes / long numeric ids / "instrumental" filler and title-cases. `RenderRequest.music` (`MusicModel`) validated + mapped to `MusicTrack` ([backend/main.py](backend/main.py))

### Frontend
- [x] Responsive 3-column layout (Setup · Player+Events · Render) ([frontend/style.css:56-75](frontend/style.css#L56-L75))
- [x] **English UI** — every title, button, placeholder, hint, dynamic status/summary text, and alert/confirm unified to English (v1.2)
- [x] **Preview output** (v1.3) — "Preview output" toggle plays the assembled highlight in render order: each event's real-speed segment + slow-mo replay (when on), switching the player to each event's source (multi-source aware) and skipping the dead-time between events. Subtle accent transport bar (pulsing dot, ⏮/Play/⏭, "Event N/M · Real|Slow-mo" chip, output-position/total readout, ✕ / Esc exit); intro card excluded (no live source). Pure playback aid — never mutates clips/project; auto-exits on any structural edit ([frontend/app.js:788-1000](frontend/app.js#L788-L1000))
- [x] **Drag-and-drop event reordering** (v1.3) — each event row has a ⠿ grip in the # column; drag to reorder with a blue insertion-line indicator. Row is draggable only while the grip is held, so inline time inputs / SLO checkbox stay clickable; wired via tbody delegation so it survives re-renders. `reorderClips` moves in one gesture, pushes undo + persists (↑/↓ buttons kept for single-step / keyboard) ([frontend/app.js](frontend/app.js))
- [x] **Text overlay editor in the Preview-output context** (v1.4) — the text panel lives inside the player card and appears only while Preview output is on (so text is edited against the real kept-segment output, beside the video — not in a card far below 40-50 events). Each row: text, font family, **Bold/Italic** toggles (disabled for Impact), size %, color picker; window shown read-only ([frontend/app.js](frontend/app.js))
- [x] **Live draggable label on the player** (v1.4) — each overlay renders over the video with its real font/size/color; **drag to position** (stores centre as a fraction of the canvas). Playing → labels show/hide by their time window; paused → all shown for positioning ([frontend/app.js](frontend/app.js))
- [x] **CapCut-style output timeline** (v1.4) — a base video track (the kept segments) + one lane per text whose bar = its `[start,end]` window. Drag a bar to move, drag its edges to trim, drag to full width = whole video, click a bar to select/edit that text; click empty area to scrub the output (red playhead syncs with playback) ([frontend/app.js](frontend/app.js))
- [x] **Per-text Start/End range sliders + "set = playhead"** (v1.5) — two sliders per text row (range = output duration; far edges snap to open-ended) plus a ⤓ button to set start/end from the current preview position; kept in sync both ways with the CapCut-timeline bar ([frontend/app.js](frontend/app.js))
- [x] **Text style controls** (v1.5) — background box (toggle + color + opacity), fade (seconds), outline toggle, a 3×3 quick-position pad, multi-line auto-grow textarea, and a duplicate (⧉) button per row; the WYSIWYG player label reflects box/multi-line ([frontend/app.js](frontend/app.js))
- [x] **Snap-to-centre + inline edit on the player** (v1.5) — dragging a label snaps to the canvas centre lines (hold Shift for free); **double-click a label to edit its text in place** (contenteditable; Enter / click-away / Esc commits, Shift+Enter = new line) ([frontend/app.js](frontend/app.js))
- [x] **Select a text → reveal it** (v1.5) — clicking a text's row/field or its timeline bar moves the output playhead to that text's start when the playhead is outside its window, so only that text shows; overlay visibility now strictly follows each text's time window (only an inline-edited label is force-shown) ([frontend/app.js](frontend/app.js))
- [x] **Preview output timeline polish** (v1.5) — the raw-source scrubber is disabled during preview (the output timeline is the only scrubber); clicking the output timeline preserves the play state; the segment watchdog no longer auto-advances while paused; seeking is coalesced (skip-while-seeking) for smooth scrubbing on 2.6K/60fps sources; play/pause icons (`syncPlayButtons`) always match the real state ([frontend/app.js](frontend/app.js))
- [x] **Background-music strip in the Preview context** (v1.6) — a `musicPanel` lives in the player card beside the text panel, shown only while Preview output is on (same rationale as text — edit/audition against the real assembled output). Track dropdown (populated from `/api/music`), music/original volume sliders, fade in/out, loop + duck toggles, plus a visual music **lane** that spans the output with fade-ramp gradients ([frontend/index.html](frontend/index.html), [frontend/app.js](frontend/app.js))
- [x] **Live audition synced to the output** (v1.6) — a hidden `<audio>` is slaved to the preview while playing: `syncMusicPlayback` aligns its time to `pvOutputPos()` (loops, drift-corrects > 0.35s) and sets the player's own volume to the original-audio gain, so the mix is heard live (output position advances at 1× wall-clock through both real and slow-mo segments, so a continuously-playing track stays in sync). A standalone **▶ Audition** button plays the track on its own ([frontend/app.js](frontend/app.js))
- [x] **Music persistence + summary** (v1.6) — `music` config persisted to `localStorage` (with `normalizeMusic` defaults) + project payload (backward-compatible: old states/projects load as no music) + sent to `/api/render` as `musicPayload()`; the render summary shows the chosen track (🎵) ([frontend/app.js](frontend/app.js))
- [x] **Remove-music button** (v1.6.1) — `clearMusic()` (the ✕ Remove button, shown only when a track is set) clears `music.track` in one click — stops any audition, re-renders the panel and re-syncs playback — instead of having to find "— No music —" in the dropdown ([frontend/app.js](frontend/app.js), [frontend/index.html](frontend/index.html))
- [x] **Per-source brightness slider** (v1.7) — ☀ Brightness in the Setup card (−50..+50%, step 5, disabled until a source is selected) applies to the **currently viewed source**; `sourceAdjust` maps path → percent, a CSS `brightness(k)` filter on the player previews it live and follows every source switch (capture, event preview, preview-output segments — all go through `selectVideo`). ↺ reset button; persisted to `localStorage` + project payload (per-clip `brightness`, map rebuilt on load); sent with `/api/render` and per-event export ([frontend/app.js](frontend/app.js), [frontend/index.html](frontend/index.html), [frontend/style.css](frontend/style.css))
- [x] **±5s seek on the output timeline** (v1.4) — in the Preview-output transport, `−5s`/`+5s` step along the assembled output (skips dead-time, crosses segments/sources) ([frontend/app.js](frontend/app.js))
- [x] **Pick source from anywhere on disk** — "Choose source video…" button calls the native dialog first ([frontend/app.js:250](frontend/app.js#L250)), falling back to the in-app browser modal (navigate drives/folders, breadcrumb path bar, shortcuts, Esc/backdrop to close) if unavailable ([frontend/app.js:278-290](frontend/app.js#L278-L290)). Sources are identified by absolute path, displayed by basename; legacy clips/projects with bare names keep working with no migration ([frontend/index.html:61-66](frontend/index.html#L61-L66))
- [x] **Output resolution picker in Setup card** — dropdown offers only standard tiers (720p / 1K·1080p / 2K·1440p) whose height ≤ the canvas source height (never upscales; >1440p sources cap at 2K). Re-evaluates when the canvas source changes (select video, add/remove/reorder clips, load project); persists to `localStorage` ([frontend/index.html:72-73](frontend/index.html#L72-L73), [frontend/app.js:376-420](frontend/app.js#L376-L420))
- [x] **Undo for highlight events** — ↩ Undo button + Ctrl+Z snapshots `clips` before each structural change (add/delete/reorder/clear/time-edit) so a mis-deleted event is restored one step at a time (stack capped at 50, cleared on project load, button disabled when empty) ([frontend/app.js:581-598](frontend/app.js#L581-L598), [frontend/index.html:146](frontend/index.html#L146))
- [x] **Custom timeline** with buffered/progress/thumb/tooltip ([frontend/index.html:84-92](frontend/index.html#L84-L92)) — clip markers removed in v1.1 (wrong positions when events come from different sources)
- [x] **Custom control bar**: ±5/10/20s, play/pause, speed select (0.25×–2×), highlight toggle ([frontend/index.html:95-127](frontend/index.html#L95-L127))
- [x] **Keyboard shortcuts**: Space, ←/→, Shift+←/→, `,`/`.` (frame-by-frame), I/O (mark in/out), Ctrl+S (save), Ctrl+Z (undo) ([frontend/app.js:825-890](frontend/app.js#L825-L890))
- [x] **Capture flow** single toggle button (start → end) ([frontend/app.js:306-340](frontend/app.js#L306-L340))
- [x] **Event table** inline time edit, ↑/↓ reorder, delete, preview, individual export ([frontend/app.js:382-409](frontend/app.js#L382-L409))
- [x] **Slow-mo per clip** (SLO checkbox) — unchecked = real-speed only; new events default to slow-mo OFF since v1.1 ([frontend/app.js:359](frontend/app.js#L359), [405](frontend/app.js#L405))
- [x] **Project save/load UI** with name validation, overwrite confirm ([frontend/app.js:570-633](frontend/app.js#L570-L633))
- [x] **New project button** (v1.6.1) — `newProject()` wipes every per-project field (events, text overlays, music, undo stack, tournament/player names, intro/slow/resolution back to defaults) and disconnects the source video via `selectVideo("")`; confirms first when there's unsaved work. Lets a fresh `start.bat` session begin clean without carrying over the persisted `localStorage` state ([frontend/app.js](frontend/app.js), [frontend/index.html](frontend/index.html))
- [x] **Clean cancel UX** (v1.6.1) — the `cancelled` SSE status calls `showRenderCancelled()` (hides the progress box, resets the bar, re-enables Export) instead of leaving a stuck red error; Cancel shows immediate "Cancelling…" feedback and disables itself until the backend acknowledges ([frontend/app.js](frontend/app.js))
- [x] **Multi-source UI** — switch videos to add events from several sources; each event carries its `video` + a `V1/V2…` badge in the "Src" column; preview auto-switches the player to the right source ([frontend/app.js:350-395](frontend/app.js#L350-L395), [457-490](frontend/app.js#L457-L490))
- [x] **Auto-persist state** to `localStorage` (tournament, players, slow %, clips with source, selected video, output height) + **migration v1→v2** (backfill `video` for old clips) ([frontend/app.js:74-136](frontend/app.js#L74-L136))
- [x] **SSE listener** + progress bar with shimmer, error state ([frontend/app.js:737-781](frontend/app.js#L737-L781))
- [x] **Render summary** real-time: total events, slow-mo, intro, output — shown as **mm:ss** (`fmtClock`); also shows text-overlay count ([frontend/app.js](frontend/app.js))
- [x] **Auto-persist `texts`** to localStorage + project payload (additive/backward-compatible — old states/projects without `texts` load as none) ([frontend/app.js](frontend/app.js))

### DevOps / Launcher
- [x] `start.bat` 1-click: auto-create venv, install deps, check ffmpeg, free port :8770, open browser ([start.bat:1-127](start.bat#L1-L127))
- [x] Auto-restart loop (max 50) + clear cache between restarts ([start.bat:89-120](start.bat#L89-L120))

---

## 3. Missing / possible improvements

### Missing
- [ ] **`start` shell script** for Linux/macOS — the `start` file is empty (only `start.bat` exists)
- [ ] **README / install guide** — no official README yet
- [ ] **Tests** — no unit/integration tests
- [ ] **Job history** — closing the tab loses everything; old jobs aren't viewable (`GET /api/outputs` exists, not wired)
- [x] ~~**Background music on the output**~~ — DONE v1.6: royalty-free library + music strip in Preview (live audition), music/original volume, fade in/out, loop-to-fill, auto-ducking. NOTE: applies to the main render only, **not** the per-event Export / Export + Replay; one global track (no per-section music / multi-track yet); upload-your-own deferred
- [ ] **Audio post-processing** — no loudness normalize / fade between *segments* (music fade in/out exists; per-segment crossfade does not)
- [x] ~~**Text / title overlay**~~ — DONE v1.4 + v1.5: free text overlays on the final video (font/B-I/size/color/position + timed window). v1.5 adds background box, fade in/out, scalable outline, Start/End sliders, 3×3 position pad + centre snap, duplicate, multi-line, and inline edit on the player. NOTE: still applies to the main render only, **not** the per-event Export / Export + Replay
- [x] ~~**Multi-video timeline**~~ — DONE 2026-05-29: stitch events from several sources into one output
- [x] ~~**Selectable output resolution**~~ — DONE 2026-06-15: 720p–2K picker, never upscales
- [x] ~~**Pick source from anywhere on disk**~~ — DONE 2026-06-15: native dialog + in-app browser fallback
- [x] ~~**Undo for accidental edits**~~ — DONE 2026-06-15: ↩ Undo + Ctrl+Z

### Suggested improvements
- [ ] **Backend**: `_atempo_chain` could infinite-loop on a tiny ratio (clamped at 0.05, stable) — add a test
- [x] ~~**Backend**: `concat_segments` deletes old `concat_*.txt` unconditionally in cleanup~~ — FIXED v1.7.1: concat lists carry the job-id prefix, cleanup is strictly per-job
- [x] ~~**Frontend**: `localStorage` has no version migration~~ — DONE: added `version` + backfill `video`
- [ ] **Frontend**: no toast/notification component — reusing `captureStatus` as a flash-message slot
- [ ] **Color adjust**: brightness only (v1.7) — contrast / saturation / gamma could ride the same per-source `eq` pipeline + CSS preview if ever needed
- [ ] **Frontend**: `previewClip` watchdog uses `timeupdate` (~250ms) — may overshoot the clip end by ~0.2s
- [x] ~~**Cache-bust**: uses integer mtime (seconds)~~ — FIXED v1.7.1: uses `st_mtime_ns`

---

## 4. Key technical decisions

| Item | Decision | Notes |
|---|---|---|
| Encoder | `h264_nvenc -preset p5 -cq 20` | Tuned `hq`, VBR — high quality + fast on RTX Ada/Blackwell |
| Decoder | `-hwaccel cuda` (real) / default (slow) | Slow-mo drops hwaccel_output_format because `setpts` is a CPU filter |
| Concat | Demuxer + `-c copy` (no text) / re-encode + `drawtext` (with text) | Text overlays force one final NVENC pass so `t` = final-timeline time; audio still `-c copy` |
| Background music (v1.6) | Separate final pass: `-c:v copy` + `amix`/`sidechaincompress` (audio-only encode) | Modular + low-risk (leaves the text/concat paths untouched); video is assembled to a temp file, music pass writes the real output. `normalize=0` so volume sliders mean what they say |
| Music audition (v1.6) | Hidden `<audio>` slaved to the preview output position | Output time runs at 1× wall-clock through real + slow-mo, so a continuously-playing track stays synced; only drift > 0.35s is corrected. Browser `<audio>.volume` caps at 1.0 (render applies the true gain) |
| Music library (v1.6) | Drop files in `sounds/library/`, listed live by `GET /api/music` | `_safe_music_path` sandboxes selection; served at `/music-files` for audition; license notes in `CREDITS.md` (Pixabay = no attribution; bundled Kevin MacLeod = CC-BY) |
| Brightness (v1.7) | Per **source**, not per event/global | Dark footage is a property of the recording; one slider fixes every event from that source. `eq=contrast=k:brightness=(k-1)/2` = multiplicative gain = CSS `brightness(k)` → WYSIWYG preview |
| Text overlays | `drawtext` with `textfile=` (UTF-8) | Avoids filtergraph escaping; output-relative timing, intro added via `enable` offset; main render only |
| Text styling (v1.5) | `drawtext` `box`/`boxcolor@a` + `alpha='…'` fade + font-scaled `borderw` | Fade-out only when `end` set (total length unknown in the filter builder); commas live inside quoted option values so no escaping |
| Text reveal (v1.5) | Selecting a text seeks the playhead to its start | Visibility strictly follows each text's time window; only an inline-edited label is force-shown |
| Preview scrubbing (v1.5) | Raw bar disabled; output timeline only; coalesced seeks | Watchdog auto-advance only while playing; `syncPlayButtons` keeps play/pause icons truthful |
| Output res | `out_height` downscale (0 = native) | Standard tiers only, never upscales; >1440p caps at 2K |
| Source path | `_safe_source_path` resolves any absolute path | Local-only app; bare filenames still resolve under `workspace/raw` |
| Audio | AAC 48kHz stereo 192k | Uniform across segments; intro gets anullsrc if source has audio |
| Slow audio | Music override (loop `sounds/slow_motion.mp3`) → fallback atempo | Original audio dropped when music is present; atempo only takes 0.5–2.0 per filter |
| Progress | Parse `out_time_us=` from `-progress pipe:1` | Per-segment weight → monotonic progress across the whole job |
| Port | `:8770` | Avoids clashing with video_studio (`:8765`) |

---

## 5. How to run

```bat
:: First run — auto-sets up venv + installs deps
start.bat

:: Requirements
:: - Python 3.10+
:: - FFmpeg on PATH (winget install Gyan.FFmpeg)
:: - NVIDIA GPU with NVENC (RTX recommended)
```

Open http://127.0.0.1:8770, click **Choose source video…** to pick footage from any drive/folder, mark in/out (keys **I**/**O**), then click **Export highlight video**.

### v1.6 background-music — manual test checklist (✅ PASSED 2026-06-29 — all 8 steps verified)
First: **hard-refresh the browser** (Ctrl+Shift+R) so the new frontend loads (backend auto-reloads via `--reload`).
1. **Library loads** — `GET /api/music` lists tracks; names look clean (no `-instrumental-519455`).
2. **Strip shows in Preview** — turn on **▶ Preview output**; the 🎵 Background music strip appears under the text panel.
3. **Audition (standalone)** — pick a track, click **▶ Audition**; track plays, video pauses; click again to stop.
4. **Live mix** — press play in Preview; music plays in sync; drag **Music vol** / **Original vol** and hear the balance change; scrub the output timeline and confirm music re-aligns.
5. **Render with music** — Export; output has the music mixed, loops to fill, fade in/out audible, length unchanged.
6. **Ducking** — enable **Duck under audio** on a clip with loud original audio; music should dip under it.
7. **Silent source** — a source with no audio + music → output still has the music as soundtrack.
8. **Persistence** — reload the page / save+load a project; the music selection + settings come back.

---

## 6. Suggested next steps

0. ~~**Commit v1.4 / v1.5**~~ — DONE: v1.4 `6db33b8`, v1.5 `e18f0b1` + `5cd6ca4` (all on `master`). No git remote configured — set one up + push if backup/sharing is needed
0b. ~~**Commit v1.6**~~ — DONE `2e562a1` (background music; code + `CREDITS.md`). Library audio is gitignored (large binaries, ship separately like `slow_motion.mp3`). No git remote configured — push if backup/sharing is needed
0c. **Music — remaining roadmap**: upload-your-own track (`POST /api/music-upload`); a real music **lane on the CapCut output timeline** (offset/trim the track, multiple sections); music on the per-event Export; per-track loudness normalize
1. **Write README.md** with screenshots + a workflow demo GIF
2. **Create a `start` shell script** for Linux/macOS users (if cross-platform is needed)
3. **Add `pytest`** tests for `render._atempo_chain`, `render._expected_total_duration`, source/project path validation
4. **Thumbnail in the event table** — generate a small JPEG at each event's middle frame
5. **Player-name overlay** on slow-mo segments (Player 1 / Player 2) — reuse `drawtext` like the SLOW MOTION badge
6. **Job history view** — wire `GET /api/outputs` into the UI so past renders are listed
7. **Text editing — remaining roadmap** (Tier 2/3 discussed): colour palette/recent colours, arrow-key nudge, drag-to-resize handle, z-order; templates (lower-third / score / watermark), per-event text (so Export keeps overlays), and opening the text panel outside preview
