"""FastAPI server for Highlight Creator."""

from __future__ import annotations

import asyncio
import json
import mimetypes
import os
import re
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import (
    FileResponse,
    HTMLResponse,
    JSONResponse,
    Response,
    StreamingResponse,
)
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import render

ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = ROOT / "frontend"
RAW_DIR = render.RAW_DIR
OUT_DIR = render.OUT_DIR
PROJ_DIR = ROOT / "workspace" / "projects"
PROJ_DIR.mkdir(parents=True, exist_ok=True)

VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".m4v", ".avi", ".webm"}
CHUNK_SIZE = 1024 * 1024  # 1 MB chunks for byte-range streaming
PROJECT_NAME_RE = re.compile(r"^[A-Za-z0-9 _\-\.]{1,80}$")

app = FastAPI(title="Highlight Creator")


# --------------------------------------------------------------------------
# Static frontend
# --------------------------------------------------------------------------
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


@app.get("/", response_class=HTMLResponse)
async def index() -> HTMLResponse:
    html = (FRONTEND_DIR / "index.html").read_text(encoding="utf-8")
    # Cache-bust: append mtime as query string to JS/CSS so browsers
    # always fetch the latest version when files change.
    for asset in ("app.js", "style.css"):
        path = FRONTEND_DIR / asset
        if path.is_file():
            v = int(path.stat().st_mtime)
            html = html.replace(f"/static/{asset}", f"/static/{asset}?v={v}")
    return HTMLResponse(
        html,
        headers={"Cache-Control": "no-store, must-revalidate"},
    )


# --------------------------------------------------------------------------
# Video listing
# --------------------------------------------------------------------------
@app.get("/api/videos")
async def list_videos() -> JSONResponse:
    items = []
    if RAW_DIR.exists():
        for p in sorted(RAW_DIR.iterdir()):
            if p.is_file() and p.suffix.lower() in VIDEO_EXTS:
                items.append({
                    "name": p.name,
                    "size_mb": round(p.stat().st_size / (1024 * 1024), 1),
                })
    return JSONResponse({"videos": items, "raw_dir": str(RAW_DIR)})


@app.get("/api/probe/{filename}")
async def probe(filename: str) -> JSONResponse:
    path = _safe_raw_path(filename)
    info = render.probe_video(path)
    return JSONResponse(info)


# --------------------------------------------------------------------------
# Byte-range video streaming (smooth scrubbing on 2K)
# --------------------------------------------------------------------------
RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")


def _safe_raw_path(filename: str) -> Path:
    p = (RAW_DIR / filename).resolve()
    if RAW_DIR.resolve() not in p.parents and p != RAW_DIR.resolve():
        raise HTTPException(400, "Invalid path")
    if not p.is_file():
        raise HTTPException(404, "Not found")
    return p


def _safe_source_path(raw: str) -> Path:
    """Resolve a source video by absolute path anywhere on the local machine.

    The app is local-only (bound to 127.0.0.1, single operator), so sources are
    no longer confined to workspace/raw — the user browses their own disks and
    we process files in place. A bare filename (no separator) is treated as a
    legacy workspace/raw entry for backward compatibility with old projects.
    Only existing files with a known video extension are accepted.
    """
    raw = (raw or "").strip().strip('"')
    if not raw:
        raise HTTPException(400, "Thiếu đường dẫn video nguồn")
    p = Path(raw)
    if not p.is_absolute() and len(p.parts) == 1:
        p = RAW_DIR / raw  # legacy: bare name under workspace/raw
    try:
        p = p.resolve()
    except Exception:
        raise HTTPException(400, "Đường dẫn không hợp lệ")
    if not p.is_file():
        raise HTTPException(404, "File không tồn tại")
    if p.suffix.lower() not in VIDEO_EXTS:
        raise HTTPException(400, "Không phải file video")
    return p


def _safe_output_path(filename: str) -> Path:
    p = (OUT_DIR / filename).resolve()
    if OUT_DIR.resolve() not in p.parents and p != OUT_DIR.resolve():
        raise HTTPException(400, "Invalid path")
    if not p.is_file():
        raise HTTPException(404, "Not found")
    return p


