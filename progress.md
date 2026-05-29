# Highlight Creator — Tiến độ dự án

> Cập nhật: 2026-05-29 (multi-source input — ghép pha từ nhiều video nguồn vào 1 output)
> Trước đó: 2026-05-14 (thêm nhạc nền cho slow-motion)
> Web app local (FastAPI + Vanilla JS) để tạo video highlight từ video gốc, với intro card và slow-motion replay, dùng NVENC (RTX) để render nhanh.

---

## 1. Kiến trúc tổng quan

```
highlight_creator/
├── backend/
│   ├── main.py        # FastAPI app — routes, SSE progress, project CRUD
│   └── render.py      # Pipeline ffmpeg: probe → intro → real/slow → concat
├── frontend/
│   ├── index.html     # 4 card: Setup · Player · Clips · Render
│   ├── app.js         # State, capture (I/O), timeline, projects, SSE
│   └── style.css      # Theme tối, grid 3-cột responsive
├── workspace/
│   ├── raw/           # Video nguồn (đặt video vào đây)
│   ├── output/        # File highlight đã render
│   ├── projects/      # Project đã lưu (JSON)
│   └── temp/          # Segment trung gian (tự dọn sau mỗi job)
├── sounds/
│   └── slow_motion.mp3  # Nhạc nền cho mọi slow-motion segment (auto-loop)
├── requirements.txt   # fastapi, uvicorn, pillow, jinja2, python-multipart
└── start.bat          # Launcher 1-click: venv → deps → uvicorn :8770
```

**Stack:** Python 3.10+ · FastAPI 0.115 · Uvicorn · Pillow · FFmpeg (NVENC h264) · Vanilla JS (no framework)

---

## 2. Tính năng đã hoàn thành

