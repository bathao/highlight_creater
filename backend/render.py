"""
FFmpeg render pipeline for Highlight Creator.

Pipeline:
  1. Probe input video (resolution / fps).
  2. Generate intro PNG via Pillow, encode to short MP4 with NVENC.
  3. For every selected clip, produce two segments:
        - Real-speed cut
        - Slow-motion cut (setpts factor = 1 / slow_ratio)
     All segments are normalised to the same codec/resolution/fps so the
     concat demuxer can stitch them with `-c copy` (frame-accurate, instant).
  4. Concat: intro + (real, slow) * N
  5. Clean up workspace/temp.

Hardware acceleration:
  - Decode: -hwaccel cuda -hwaccel_output_format cuda when possible.
    For setpts (cpu filter) we let ffmpeg auto-download via the implicit
    hwdownload, so we drop -hwaccel_output_format on slowmo segments.
  - Encode: h264_nvenc (preset p5, CQ-based VBR for quality) on every segment.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, List, Optional

from PIL import Image, ImageDraw, ImageFont


# --------------------------------------------------------------------------
# Paths
# --------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "workspace" / "raw"
OUT_DIR = ROOT / "workspace" / "output"
TEMP_DIR = ROOT / "workspace" / "temp"
SOUNDS_DIR = ROOT / "sounds"
SLOWMO_AUDIO = SOUNDS_DIR / "slow_motion.mp3"

for d in (RAW_DIR, OUT_DIR, TEMP_DIR):
    d.mkdir(parents=True, exist_ok=True)


# --------------------------------------------------------------------------
# Encoder defaults — tuned for RTX 5060 Ti (Ada/Blackwell NVENC)
# --------------------------------------------------------------------------
NVENC_ARGS = [
    "-c:v", "h264_nvenc",
    "-preset", "p5",        # p1 fastest .. p7 slowest. p5 = balanced quality.
    "-tune", "hq",
    "-rc", "vbr",
    "-cq", "20",            # constant-quality target; lower = better
    "-b:v", "0",
    "-pix_fmt", "yuv420p",
]

# Audio normalisation — every segment is encoded with these params so the
# concat demuxer can stitch with `-c copy` without bitstream-level mismatches.
AAC_ARGS = ["-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "192k"]

DEFAULT_FPS = 60   # fallback when probe fails


def _atempo_chain(ratio: float) -> str:
    """Build an atempo filter chain that slows audio to `ratio` speed.
    atempo only accepts 0.5..2.0 per filter, so chain 0.5 stages until the
    remainder fits."""
    parts = []
    r = max(0.05, float(ratio))
    while r < 0.5:
        parts.append("atempo=0.5")
        r *= 2.0
    parts.append(f"atempo={r:.5f}")
    return ",".join(parts)


# --------------------------------------------------------------------------
# Job state
# --------------------------------------------------------------------------
@dataclass
class Clip:
    start: float
    end: float
    slowmo: bool = True  # if False: only real-speed segment, no slow-mo
    video_path: Optional[Path] = None  # source video for this clip (multi-source)

    @property
    def duration(self) -> float:
        return max(0.01, self.end - self.start)


@dataclass
class RenderJob:
    job_id: str
    video_path: Path           # fallback source for clips without their own video_path
    clips: List[Clip]
    slow_ratio: float           # 0.5 = 50% speed (= 2x slower)
    intro_seconds: float
    tournament: str
    player1: str
    player2: str

    # When set, output filename is `{output_basename}_{ts}.mp4` instead of
    # the tournament-derived default. Used by single-clip export.
    output_basename: Optional[str] = None

    # progress state
    status: str = "pending"     # pending | running | done | error
    percent: float = 0.0
    stage: str = ""
    message: str = ""
    output_file: str = ""
    error: str = ""

    # internal
    cancel: threading.Event = field(default_factory=threading.Event)


_JOBS: Dict[str, RenderJob] = {}
_JOBS_LOCK = threading.Lock()


def get_job(job_id: str) -> Optional[RenderJob]:
    with _JOBS_LOCK:
        return _JOBS.get(job_id)


def register_job(job: RenderJob) -> None:
    with _JOBS_LOCK:
        _JOBS[job.job_id] = job


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
def probe_video(path: Path) -> dict:
    """Return width, height, fps, duration, has_audio. Falls back to safe defaults."""
    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "stream=index,codec_type,width,height,r_frame_rate,duration",
        "-show_entries", "format=duration",
        "-of", "json", str(path),
    ]
    try:
        out = subprocess.check_output(cmd, stderr=subprocess.STDOUT)
        data = json.loads(out)
        streams = data.get("streams", [])
        v = next((s for s in streams if s.get("codec_type") == "video"), None) or {}
        has_audio = any(s.get("codec_type") == "audio" for s in streams)

        w = int(v.get("width", 1920))
        h = int(v.get("height", 1080))
        rfr = v.get("r_frame_rate", f"{DEFAULT_FPS}/1")
        num, den = rfr.split("/")
        fps = float(num) / float(den) if float(den) else DEFAULT_FPS
        duration = float(v.get("duration") or data.get("format", {}).get("duration") or 0.0)
        fps = round(fps, 3)
        return {
            "width": w, "height": h, "fps": fps,
            "duration": duration, "has_audio": has_audio,
        }
    except Exception:
        return {
            "width": 1920, "height": 1080, "fps": DEFAULT_FPS,
            "duration": 0.0, "has_audio": False,
        }


def _find_font() -> Optional[str]:
    candidates = [
        "C:/Windows/Fonts/arialbd.ttf",
        "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/segoeuib.ttf",
        "C:/Windows/Fonts/segoeui.ttf",
    ]
    for c in candidates:
        if Path(c).is_file():
            return c
    return None


def _make_intro_png(out_png: Path, width: int, height: int,
                    tournament: str, player1: str, player2: str) -> None:
    """Render intro card as PNG using Pillow (avoids ffmpeg drawtext quoting hell)."""
    img = Image.new("RGB", (width, height), (8, 12, 24))
    draw = ImageDraw.Draw(img)

    # Subtle gradient strip for visual interest
    for y in range(height):
        t = y / height
        r = int(8 + 30 * t)
        g = int(12 + 60 * t)
        b = int(24 + 120 * t)
        draw.line([(0, y), (width, y)], fill=(r, g, b))

    font_path = _find_font()
    base = max(40, height // 18)
    f_title = ImageFont.truetype(font_path, base * 2) if font_path else ImageFont.load_default()
    f_sub = ImageFont.truetype(font_path, base) if font_path else ImageFont.load_default()
    f_vs = ImageFont.truetype(font_path, int(base * 1.4)) if font_path else ImageFont.load_default()

    def centered_text(text: str, y: int, font, fill=(255, 255, 255)):
        bbox = draw.textbbox((0, 0), text, font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        draw.text(((width - tw) / 2, y), text, font=font, fill=fill)
        return th

    title = (tournament or "HIGHLIGHTS").strip().upper()
    p1 = (player1 or "PLAYER 1").strip().upper()
    p2 = (player2 or "PLAYER 2").strip().upper()

    # Layout: title at top third, players row at center, label at bottom
    centered_text(title, int(height * 0.28), f_title, fill=(255, 235, 120))

    # vs row
    bbox1 = draw.textbbox((0, 0), p1, font=f_sub)
    bboxv = draw.textbbox((0, 0), "vs", font=f_vs)
    bbox2 = draw.textbbox((0, 0), p2, font=f_sub)
    gap = base
    total = (bbox1[2] - bbox1[0]) + (bboxv[2] - bboxv[0]) + (bbox2[2] - bbox2[0]) + gap * 2
    y_mid = int(height * 0.5)
    x = int((width - total) / 2)
    draw.text((x, y_mid), p1, font=f_sub, fill=(255, 255, 255))
    x += (bbox1[2] - bbox1[0]) + gap
    draw.text((x, y_mid - base // 4), "vs", font=f_vs, fill=(180, 200, 255))
    x += (bboxv[2] - bboxv[0]) + gap
    draw.text((x, y_mid), p2, font=f_sub, fill=(255, 255, 255))

    centered_text("HIGHLIGHTS", int(height * 0.72), f_sub, fill=(180, 200, 255))

    img.save(out_png, "PNG")


def _run_ffmpeg(
    args: List[str],
    expected_duration: float,
    on_progress: Callable[[float], None],
    cancel: threading.Event,
) -> None:
    """Run ffmpeg and feed segment-progress (0..1) into on_progress."""
    proc = subprocess.Popen(
        args,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )

    out_time_re = re.compile(r"out_time_us=(\d+)")
    last_log_lines: List[str] = []

    try:
        for line in proc.stdout:  # type: ignore[union-attr]
            if cancel.is_set():
                proc.kill()
                raise RuntimeError("Cancelled")
            line = line.strip()
            if line:
                last_log_lines.append(line)
                if len(last_log_lines) > 40:
                    last_log_lines.pop(0)
            m = out_time_re.search(line)
            if m and expected_duration > 0:
                seconds = int(m.group(1)) / 1_000_000.0
                pct = max(0.0, min(1.0, seconds / expected_duration))
                on_progress(pct)
    finally:
        proc.wait()

    if proc.returncode != 0:
        tail = "\n".join(last_log_lines[-20:])
        raise RuntimeError(f"ffmpeg exited {proc.returncode}\n{tail}")


def _video_filter(width: int, height: int, fps: float, setpts: Optional[float] = None) -> str:
    parts = []
    if setpts is not None:
        parts.append(f"setpts={setpts:.5f}*PTS")
    # Aspect-preserving scale + letterbox pad so sources of any resolution/aspect
    # land on the same canvas without stretching. For a source already matching
    # the target this is an identity (scale = no-op, pad = 0). setsar=1 forces
    # square pixels so every segment shares SAR/DAR -> concat -c copy stays valid.
    parts.append(f"scale={width}:{height}:force_original_aspect_ratio=decrease:flags=lanczos")
    parts.append(f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black")
    parts.append("setsar=1")
    parts.append(f"fps={fps}")
    parts.append("format=yuv420p")
    return ",".join(parts)


def _audio_args_or_none(has_audio: bool) -> List[str]:
    return AAC_ARGS if has_audio else ["-an"]


def _slowmo_badge_filter(video_height: int) -> str:
    """Return a drawtext filter that paints a tasteful 'SLOW MOTION' pill in
    the top-right corner. Falls back to empty string if no font is available."""
    font = _find_font()
    if not font:
        return ""
    # FFmpeg filter syntax escaping: forward slashes work on Windows; the
    # colon after the drive letter must be backslash-escaped.
    font_esc = font.replace("\\", "/").replace(":", r"\:")
    fontsize = max(20, int(video_height / 32))   # ~33px @ 1080p
    margin   = max(18, int(video_height / 60))   # corner padding
    pad_x    = fontsize // 2
    pad_y    = fontsize // 3
    return (
        f"drawtext=fontfile='{font_esc}'"
        f":text='SLOW MOTION'"
        f":fontsize={fontsize}"
        f":fontcolor=white"
        f":box=1:boxcolor=black@0.55:boxborderw={pad_x}|{pad_y}"
        f":x=w-text_w-{margin}-{pad_x}"
        f":y={margin}+{pad_y}"
    )


# --------------------------------------------------------------------------
# Segment builders
# --------------------------------------------------------------------------
def render_intro(
    job: RenderJob,
    out_path: Path,
    width: int,
    height: int,
    fps: float,
    need_audio: bool,
    on_progress: Callable[[float], None],
) -> None:
    png = TEMP_DIR / f"{job.job_id}_intro.png"
    _make_intro_png(png, width, height, job.tournament, job.player1, job.player2)

    args = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-progress", "pipe:1", "-nostats",
        "-loop", "1",
        "-t", f"{job.intro_seconds:.3f}",
        "-i", str(png),
    ]
    if need_audio:
        # Generate silent stereo track to keep concat audio stream consistent
        args += [
            "-f", "lavfi",
            "-t", f"{job.intro_seconds:.3f}",
            "-i", "anullsrc=r=48000:cl=stereo",
        ]
    args += [
        "-r", f"{fps}",
        "-vf", _video_filter(width, height, fps),
        *NVENC_ARGS,
    ]
    if need_audio:
        args += ["-map", "0:v:0", "-map", "1:a", "-shortest", *AAC_ARGS]
    else:
        args += ["-an"]
    args += ["-movflags", "+faststart", str(out_path)]
    _run_ffmpeg(args, job.intro_seconds, on_progress, job.cancel)


def render_real(
    job: RenderJob,
    clip: Clip,
    out_path: Path,
    width: int,
    height: int,
    fps: float,
    source_has_audio: bool,
    need_audio: bool,
    on_progress: Callable[[float], None],
) -> None:
    src = clip.video_path or job.video_path
    args = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-progress", "pipe:1", "-nostats",
        "-hwaccel", "cuda",
        "-ss", f"{clip.start:.3f}",
        "-to", f"{clip.end:.3f}",
        "-i", str(src),
    ]
    if source_has_audio:
        # Map the source's own audio.
        args += [
            "-vf", _video_filter(width, height, fps),
            *NVENC_ARGS,
            *AAC_ARGS,
        ]
    elif need_audio:
        # Source is silent but the job needs a uniform audio track for concat:
        # attach a generated silent stereo track.
        args += [
            "-f", "lavfi", "-t", f"{clip.duration:.3f}",
            "-i", "anullsrc=r=48000:cl=stereo",
            "-vf", _video_filter(width, height, fps),
            "-map", "0:v:0", "-map", "1:a", "-shortest",
            *NVENC_ARGS,
            *AAC_ARGS,
        ]
    else:
        args += [
            "-map", "0:v:0",
            "-vf", _video_filter(width, height, fps),
            *NVENC_ARGS,
            "-an",
        ]
    args += ["-movflags", "+faststart", str(out_path)]
    _run_ffmpeg(args, clip.duration, on_progress, job.cancel)


def render_slowmo(
    job: RenderJob,
    clip: Clip,
    out_path: Path,
    width: int,
    height: int,
    fps: float,
    source_has_audio: bool,
    need_audio: bool,
    on_progress: Callable[[float], None],
) -> None:
    src = clip.video_path or job.video_path
    factor = 1.0 / max(0.05, job.slow_ratio)  # 0.5 -> 2.0
    out_duration = clip.duration * factor

    badge = _slowmo_badge_filter(height)
    vf = _video_filter(width, height, fps, setpts=factor)
    if badge:
        vf = f"{vf},{badge}"

    # Slow-mo audio strategy (must yield an audio track whenever the job needs one
    # so every segment concats with -c copy):
    #   1. If sounds/slow_motion.mp3 exists AND job needs audio -> replace audio
    #      with the music (looped to fill out_duration). Works even for silent
    #      sources since the music is independent of the source audio.
    #   2. Else if source has audio -> atempo-slowed original audio.
    #   3. Else if job needs audio (silent source) -> generated silent track.
    #   4. Else -> no audio.
    use_music = need_audio and SLOWMO_AUDIO.is_file()

    if use_music:
        args = [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-progress", "pipe:1", "-nostats",
            "-hwaccel", "cuda",
            "-ss", f"{clip.start:.3f}",
            "-to", f"{clip.end:.3f}",
            "-i", str(src),
            # Loop the music indefinitely, cap at slow-mo duration. Both options
            # must precede -i to apply to that input.
            "-stream_loop", "-1",
            "-t", f"{out_duration:.3f}",
            "-i", str(SLOWMO_AUDIO),
            "-vf", vf,
            "-map", "0:v:0",
            "-map", "1:a",
            "-shortest",
            *NVENC_ARGS,
            *AAC_ARGS,
            "-movflags", "+faststart",
            str(out_path),
        ]
    elif source_has_audio:
        atempo = _atempo_chain(job.slow_ratio)
        fc = f"[0:v:0]{vf}[v];[0:a:0]{atempo}[a]"
        args = [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-progress", "pipe:1", "-nostats",
            "-hwaccel", "cuda",
            "-ss", f"{clip.start:.3f}",
            "-to", f"{clip.end:.3f}",
            "-i", str(src),
            "-filter_complex", fc,
            "-map", "[v]", "-map", "[a]",
            *NVENC_ARGS,
            *AAC_ARGS,
            "-movflags", "+faststart",
            str(out_path),
        ]
    elif need_audio:
        # Silent source but the job needs a uniform audio track.
        args = [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-progress", "pipe:1", "-nostats",
            "-hwaccel", "cuda",
            "-ss", f"{clip.start:.3f}",
            "-to", f"{clip.end:.3f}",
            "-i", str(src),
            "-f", "lavfi", "-t", f"{out_duration:.3f}",
            "-i", "anullsrc=r=48000:cl=stereo",
            "-vf", vf,
            "-map", "0:v:0", "-map", "1:a", "-shortest",
            *NVENC_ARGS,
            *AAC_ARGS,
            "-movflags", "+faststart",
            str(out_path),
        ]
    else:
        args = [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-progress", "pipe:1", "-nostats",
            "-hwaccel", "cuda",
            "-ss", f"{clip.start:.3f}",
            "-to", f"{clip.end:.3f}",
            "-i", str(src),
            "-vf", vf,
            *NVENC_ARGS,
            "-an",
            "-movflags", "+faststart",
            str(out_path),
        ]
    _run_ffmpeg(args, out_duration, on_progress, job.cancel)


def concat_segments(segments: List[Path], out_path: Path,
                    expected_duration: float,
                    on_progress: Callable[[float], None],
                    cancel: threading.Event) -> None:
    list_file = TEMP_DIR / f"concat_{uuid.uuid4().hex}.txt"
    with list_file.open("w", encoding="utf-8") as f:
        for seg in segments:
            # ffmpeg concat list: forward slashes work on Windows; quote with single
            posix = str(seg).replace("\\", "/")
            f.write(f"file '{posix}'\n")

    args = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-progress", "pipe:1", "-nostats",
        "-f", "concat", "-safe", "0",
        "-i", str(list_file),
        "-c", "copy",
        "-movflags", "+faststart",
        str(out_path),
    ]
    _run_ffmpeg(args, expected_duration, on_progress, cancel)


# --------------------------------------------------------------------------
# Top-level job runner
# --------------------------------------------------------------------------
def _expected_total_duration(job: RenderJob) -> float:
    factor = 1.0 / max(0.05, job.slow_ratio)
    real = sum(c.duration for c in job.clips)
    slow = sum(c.duration * factor for c in job.clips if c.slowmo)
    return job.intro_seconds + real + slow


def run_job(job: RenderJob) -> None:
    """Blocking. Caller is responsible for running in a thread."""
    job.status = "running"
    job.stage = "probing"
    job.message = "Probing input..."

    try:
        # Collect unique source videos in first-appearance order. Each clip may
        # carry its own video_path (multi-source); fall back to job.video_path.
        source_order: List[Path] = []
        for c in job.clips:
            sp = c.video_path or job.video_path
            if sp not in source_order:
                source_order.append(sp)
        if not source_order:
            source_order = [job.video_path]

        # Probe every distinct source once; cache the info.
        source_info: Dict[Path, dict] = {}
        for sp in source_order:
            source_info[sp] = probe_video(sp)

        # Canvas = resolution of the FIRST source (the first clip's video).
        # Every segment is scaled+letterboxed onto this canvas so concat works.
        first = source_info[source_order[0]]
        width, height, fps = first["width"], first["height"], first["fps"]
        # Cap fps at 60 for slow-mo headroom; concat needs uniform timing.
        if fps > 60:
            fps = 60.0

        # If ANY source has audio, every segment must carry an audio track so the
        # final concat -c copy has a consistent stream layout. Silent sources get
        # a generated silent track.
        need_audio = any(bool(i.get("has_audio", False)) for i in source_info.values())

        def clip_has_audio(clip: Clip) -> bool:
            sp = clip.video_path or job.video_path
            return bool(source_info.get(sp, {}).get("has_audio", False))

        # Plan the work: per-segment weights so progress is monotonic.
        intro_weight = job.intro_seconds
        factor = 1.0 / max(0.05, job.slow_ratio)
        real_weights = [c.duration for c in job.clips]
        slow_weights = [c.duration * factor if c.slowmo else 0.0 for c in job.clips]
        concat_weight = sum([intro_weight] + real_weights + slow_weights) * 0.05  # quick (-c copy)

        total = intro_weight + sum(real_weights) + sum(slow_weights) + concat_weight
        if total <= 0:
            total = 1.0
        completed = 0.0

        def stage_progress(weight: float):
            def cb(pct: float):
                job.percent = round(min(0.999, (completed + pct * weight) / total) * 100, 2)
            return cb

        segments: List[Path] = []

        # 1. Intro (skip if intro_seconds <= 0; e.g. single-clip exports)
        if job.intro_seconds > 0.05:
            job.stage = "intro"
            job.message = "Rendering intro..."
            intro_file = TEMP_DIR / f"{job.job_id}_00_intro.mp4"
            render_intro(job, intro_file, width, height, fps, need_audio,
                         stage_progress(intro_weight))
            segments.append(intro_file)
            completed += intro_weight

        # 2. Per-clip real + (optional) slow
        for idx, clip in enumerate(job.clips, start=1):
            if job.cancel.is_set():
                raise RuntimeError("Cancelled")

            job.stage = f"clip {idx}/{len(job.clips)} - real"
            job.message = f"Rendering clip {idx} (real-speed)..."
            real_file = TEMP_DIR / f"{job.job_id}_{idx:02d}_real.mp4"
            render_real(job, clip, real_file, width, height, fps,
                        clip_has_audio(clip), need_audio,
                        stage_progress(clip.duration))
            segments.append(real_file)
            completed += clip.duration

            if clip.slowmo:
                job.stage = f"clip {idx}/{len(job.clips)} - slowmo"
                job.message = f"Rendering clip {idx} (slow-mo {int(job.slow_ratio*100)}%)..."
                slow_file = TEMP_DIR / f"{job.job_id}_{idx:02d}_slow.mp4"
                render_slowmo(job, clip, slow_file, width, height, fps,
                              clip_has_audio(clip), need_audio,
                              stage_progress(clip.duration * factor))
                segments.append(slow_file)
                completed += clip.duration * factor

        # 3. Concat — or move single segment when only one exists
        ts = time.strftime("%Y%m%d_%H%M%S")
        if job.output_basename:
            safe_name = re.sub(r"[^A-Za-z0-9_-]+", "_", job.output_basename).strip("_") or "clip"
        else:
            safe_name = re.sub(r"[^A-Za-z0-9_-]+", "_", job.tournament or "highlights").strip("_") or "highlights"
        out_name = f"{safe_name}_{ts}.mp4"
        out_path = OUT_DIR / out_name

        if len(segments) == 1:
            # Single-segment export (e.g. real-only single clip with no intro):
            # rename instead of running concat.
            job.stage = "finalising"
            job.message = "Saving output..."
            shutil.move(str(segments[0]), str(out_path))
        else:
            job.stage = "concat"
            job.message = "Stitching final video..."
            concat_segments(segments, out_path,
                            _expected_total_duration(job),
                            stage_progress(concat_weight),
                            job.cancel)
        completed += concat_weight

        job.percent = 100.0
        job.status = "done"
        job.stage = "done"
        job.message = "Render complete."
        job.output_file = out_name

    except Exception as e:  # noqa: BLE001
        job.status = "error"
        job.error = str(e)
        job.message = f"Error: {e}"
    finally:
        # Always clean temp files belonging to this job
        try:
            for p in TEMP_DIR.glob(f"{job.job_id}_*"):
                p.unlink(missing_ok=True)
            for p in TEMP_DIR.glob("concat_*.txt"):
                # leave concat lists older than 1h alone; otherwise fine to drop
                p.unlink(missing_ok=True)
        except Exception:
            pass


def cleanup_temp() -> None:
    """Wipe temp folder. Safe to call between sessions."""
    if TEMP_DIR.exists():
        for p in TEMP_DIR.iterdir():
            try:
                if p.is_file():
                    p.unlink()
                else:
                    shutil.rmtree(p, ignore_errors=True)
            except Exception:
                pass