def _stream_file(path: Path, request: Request) -> Response:
    """HTTP byte-range streaming so the <video> tag can scrub smoothly."""
    file_size = path.stat().st_size
    mime = mimetypes.guess_type(path.name)[0] or "video/mp4"
    range_header = request.headers.get("range") or request.headers.get("Range")

    if not range_header:
        # Whole-file response (rare for media tag, but supported)
        def whole():
            with path.open("rb") as f:
                while chunk := f.read(CHUNK_SIZE):
                    yield chunk
        return StreamingResponse(
            whole(),
            media_type=mime,
            headers={
                "Content-Length": str(file_size),
                "Accept-Ranges": "bytes",
                "Cache-Control": "no-cache",
            },
        )

    m = RANGE_RE.match(range_header)
    if not m:
        raise HTTPException(416, "Invalid range")
    start_s, end_s = m.group(1), m.group(2)
    start = int(start_s) if start_s else 0
    end = int(end_s) if end_s else file_size - 1
    end = min(end, file_size - 1)
    if start >= file_size or start > end:
        return Response(status_code=416, headers={
            "Content-Range": f"bytes */{file_size}",
        })

    length = end - start + 1

    def iterator():
        with path.open("rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk = f.read(min(CHUNK_SIZE, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk

    headers = {
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Accept-Ranges": "bytes",
        "Content-Length": str(length),
        "Cache-Control": "no-cache",
    }
    return StreamingResponse(iterator(), status_code=206, media_type=mime, headers=headers)


@app.get("/api/stream/{filename}")
async def stream(filename: str, request: Request):
    path = _safe_raw_path(filename)
    return _stream_file(path, request)


@app.get("/api/source-stream")
async def source_stream(path: str, request: Request):
    """Byte-range stream any source video by absolute path (local-only)."""
    return _stream_file(_safe_source_path(path), request)


@app.get("/api/source-probe")
async def source_probe(path: str) -> JSONResponse:
    """Probe any source video by absolute path."""
    return JSONResponse(render.probe_video(_safe_source_path(path)))


# --------------------------------------------------------------------------
# Filesystem browser — lets the user pick a source video from any drive/folder
# instead of copying it into workspace/raw. Local-only convenience.
# --------------------------------------------------------------------------
def _browse_shortcuts() -> List[dict]:
    sc: List[dict] = [{"name": "📁 workspace/raw", "path": str(RAW_DIR.resolve())}]
    home = Path.home()
    sc.append({"name": "🏠 Home", "path": str(home)})
    for sub in ("Videos", "Downloads", "Desktop"):
        d = home / sub
        if d.is_dir():
            sc.append({"name": f"📂 {sub}", "path": str(d)})
    return sc


def _browse_root() -> dict:
    """List drive roots (Windows) or '/' (POSIX)."""
    entries: List[dict] = []
    if os.name == "nt":
        import string
        for letter in string.ascii_uppercase:
            drive = f"{letter}:\\"
            if Path(drive).exists():
                entries.append({"name": drive, "path": drive, "is_dir": True})
    else:
        entries.append({"name": "/", "path": "/", "is_dir": True})
    return {"path": "", "parent": None, "is_root": True,
            "entries": entries, "shortcuts": _browse_shortcuts()}


@app.get("/api/browse")
async def browse(path: str = "") -> JSONResponse:
    path = (path or "").strip().strip('"')
    if not path:
        return JSONResponse(_browse_root())

    p = Path(path)
    try:
        p = p.resolve()
    except Exception:
        raise HTTPException(400, "Đường dẫn không hợp lệ")
    if p.is_file():
        p = p.parent  # given a file -> browse its folder
    if not p.is_dir():
        raise HTTPException(404, "Thư mục không tồn tại")

    dirs: List[dict] = []
    files: List[dict] = []
    try:
        children = sorted(p.iterdir(), key=lambda x: x.name.lower())
    except PermissionError:
        raise HTTPException(403, "Không có quyền truy cập thư mục này")
    for child in children:
        try:
            if child.is_dir():
                dirs.append({"name": child.name, "path": str(child), "is_dir": True})
            elif child.is_file() and child.suffix.lower() in VIDEO_EXTS:
                files.append({
                    "name": child.name, "path": str(child), "is_dir": False,
                    "size_mb": round(child.stat().st_size / (1024 * 1024), 1),
                })
        except (PermissionError, OSError):
            continue

    # "" means jump back to the drive/root list; reached at a drive root.
    parent = "" if p.parent == p else str(p.parent)
    return JSONResponse({
        "path": str(p), "parent": parent, "is_root": False,
        "entries": dirs + files, "shortcuts": _browse_shortcuts(),
    })


@app.get("/api/output/{filename}")
async def output_stream(filename: str, request: Request):
    path = _safe_output_path(filename)
    return _stream_file(path, request)


@app.get("/api/download/{filename}")
async def download(filename: str):
    path = _safe_output_path(filename)
    return FileResponse(path, filename=filename, media_type="video/mp4")


@app.post("/api/open-folder/{which}")
async def open_folder(which: str) -> JSONResponse:
    """Open the requested folder in the OS file manager.
    Local-only convenience: server runs on the user's machine."""
    folder_map = {
        "output": OUT_DIR,
        "raw": RAW_DIR,
        "projects": PROJ_DIR,
    }
    folder = folder_map.get(which)
    if folder is None:
        raise HTTPException(400, "Unknown folder")
    folder.mkdir(parents=True, exist_ok=True)
    try:
        if os.name == "nt":
            os.startfile(str(folder))  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(folder)])
        else:
            subprocess.Popen(["xdg-open", str(folder)])
    except Exception as e:
        raise HTTPException(500, f"Cannot open folder: {e}")
    return JSONResponse({"ok": True, "folder": str(folder)})