### Backend
- [x] FastAPI app với static mount cho frontend + cache-bust theo mtime ([backend/main.py:51-64](backend/main.py#L51-L64))
- [x] List video trong `workspace/raw` ([backend/main.py:70-80](backend/main.py#L70-L80))
- [x] Probe video (width/height/fps/duration/has_audio) qua ffprobe ([backend/render.py:142-172](backend/render.py#L142-L172))
- [x] **Byte-range streaming** (HTTP 206) cho scrub mượt trên video 2K/4K ([backend/main.py:114-167](backend/main.py#L114-L167))
- [x] **Render pipeline** intro + (real, slow)*N + concat `-c copy` ([backend/render.py:474-582](backend/render.py#L474-L582))
- [x] **Multi-source input** — mỗi clip mang `video_path` riêng; `run_job` probe từng nguồn, lấy canvas = video đầu tiên, scale giữ aspect + letterbox (`force_original_aspect_ratio=decrease` + `pad` + `setsar=1`) nên ghép được video khác độ phân giải/fps/tỉ lệ ([backend/render.py:285-292](backend/render.py#L285-L292), [557-590](backend/render.py#L557-L590))
- [x] **Audio đồng nhất đa nguồn** — `need_audio = any(source có audio)`; nguồn câm được chèn track `anullsrc` im lặng để `concat -c copy` không vỡ ([backend/render.py:365-410](backend/render.py#L365-L410))
- [x] **Intro card** sinh PNG bằng Pillow (giải đấu + VĐV1 vs VĐV2) ([backend/render.py:188-238](backend/render.py#L188-L238))
- [x] **Slow-motion** với `setpts` + `atempo` chain (fallback nếu không có nhạc nền), badge "SLOW MOTION" góc phải ([backend/render.py:297-318](backend/render.py#L297-L318))
- [x] **Nhạc nền slow-motion** — thay audio gốc bằng `sounds/slow_motion.mp3`, auto-loop nếu pha dài hơn nhạc, cap đúng `out_duration` ([backend/render.py:391-468](backend/render.py#L391-L468))
- [x] **NVENC h264** preset p5, CQ 20 — tuned cho RTX 5060 Ti ([backend/render.py:54-62](backend/render.py#L54-L62))
- [x] **SSE progress stream** real-time cho từng job ([backend/main.py:429-461](backend/main.py#L429-L461))
- [x] **Job cancel** qua `threading.Event` ([backend/main.py:408-414](backend/main.py#L408-L414))
- [x] **Export single clip** (real-only hoặc real + slow-mo replay) ([backend/main.py:332-365](backend/main.py#L332-L365))
- [x] **Project CRUD** save/load/list/delete (JSON trong `workspace/projects`) ([backend/main.py:256-301](backend/main.py#L256-L301))
- [x] **List outputs** endpoint `GET /api/outputs` — liệt kê file đã render kèm `size_mb`/`mtime` ([backend/main.py:213-224](backend/main.py#L213-L224)) — ⚠️ frontend chưa gọi (sẵn để wire vào Job history)
- [x] **Open folder** trong File Explorer (Windows/macOS/Linux) ([backend/main.py:188-210](backend/main.py#L188-L210))
- [x] Validate path để chống path traversal ([backend/main.py:96-111](backend/main.py#L96-L111))
- [x] Tự dọn `workspace/temp` khi startup/shutdown ([backend/main.py:467-475](backend/main.py#L467-L475))

### Frontend
- [x] Layout 3-cột responsive (Setup · Player+Clips · Render) ([frontend/style.css:56-75](frontend/style.css#L56-L75))
- [x] **Custom timeline** với buffered/progress/thumb/tooltip + clip markers ([frontend/index.html:84-92](frontend/index.html#L84-L92))
- [x] **Custom control bar**: ±5/10/20s, play/pause, speed select (0.25×–2×), highlight toggle ([frontend/index.html:95-127](frontend/index.html#L95-L127))
- [x] **Keyboard shortcuts**: Space, ←/→, Shift+←/→, `,`/`.` (frame-by-frame), I/O (mark in/out), Ctrl+S (save) ([frontend/app.js:825-890](frontend/app.js#L825-L890))
- [x] **Capture flow** 1 nút toggle (start → end) ([frontend/app.js:306-340](frontend/app.js#L306-L340))
- [x] **Clip table** edit inline thời gian, ↑/↓ reorder, xoá, preview, export riêng ([frontend/app.js:382-409](frontend/app.js#L382-L409))
- [x] **Slow-mo per clip** (checkbox SLO) — bỏ chọn = chỉ render real-speed ([frontend/app.js:426-438](frontend/app.js#L426-L438))
- [x] **Project save/load UI** với validate tên, confirm overwrite ([frontend/app.js:570-633](frontend/app.js#L570-L633))
- [x] **Multi-source UI** — đổi video để thêm pha từ nhiều nguồn; mỗi pha gắn `video` + badge `V1/V2…` cột "Nguồn"; preview tự chuyển player sang đúng nguồn ([frontend/app.js:350-395](frontend/app.js#L350-L395), [457-490](frontend/app.js#L457-L490))
- [x] **Auto-persist state** vào `localStorage` (tournament, VĐV, slow %, clips kèm nguồn, video đang chọn) + **migration v1→v2** (backfill `video` cho clip cũ) ([frontend/app.js:74-114](frontend/app.js#L74-L114))
- [x] **SSE listener** + progress bar có shimmer, error state ([frontend/app.js:737-781](frontend/app.js#L737-L781))
- [x] **Render summary** real-time: tổng pha, slow-mo, intro, output ≈ Ns ([frontend/app.js:476-503](frontend/app.js#L476-L503))

### DevOps / Launcher
- [x] `start.bat` 1-click: auto tạo venv, cài deps, kiểm tra ffmpeg, free port :8770, mở browser ([start.bat:1-127](start.bat#L1-L127))
- [x] Auto-restart loop (tối đa 50 lần) + clear cache giữa các lần restart ([start.bat:89-120](start.bat#L89-L120))

---

## 3. Đang trống / Có thể cải thiện

### Chưa có
- [ ] **`start` shell script** cho Linux/macOS — file `start` rỗng (chỉ có `start.bat`)
- [ ] **README / hướng dẫn cài đặt** — chưa có README chính thức
- [ ] **Test** — chưa có unit/integration test
- [ ] **Job history** — sau khi đóng tab là mất, không xem được job cũ
- [ ] **Hậu xử lý audio**: chưa có normalize loudness / fade in-out giữa các segment
- [ ] **Subtitle / overlay tên VĐV** trên từng pha
- [x] ~~**Multi-video timeline**~~ — ĐÃ XONG 2026-05-29: ghép pha từ nhiều video nguồn vào 1 output

### Cải thiện đề xuất
- [ ] **Backend**: `_atempo_chain` có thể bị infinite loop với ratio quá nhỏ (đã clamp 0.05, ổn) — nên thêm test
- [ ] **Backend**: `concat_segments` đang xoá file `concat_*.txt` cũ vô điều kiện trong cleanup — có thể đụng job khác đang chạy cùng lúc
- [x] ~~**Frontend**: `localStorage` không version migration~~ — ĐÃ XONG: thêm `version` + backfill `video`
- [ ] **Frontend**: chưa có toast/notification component — đang reuse `captureStatus` làm chỗ flash message
- [ ] **Frontend**: `previewClip` watchdog dùng `timeupdate` (~250ms) — có thể trượt cuối clip ~0.2s
- [ ] **Resolution lock**: hiện đang cap fps ≤ 60 nhưng không cap resolution — video 4K sẽ render rất nặng
- [ ] **Cache-bust**: dùng mtime int (giây) — sửa file 2 lần trong 1 giây sẽ không invalidate

---

## 4. Mốc kỹ thuật quan trọng

| Hạng mục | Quyết định | Ghi chú |
|---|---|---|
| Encoder | `h264_nvenc -preset p5 -cq 20` | Tune `hq`, VBR — chất lượng cao + nhanh trên RTX Ada/Blackwell |
| Decoder | `-hwaccel cuda` (real) / mặc định (slow) | Slow-mo bỏ hwaccel_output_format vì `setpts` là CPU filter |
| Concat | Demuxer + `-c copy` | Mọi segment normalize cùng codec/resolution/fps để stitch instant |
| Audio | AAC 48kHz stereo 192k | Đồng nhất cho mọi segment; intro có anullsrc nếu video gốc có audio |
| Slow audio | Music override (loop `sounds/slow_motion.mp3`) → fallback atempo | Audio gốc bị drop khi có nhạc; atempo chỉ nhận 0.5–2.0 mỗi filter |
| Progress | Parse `out_time_us=` từ `-progress pipe:1` | Mỗi segment có weight riêng → progress monotonic toàn job |
| Port | `:8770` | Tránh đụng video_studio (`:8765`) |

---

## 5. Cách chạy

```bat
:: Lần đầu — auto setup venv + cài deps
start.bat

:: Yêu cầu
:: - Python 3.10+
:: - FFmpeg trên PATH (winget install Gyan.FFmpeg)
:: - NVIDIA GPU có NVENC (khuyến nghị RTX)
```

Bỏ video vào `workspace/raw/`, mở http://127.0.0.1:8770, mark in/out (phím **I**/**O**), bấm **Xuất video highlight**.

---

## 6. Next steps đề xuất

1. **Viết README.md** với screenshot + GIF demo workflow
2. **Tạo `start` shell script** cho người dùng Linux/macOS (nếu cần cross-platform)
3. **Thêm `pytest`** test cho `render._atempo_chain`, `render._expected_total_duration`, project path validation
4. **Thumbnail cho clip table** — sinh JPEG nhỏ ở frame giữa của mỗi pha
5. **Overlay tên VĐV** trên slow-mo segment (Player 1 / Player 2) — tận dụng `drawtext` như badge SLOW MOTION
