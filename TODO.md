# TODO — Highlight Creator

> Danh sách việc cần làm, sắp theo độ ưu tiên.
> Xem [progress.md](progress.md) để biết những gì đã xong.

---

## P0 — Quan trọng / Blocking

- [ ] **Viết README.md** với hướng dẫn cài đặt + screenshot + GIF demo workflow
  - Yêu cầu: Python 3.10+, FFmpeg trên PATH, NVIDIA GPU (NVENC)
  - Cách bỏ video vào `workspace/raw/`, mark in/out, render
  - Link tới [progress.md](progress.md) và file này

- [ ] **Hoàn thiện `start` shell script** cho Linux/macOS
  - File hiện tại đang rỗng (0 byte)
  - Mirror logic của [start.bat](start.bat): venv → deps → free port → uvicorn → mở browser
  - Dùng `xdg-open` (Linux) / `open` (macOS)

- [ ] **Fix race condition cleanup concat list** ([backend/render.py:574-582](backend/render.py#L574-L582))
  - Hiện đang `glob("concat_*.txt")` và xoá hết — có thể xoá nhầm file của job khác đang chạy song song
  - Sửa: chỉ xoá concat list của chính job này (thêm `job_id` vào tên file)

---

## P1 — Nên làm sớm

### Backend
- [ ] **Cap resolution input** — hiện chỉ cap fps ≤ 60, video 4K vẫn render full → rất nặng
  - Thêm option scale-down trong `RenderRequest` (1080p / 1440p / source)
  - Default: nếu width > 2560 thì scale về 1920×1080

- [ ] **Job history** lưu xuống `workspace/jobs/{job_id}.json`
  - Hiện job state chỉ tồn tại trong RAM (`_JOBS` dict) → đóng tab là mất
  - List 10 job gần nhất ở UI, click để xem output
  - 💡 Backend đã có sẵn `GET /api/outputs` ([backend/main.py:213-224](backend/main.py#L213-L224)) liệt kê file đã render — frontend **chưa gọi**. Bước nhanh nhất: wire endpoint này vào UI (danh sách output) trước khi làm job-history đầy đủ.

- [ ] **Audio normalize** với `loudnorm` filter
  - `sounds/slow_motion.mp3` có thể to/nhỏ khác audio gốc của video → cần normalize 2 nguồn về cùng LUFS
  - Optional flag trong [RenderRequest](backend/main.py#L313-L321)

- [ ] **Fade in/out cho nhạc slow-mo** (~0.2s)
  - Hiện nhạc bật/tắt thẳng → có thể nghe pop khi chuyển real → slow → real
  - Dùng `afade=t=in:d=0.2,afade=t=out:st={out_duration-0.2}:d=0.2` trên input nhạc

- [ ] **UI chọn nhạc slow-mo** trong Setup card
  - Hiện đang hardcode `sounds/slow_motion.mp3` — nên list tất cả file trong `sounds/` cho user chọn
  - Endpoint mới `GET /api/sounds`, dropdown trong frontend, lưu vào project payload

- [ ] **Fade transition** giữa các segment (crossfade 0.2-0.3s)
  - Hiện đang concat thẳng → đôi khi nghe pop khi cắt giữa real-speed và slow-mo
  - Dùng `xfade` + `acrossfade` (sẽ phải bỏ `-c copy` ở bước concat → chậm hơn)

### Frontend
- [ ] **Thumbnail cho mỗi clip** trong bảng
  - Sinh JPEG nhỏ ở frame giữa (`(start+end)/2`) qua ffmpeg `-ss ... -frames:v 1`
  - Cache vào `workspace/temp/thumb_{video}_{ms}.jpg`
  - Endpoint mới `/api/thumb/{video}?t=...`


- [ ] **Toast/notification component** riêng
  - Hiện đang reuse `captureStatus` làm flash message (`flashTopMessage`)
  - Conflict khi vừa đang capture vừa flash → message biến mất sớm

- [ ] **Drag-and-drop** video vào trang để upload vào `workspace/raw`
  - Hiện phải copy file thủ công vào folder

---

## P2 — Cải thiện chất lượng

- [ ] **Overlay tên VĐV** trên slow-mo segment
  - Player 1 / Player 2 ở góc dưới (giống badge "SLOW MOTION" nhưng góc khác)
  - Tận dụng `drawtext` filter có sẵn ([backend/render.py:297-318](backend/render.py#L297-L318))

- [ ] **Preview clip chính xác hơn** ([frontend/app.js:457-473](frontend/app.js#L457-L473))
  - Hiện dùng `timeupdate` event (~250ms granularity) → có thể trượt cuối clip ~0.2s
  - Thử `requestVideoFrameCallback` (Chrome) hoặc setInterval 50ms


- [ ] **Export preset**: Instagram (9:16), YouTube (16:9), TikTok (9:16 + 60s cap)
  - Auto crop/letterbox tuỳ preset

- [ ] **Undo/Redo** trong clip table (Ctrl+Z / Ctrl+Y)

---

## P3 — Testing & DevX

- [ ] **pytest** cho backend
  - `render._atempo_chain` (edge: ratio=0.01, ratio=2.0, ratio=0.5)
  - `render._expected_total_duration`
  - `main._safe_project_path` (path traversal attempts)
  - `main._safe_raw_path` / `_safe_output_path`

- [ ] **GitHub Actions CI**: lint (ruff) + pytest trên push
  - Cần khởi tạo git repo trước (hiện chưa phải git repo)

- [ ] **Dockerfile** (optional) cho người không muốn cài Python local
  - Cần GPU passthrough — NVIDIA Container Toolkit

- [ ] **Logging** structured (json) thay vì print
  - Hiện `_run_ffmpeg` chỉ giữ 40 dòng log gần nhất trong RAM → khó debug job lỗi

- [ ] **Type hints & mypy** check
  - Code đã dùng dataclass + Pydantic, nhưng vài chỗ `dict` thô

---

## Done — Lưu trữ

> Xem chi tiết ở [progress.md § Tính năng đã hoàn thành](progress.md#2-tính-năng-đã-hoàn-thành).

Tóm tắt: full pipeline render (intro + real + slow-mo + concat), NVENC, byte-range streaming, SSE progress, project CRUD, custom timeline + control bar, keyboard shortcuts, auto-persist state, single-clip export, launcher 1-click `start.bat`.

**2026-05-29:**
- **Multi-source input** — ghép pha highlight từ nhiều video nguồn vào 1 output. Mỗi clip mang `video` riêng;
  backend probe từng nguồn, canvas = video đầu tiên, scale giữ aspect + letterbox + `setsar=1` để concat `-c copy`
  chạy được dù video khác độ phân giải/fps/tỉ lệ; audio đồng nhất (`anullsrc` cho nguồn câm).
  UI: cột "Nguồn" (badge V1/V2…), preview tự chuyển nguồn, đổi video để tích luỹ pha.
  Đã verify: ghép 2688×1512@60 + 1280×720@90 → 1 clip 2688×1512 đồng nhất (ffprobe).
- **localStorage migration v1→v2** — thêm `version` field + backfill `video` cho clip cũ.
- Fix: map stream rõ ràng `0:v:0`/`0:a:0` (nguồn có >1 video stream như file 3-1 trước đây làm vỡ mp4 muxer).