@app.get("/api/outputs")
async def list_outputs() -> JSONResponse:
    items = []
    if OUT_DIR.exists():
        for p in sorted(OUT_DIR.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
            if p.is_file() and p.suffix.lower() in VIDEO_EXTS:
                items.append({
                    "name": p.name,
                    "size_mb": round(p.stat().st_size / (1024 * 1024), 1),
                    "mtime": p.stat().st_mtime,
                })
    return JSONResponse({"outputs": items})


# --------------------------------------------------------------------------
# Projects: save / load / list / delete
# --------------------------------------------------------------------------
class ProjectClip(BaseModel):
    start: float
    end: float
    slowmo: bool = True
    video: str = ""  # source video for this clip (multi-source projects)


class ProjectPayload(BaseModel):
    name: str
    tournament: str = ""
    player1: str = ""
    player2: str = ""
    intro_seconds: float = 4.0
    slow_percent: int = 50
    video: str = ""
    clips: List[ProjectClip] = []


def _safe_project_path(name: str) -> Path:
    if not PROJECT_NAME_RE.match(name):
        raise HTTPException(400, "Tên project chỉ được dùng chữ/số/khoảng trắng/_-. (max 80 ký tự)")
    p = (PROJ_DIR / f"{name}.json").resolve()
    if PROJ_DIR.resolve() not in p.parents:
        raise HTTPException(400, "Đường dẫn không hợp lệ")
    return p


@app.get("/api/projects")
async def list_projects() -> JSONResponse:
    items = []
    if PROJ_DIR.exists():
        for p in sorted(PROJ_DIR.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
            if p.is_file() and p.suffix.lower() == ".json":
                items.append({
                    "name": p.stem,
                    "size": p.stat().st_size,
                    "mtime": p.stat().st_mtime,
                })
    return JSONResponse({"projects": items})


@app.post("/api/projects")
async def save_project(payload: ProjectPayload) -> JSONResponse:
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Tên project không được để trống")
    path = _safe_project_path(name)
    data = payload.model_dump()
    data["name"] = name  # normalised
    data["saved_at"] = time.time()
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return JSONResponse({"ok": True, "name": name})


@app.get("/api/projects/{name}")
async def load_project(name: str) -> JSONResponse:
    path = _safe_project_path(name)
    if not path.is_file():
        raise HTTPException(404, "Project không tồn tại")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        raise HTTPException(500, f"Lỗi đọc project: {e}")
    return JSONResponse(data)


@app.delete("/api/projects/{name}")
async def delete_project(name: str) -> JSONResponse:
    path = _safe_project_path(name)
    if not path.is_file():
        raise HTTPException(404, "Project không tồn tại")
    path.unlink()
    return JSONResponse({"ok": True})


# --------------------------------------------------------------------------
# Render job API
# --------------------------------------------------------------------------
class ClipModel(BaseModel):
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    slowmo: bool = True
    video: str = ""  # source video for this clip; falls back to RenderRequest.video


class RenderRequest(BaseModel):
    video: str = ""  # fallback source for clips that don't specify their own
    clips: List[ClipModel]
    slow_percent: int = Field(ge=10, le=100, default=50)  # 50 = play at 50% speed
    intro_seconds: float = Field(ge=0, le=15, default=4.0)
    tournament: str = ""
    player1: str = ""
    player2: str = ""
    out_height: int = Field(ge=0, le=2160, default=0)  # 0 = native source height


class ExportClipRequest(BaseModel):
    video: str
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    include_slowmo: bool = False
    slow_percent: int = Field(ge=10, le=100, default=50)
    label: str = ""
    out_height: int = Field(ge=0, le=2160, default=0)  # 0 = native source height


@app.post("/api/export-clip")
async def export_clip(req: ExportClipRequest) -> JSONResponse:
    """Export a single highlight as its own file.
    - include_slowmo=False -> just the real-speed cut
    - include_slowmo=True  -> real-speed + slow-mo (with SLOW MOTION badge)
    """
    if req.end <= req.start:
        raise HTTPException(400, "Invalid clip range")
    video_path = _safe_source_path(req.video)

    clip = render.Clip(start=req.start, end=req.end, slowmo=req.include_slowmo,
                       video_path=video_path)

    stem = Path(req.video).stem
    raw_label = req.label.strip() or f"t{req.start:.1f}-t{req.end:.1f}"
    label = re.sub(r"[^A-Za-z0-9_\-\.]+", "_", raw_label).strip("_") or "clip"
    mode = "real_slow" if req.include_slowmo else "real"
    output_basename = f"{stem}_{label}_{mode}"

    job = render.RenderJob(
        job_id=uuid.uuid4().hex[:12],
        video_path=video_path,
        clips=[clip],
        slow_ratio=req.slow_percent / 100.0,
        intro_seconds=0.0,           # no intro for single-clip export
        tournament="",
        player1="",
        player2="",
        output_basename=output_basename,
        out_height=req.out_height,
    )
    render.register_job(job)

    t = threading.Thread(target=render.run_job, args=(job,), daemon=True)
    t.start()
    return JSONResponse({"job_id": job.job_id})


@app.post("/api/render")
async def start_render(req: RenderRequest) -> JSONResponse:
    if not req.clips:
        raise HTTPException(400, "No clips selected")

    # Resolve each clip's source video (multi-source). A clip uses its own
    # `video`, falling back to the request-level `video`. Validate + sandbox
    # every distinct path via _safe_raw_path. Cache resolved paths per name.
    resolved: dict = {}

    def resolve(name: str) -> Path:
        name = (name or "").strip()
        if not name:
            raise HTTPException(400, "Clip thiếu video nguồn")
        if name not in resolved:
            resolved[name] = _safe_source_path(name)
        return resolved[name]

    # Validate clip ranges + sources
    clips = []
    for c in req.clips:
        if c.end <= c.start:
            raise HTTPException(400, f"Invalid clip {c.start}-{c.end}")
        src = resolve(c.video or req.video)
        clips.append(render.Clip(start=c.start, end=c.end, slowmo=c.slowmo,
                                 video_path=src))

    # video_path on the job is just a fallback; use the first clip's source.
    job = render.RenderJob(
        job_id=uuid.uuid4().hex[:12],
        video_path=clips[0].video_path,
        clips=clips,
        slow_ratio=req.slow_percent / 100.0,
        intro_seconds=req.intro_seconds,
        tournament=req.tournament,
        player1=req.player1,
        player2=req.player2,
        out_height=req.out_height,
    )
    render.register_job(job)

    t = threading.Thread(target=render.run_job, args=(job,), daemon=True)
    t.start()

    return JSONResponse({"job_id": job.job_id})


@app.get("/api/job/{job_id}")
async def job_status(job_id: str) -> JSONResponse:
    job = render.get_job(job_id)
    if not job:
        raise HTTPException(404, "Unknown job")
    return JSONResponse(_job_payload(job))


@app.post("/api/job/{job_id}/cancel")
async def job_cancel(job_id: str) -> JSONResponse:
    job = render.get_job(job_id)
    if not job:
        raise HTTPException(404, "Unknown job")
    job.cancel.set()
    return JSONResponse({"ok": True})


def _job_payload(job: render.RenderJob) -> dict:
    return {
        "job_id": job.job_id,
        "status": job.status,
        "percent": job.percent,
        "stage": job.stage,
        "message": job.message,
        "output_file": job.output_file,
        "error": job.error,
    }


@app.get("/api/progress/{job_id}")
async def progress_stream(job_id: str, request: Request):
    """Server-Sent Events: pushes job state until done/error."""
    job = render.get_job(job_id)
    if not job:
        raise HTTPException(404, "Unknown job")

    async def gen():
        last_payload = None
        while True:
            if await request.is_disconnected():
                return
            current = render.get_job(job_id)
            if current is None:
                yield "event: error\ndata: {}\n\n"
                return
            payload = _job_payload(current)
            if payload != last_payload:
                yield f"data: {json.dumps(payload)}\n\n"
                last_payload = payload
            if current.status in ("done", "error"):
                return
            await asyncio.sleep(0.4)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# --------------------------------------------------------------------------
# Lifecycle
# --------------------------------------------------------------------------
@app.on_event("startup")
async def _startup():
    # Wipe temp from any previous crashed run.
    render.cleanup_temp()


@app.on_event("shutdown")
async def _shutdown():
    render.cleanup_temp()
