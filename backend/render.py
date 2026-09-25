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
import math
import os
import re
import shutil
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

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
MUSIC_DIR = SOUNDS_DIR / "library"   # background-music library (user-droppable)

for d in (RAW_DIR, OUT_DIR, TEMP_DIR, MUSIC_DIR):
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
    brightness: float = 0.0  # percent -50..+50; 0 = unchanged (set per source)
    # Smart-brightness look derived from `brightness` by the frontend
    # ({"gain","gamma","contrast","saturation"}); None = derive here from
    # `brightness` with the neutral footage profile (old clients/projects).
    color: Optional[dict] = None
    crop: Optional[dict] = None  # {"x","y","w","h"} fractions of the source frame; None = full frame (set per source)

    @property
    def duration(self) -> float:
        return max(0.01, self.end - self.start)


@dataclass
class TextOverlay:
    """A text label burned onto the FINAL video via drawtext.

    Position is the text CENTRE as a fraction of the canvas (0..1), so it
    stays put regardless of output resolution. size_pct is the font size as
    a percentage of canvas height (also resolution-independent). start/end are
    seconds on the final timeline (including the intro); None = whole video.
    """
    text: str
    font: str = "arial"           # family key into FONT_FAMILIES
    bold: bool = False
    italic: bool = False
    size_pct: float = 6.0
    color: str = "#ffffff"
    x: float = 0.5
    y: float = 0.85
    start: Optional[float] = None
    end: Optional[float] = None
    shadow: bool = True           # black outline for legibility
    box: bool = False             # filled background box behind the text
    box_color: str = "#000000"    # box fill color
    box_opacity: float = 0.45     # box fill alpha (0..1)
    fade: float = 0.0             # fade in/out duration in seconds (0 = hard cut)


@dataclass
class MusicTrack:
    """Background music mixed onto the FINAL output in a last audio pass.

    `path` points at a file inside MUSIC_DIR. `volume`/`original_volume` are
    linear gains (1.0 = unchanged). When the source has audio they are mixed
    (amix, no auto-normalise); when it has none, only the music is laid down.
    `loop` repeats the track to fill the whole video. `fade_in`/`fade_out` are
    seconds. `duck` lowers the music whenever the original audio is loud
    (sidechain compression) — the CapCut-style "auto" ducking.
    """
    path: Path
    volume: float = 0.35
    original_volume: float = 1.0
    fade_in: float = 0.0
    fade_out: float = 0.0
    loop: bool = True
    duck: bool = False


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

    # Target output height (px). 0 = keep the source canvas height (native).
    # When 0 < out_height < source height, the canvas is downscaled to this
    # height (aspect preserved). Never upscales. Frontend caps choices at 1440.
    out_height: int = 0

    # Text overlays burned onto the final video (empty = none).
    texts: List[TextOverlay] = field(default_factory=list)

    # Background music mixed onto the final output (None = none).
    music: Optional[MusicTrack] = None

    # progress state
    status: str = "pending"     # pending | running | done | error | cancelled
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
        # Prune old finished jobs (dict insertion order = chronological) so the
        # registry doesn't grow all session; keep the last 20 for late polls.
        terminal = [jid for jid, j in _JOBS.items()
                    if j.status in ("done", "error", "cancelled")]
        for jid in terminal[:-20]:
            _JOBS.pop(jid, None)
        _JOBS[job.job_id] = job


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
def probe_video(path: Path) -> dict:
    """Return width, height, fps, duration, has_audio. Falls back to safe defaults."""
    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "stream=index,codec_type,width,height,r_frame_rate,avg_frame_rate,duration",
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

        def frac(expr) -> float:
            try:
                num, den = str(expr).split("/")
                return float(num) / float(den) if float(den) else 0.0
            except Exception:
                return 0.0

        # Prefer avg_frame_rate (the true average) — r_frame_rate can be a
        # wildly high guess on VFR sources (e.g. phone footage).
        fps = frac(v.get("avg_frame_rate", "")) or frac(v.get("r_frame_rate", "")) or DEFAULT_FPS
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


# Curated font families offered in the UI. Each maps style -> Windows font
# file. Bold/Italic pick the matching variant, falling back to regular when a
# family lacks it (e.g. Impact has no bold/italic).
FONTS_DIR = "C:/Windows/Fonts/"
FONT_FAMILIES: Dict[str, Dict[str, str]] = {
    "arial":    {"regular": "arial.ttf",   "bold": "arialbd.ttf", "italic": "ariali.ttf",   "bolditalic": "arialbi.ttf"},
    "segoe":    {"regular": "segoeui.ttf", "bold": "segoeuib.ttf", "italic": "segoeuii.ttf", "bolditalic": "segoeuiz.ttf"},
    "times":    {"regular": "times.ttf",   "bold": "timesbd.ttf", "italic": "timesi.ttf",   "bolditalic": "timesbi.ttf"},
    "consolas": {"regular": "consola.ttf", "bold": "consolab.ttf", "italic": "consolai.ttf", "bolditalic": "consolaz.ttf"},
    "impact":   {"regular": "impact.ttf"},
}

# Back-compat for older saved keys before the family+B/I split.
_LEGACY_FONT_KEYS = {
    "arial-bold": ("arial", True, False),
    "segoe-bold": ("segoe", True, False),
}


def _resolve_font_file(family: str, bold: bool = False, italic: bool = False) -> Optional[str]:
    family = family or "arial"
    if family in _LEGACY_FONT_KEYS:
        family, bold, _ = _LEGACY_FONT_KEYS[family]
    fam = FONT_FAMILIES.get(family)
    if not fam:
        return _find_font()
    if bold and italic:
        variant = "bolditalic"
    elif bold:
        variant = "bold"
    elif italic:
        variant = "italic"
    else:
        variant = "regular"
    for v in (variant, "regular"):       # fall back to regular if variant missing
        name = fam.get(v)
        if name and Path(FONTS_DIR + name).is_file():
            return FONTS_DIR + name
    return _find_font()


def _esc_ff_path(p: str) -> str:
    """Escape a path for use inside a single-quoted ffmpeg filter option:
    forward slashes work on Windows; the drive-letter colon must be escaped."""
    return p.replace("\\", "/").replace(":", r"\:")


def _ff_color(value: str) -> str:
    """Convert a '#RRGGBB' hex (or bare 'RRGGBB') to ffmpeg's '0xRRGGBB'.
    Unknown values fall back to white."""
    s = (value or "").strip().lstrip("#")
    if re.fullmatch(r"[0-9a-fA-F]{6}", s):
        return f"0x{s.lower()}"
    return "white"


def _clip01(v: float) -> float:
    try:
        return max(0.0, min(1.0, float(v)))
    except (TypeError, ValueError):
        return 0.5


def _enable_expr(start: Optional[float], end: Optional[float],
                 offset: float = 0.0) -> str:
    """drawtext `enable` expression for an optional time window. start/end are
    OUTPUT-relative seconds (the preview timeline, intro excluded); `offset`
    (= intro duration) shifts them onto the final timeline, whose t starts with
    the intro. None = open-ended; both None = always on."""
    s = (start + offset) if start is not None else None
    e = (end + offset) if end is not None else None
    if s is not None and e is not None and e > s:
        return f"between(t,{s:.3f},{e:.3f})"
    if s is not None:
        return f"gte(t,{s:.3f})"
    if e is not None:
        return f"lte(t,{e:.3f})"
    return ""


def _fade_alpha_expr(start: Optional[float], end: Optional[float],
                     offset: float, fade: float) -> str:
    """drawtext `alpha` expression ramping in/out over `fade` seconds at the
    edges of the time window. start/end are OUTPUT-relative seconds (intro
    excluded); `offset` (= intro) shifts them onto the final timeline. A fade-
    out is only added when `end` is set, since the total video length isn't
    known here (an open-ended overlay just holds to the end). Commas live
    inside the quoted option value (like `enable=`), so they need no escaping.
    Returns '' when fade <= 0."""
    if not fade or fade <= 0:
        return ""
    s = (start + offset) if start is not None else offset
    e = (end + offset) if end is not None else None
    fin = f"(t-{s:.3f})/{fade:.3f}"
    if e is not None and (e - s) > fade:
        ramp = f"min({fin},({e:.3f}-t)/{fade:.3f})"
    else:
        ramp = fin
    return f"max(0,min(1,{ramp}))"


# Line height (x fontsize) for multi-line overlays — must match the frontend's
# .tx-overlay `line-height: 1.15` so the export stacks lines like the preview.
TEXT_LINE_HEIGHT = 1.15


def _build_text_filters(
    texts: List[TextOverlay], width: int, height: int, job_id: str,
    intro_offset: float = 0.0,
) -> tuple[str, List[Path]]:
    """Build a comma-joined drawtext chain for the text overlays, plus the list
    of temp text files written (caller cleans them up; run_job's glob covers
    `{job_id}_*`). The text content is written to a UTF-8 file and referenced
    via `textfile=` so we never have to escape arbitrary user text (incl.
    Vietnamese diacritics) inside the filtergraph."""
    parts: List[str] = []
    files: List[Path] = []
    for i, t in enumerate(texts or []):
        # Normalise line endings: a browser textarea can send "\r\n", and
        # drawtext renders a stray "\r" as a missing-glyph box on its own line.
        content = (t.text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
        if not content:
            continue
        font_file = _resolve_font_file(t.font, bool(t.bold), bool(t.italic))
        if not font_file:
            continue
        fontsize = max(8, round((float(t.size_pct) / 100.0) * height))
        # Shared per-overlay options (style + timing) — identical for every line.
        style = ""
        if getattr(t, "box", False):
            pad = max(4, round(fontsize * 0.3))
            op = max(0.0, min(1.0, float(getattr(t, "box_opacity", 0.45) or 0.0)))
            style += f":box=1:boxcolor={_ff_color(t.box_color)}@{op:.3f}:boxborderw={pad}"
        if t.shadow:
            # Scale the outline with the font so it stays visible at 1080p/1440p.
            bw = max(2, round(fontsize * 0.06))
            style += f":borderw={bw}:bordercolor=black@0.6"
        en = _enable_expr(t.start, t.end, intro_offset)
        if en:
            style += f":enable='{en}'"
        al = _fade_alpha_expr(t.start, t.end, intro_offset,
                              float(getattr(t, "fade", 0.0) or 0.0))
        if al:
            style += f":alpha='{al}'"

        # One drawtext PER LINE. drawtext never wraps, and ffmpeg 8's rewritten
        # drawtext paints the newline itself as a missing-glyph box (with or
        # without text_align / text_shaping), so a multi-line label is laid out
        # here instead: each line is centred on x (like the preview's
        # text-align:center) and stacked at TEXT_LINE_HEIGHT x fontsize —
        # the same line-height the frontend's .tx-overlay uses, so the block
        # matches what was positioned in the player. A single line reduces to
        # the original x/y expression exactly.
        lines = content.split("\n")
        n = len(lines)
        line_h = fontsize * TEXT_LINE_HEIGHT
        for k, line in enumerate(lines):
            if not line.strip():
                continue  # blank line keeps its slot, draws nothing
            txt_path = TEMP_DIR / f"{job_id}_text_{i}_{k}.txt"
            # newline="\n": on Windows the default text mode would rewrite "\n"
            # as "\r\n" and reintroduce the "\r" glyph issue above.
            txt_path.write_text(line, encoding="utf-8", newline="\n")
            files.append(txt_path)
            off = (k - (n - 1) / 2.0) * line_h  # slot centre relative to block centre
            y_expr = f"h*{_clip01(t.y):.5f}{off:+.2f}-text_h/2" if n > 1 \
                else f"h*{_clip01(t.y):.5f}-text_h/2"
            parts.append(
                f"drawtext=fontfile='{_esc_ff_path(font_file)}'"
                f":textfile='{_esc_ff_path(str(txt_path))}'"
                f":fontsize={fontsize}"
                f":fontcolor={_ff_color(t.color)}"
                f":x=w*{_clip01(t.x):.5f}-text_w/2"
                f":y={y_expr}"
                + style
            )
    return ",".join(parts), files


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


# --------------------------------------------------------------------------
# Smart brightness ("one slider, the rest is automatic")
# --------------------------------------------------------------------------
# The UI exposes ONE number per source: a brightness level in -50..+50. The
# look burned into the video is a small colour pipeline derived from that
# level plus two measurements of the footage (99th-percentile luma = how
# much highlight headroom there is; mean HSV saturation = how vivid the
# footage already is):
#
#   gain        multiplicative lift (cheap, clean) — only as much as the
#               highlights can take without clipping
#   gamma       midtone/shadow lift for the rest — never clips white
#   contrast    a touch of contrast so the gamma lift does not look hazy
#   saturation  compensates the desaturation every brightness lift causes
#               (less on footage that is already vivid); calibrated on real
#               DJI gym footage so mean HSV saturation stays ~85% preserved
#               at any lift. Darkening deepens colours by itself, so it is
#               eased back a little instead
#
# derive_color() below is a line-for-line port of deriveColor() in
# frontend/app.js; the frontend sends the derived numbers with every clip
# so the export uses EXACTLY what the player previewed. It is only called
# here for payloads that carry a bare `brightness` (old clients/projects).
#
# Pipeline (per RGB channel, gamma-encoded values 0..1, clamped between
# steps) — identical to the SVG filter the player previews with:
#   y = pow(clip(C*(x - 0.5) + 0.5 + B), 1/gamma)      C = gain*contrast, B = (gain-1)/2
#   then the standard luma-preserving saturation matrix (SVG/CSS saturate()).
# Running it in RGB (format=gbrp) instead of `eq` on luma is what keeps
# colours from going pale: eq scaled Y' and left chroma alone.
NEUTRAL_STATS = {"p99": 0.85, "sat": 0.35}


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def derive_color(level: float, stats: Optional[dict] = None) -> Optional[dict]:
    """Brightness level (-50..+50) + footage stats -> {gain,gamma,contrast,
    saturation}, or None for level ~0 (identity). Keep in sync with
    deriveColor() in frontend/app.js."""
    try:
        v = _clamp(float(level), -50.0, 50.0)
    except (TypeError, ValueError):
        return None
    if abs(v) < 0.5:
        return None
    t = v / 50.0
    st = stats if isinstance(stats, dict) else {}
    try:
        p99 = _clamp(float(st.get("p99", NEUTRAL_STATS["p99"])), 0.0, 1.0)
        sat = _clamp(float(st.get("sat", NEUTRAL_STATS["sat"])), 0.0, 1.0)
    except (TypeError, ValueError):
        p99, sat = NEUTRAL_STATS["p99"], NEUTRAL_STATS["sat"]
    sat_scale = _clamp(1.2 - sat, 0.4, 1.0)
    if t > 0:
        headroom = _clamp(1.0 - p99, 0.0, 0.5)
        gain_max = 1.0 + min(0.35, headroom * 0.9)
        gain = 1.0 + (gain_max - 1.0) * t
        gamma = 1.0 + t * (0.7 - 0.5 * (gain_max - 1.0))
        contrast = 1.0 + 0.08 * t
        saturation = 1.0 + 0.55 * t * sat_scale
    else:
        u = -t
        gain = 1.0 - 0.30 * u
        gamma = 1.0 - 0.25 * u
        contrast = 1.0 + 0.10 * u
        saturation = 1.0 - 0.12 * u * sat_scale
    # Same rounding as JS Math.round(n * 1e4) / 1e4 (floor(x + 0.5) on the
    # identical IEEE double) so both sides produce bit-identical numbers;
    # Python's round() differs on .5 edges (1.03195 -> 1.0319 vs 1.032).
    r4 = lambda n: math.floor(n * 10000.0 + 0.5) / 10000.0
    return {
        "gain": r4(gain),
        "gamma": r4(gamma),
        "contrast": r4(contrast),
        "saturation": r4(saturation),
    }


def _color_filter(brightness: float, color: Optional[dict] = None) -> str:
    """ffmpeg filter fragment for the smart-brightness look (see above), or
    '' when it is the identity so untouched chains stay byte-identical.
    Converts to planar RGB, applies the per-channel curve as a LUT, mixes
    channels for saturation; the caller's trailing format=yuv420p converts
    back. All numbers are formatted with fixed decimals and the expressions
    are single-quoted, so the fragment is safe verbatim in -vf and inside a
    -filter_complex graph."""
    p = None
    if isinstance(color, dict):
        try:
            p = {
                "gain": _clamp(float(color.get("gain", 1.0)), 0.5, 1.6),
                "gamma": _clamp(float(color.get("gamma", 1.0)), 0.5, 2.0),
                "contrast": _clamp(float(color.get("contrast", 1.0)), 0.7, 1.4),
                "saturation": _clamp(float(color.get("saturation", 1.0)), 0.0, 2.0),
            }
        except (TypeError, ValueError):
            p = None
    if p is None:
        p = derive_color(brightness)
    if not p:
        return ""
    C = p["gain"] * p["contrast"]
    B = (p["gain"] - 1.0) / 2.0
    inv_g = 1.0 / p["gamma"]
    s = p["saturation"]
    if abs(C - 1.0) < 1e-4 and abs(B) < 1e-4 and abs(inv_g - 1.0) < 1e-4 and abs(s - 1.0) < 1e-4:
        return ""
    parts = ["format=gbrp"]
    if abs(C - 1.0) >= 1e-4 or abs(B) >= 1e-4 or abs(inv_g - 1.0) >= 1e-4:
        # lutrgb truncates the expression result to int -> +0.5 to round.
        expr = (f"clip(255*pow(clip({C:.4f}*(val/255-0.5)+0.5{B:+.4f},0,1),{inv_g:.4f})+0.5,0,255)")
        parts.append(f"lutrgb=r='{expr}':g='{expr}':b='{expr}'")
    if abs(s - 1.0) >= 1e-4:
        # Luma-preserving saturation matrix — the same one CSS/SVG saturate() uses.
        rr, gg, bb = 0.213 + 0.787 * s, 0.715 + 0.285 * s, 0.072 + 0.928 * s
        r_ = 0.213 - 0.213 * s
        g_ = 0.715 - 0.715 * s
        b_ = 0.072 - 0.072 * s
        parts.append(
            f"colorchannelmixer=rr={rr:.4f}:rg={g_:.4f}:rb={b_:.4f}"
            f":gr={r_:.4f}:gg={gg:.4f}:gb={b_:.4f}"
            f":br={r_:.4f}:bg={g_:.4f}:bb={bb:.4f}")
    return ",".join(parts)


MIN_CROP_FRAC = 0.15  # smallest crop side, as a fraction of the source dimension


def _crop_pixels(crop: Optional[dict], src_w: int, src_h: int
                 ) -> Optional[Tuple[int, int, int, int]]:
    """Fractional crop {x,y,w,h} -> even pixel rect (cw, ch, cx, cy), or None
    for a no-op. Clamps silently (values round-trip JSON/localStorage as
    floats — drift must never brick a render). All four values are rounded
    down to even: yuv420p subsamples chroma 2x2, so an odd offset would shift
    chroma against luma at the crop edge. A ~full-frame crop returns None so
    the untouched filter chains stay byte-identical to a no-crop job."""
    if not crop or not src_w or not src_h:
        return None
    try:
        x = min(max(float(crop.get("x", 0.0)), 0.0), 1.0)
        y = min(max(float(crop.get("y", 0.0)), 0.0), 1.0)
        w = min(max(float(crop.get("w", 1.0)), MIN_CROP_FRAC), 1.0)
        h = min(max(float(crop.get("h", 1.0)), MIN_CROP_FRAC), 1.0)
    except (TypeError, ValueError):
        return None
    x = min(x, 1.0 - w)
    y = min(y, 1.0 - h)
    cx = int(round(x * src_w))
    cy = int(round(y * src_h))
    cw = int(round(w * src_w))
    ch = int(round(h * src_h))
    cx -= cx % 2
    cy -= cy % 2
    cw = max(16, min(cw, src_w - cx))
    ch = max(16, min(ch, src_h - cy))
    cw -= cw % 2
    ch -= ch % 2
    if cw >= src_w - 2 and ch >= src_h - 2:
        return None
    return (cw, ch, cx, cy)


def _video_filter(width: int, height: int, fps: float, setpts: Optional[float] = None,
                  brightness: float = 0.0, color: Optional[dict] = None,
                  crop_px: Optional[Tuple[int, int, int, int]] = None) -> str:
    parts = []
    if setpts is not None:
        parts.append(f"setpts={setpts:.5f}*PTS")
    # Crop runs in source pixels, before the scale onto the canvas. Constant
    # integers only (digits + colons) so the string is safe verbatim in both
    # -vf and the -filter_complex embedding in render_slowmo.
    if crop_px:
        cw, ch, cx, cy = crop_px
        parts.append(f"crop={cw}:{ch}:{cx}:{cy}")
    # Aspect-preserving scale + letterbox pad so sources of any resolution/aspect
    # land on the same canvas without stretching. For a source already matching
    # the target this is an identity (scale = no-op, pad = 0). setsar=1 forces
    # square pixels so every segment shares SAR/DAR -> concat -c copy stays valid.
    parts.append(f"scale={width}:{height}:force_original_aspect_ratio=decrease:flags=lanczos")
    parts.append(f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black")
    parts.append("setsar=1")
    parts.append(f"fps={fps}")
    # Colour work runs after fps (no wasted frames) on the canvas-sized
    # frame, in RGB; the trailing format=yuv420p converts back for NVENC.
    cf = _color_filter(brightness, color)
    if cf:
        parts.append(cf)
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
    crop_px: Optional[Tuple[int, int, int, int]] = None,
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
    vf = _video_filter(width, height, fps, brightness=clip.brightness, color=clip.color,
                       crop_px=crop_px)
    if source_has_audio:
        # Map the source's own audio.
        args += [
            "-vf", vf,
            *NVENC_ARGS,
            *AAC_ARGS,
        ]
    elif need_audio:
        # Source is silent but the job needs a uniform audio track for concat:
        # attach a generated silent stereo track.
        args += [
            "-f", "lavfi", "-t", f"{clip.duration:.3f}",
            "-i", "anullsrc=r=48000:cl=stereo",
            "-vf", vf,
            "-map", "0:v:0", "-map", "1:a", "-shortest",
            *NVENC_ARGS,
            *AAC_ARGS,
        ]
    else:
        args += [
            "-map", "0:v:0",
            "-vf", vf,
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
    crop_px: Optional[Tuple[int, int, int, int]] = None,
) -> None:
    src = clip.video_path or job.video_path
    factor = 1.0 / max(0.05, job.slow_ratio)  # 0.5 -> 2.0
    out_duration = clip.duration * factor

    badge = _slowmo_badge_filter(height)
    vf = _video_filter(width, height, fps, setpts=factor, brightness=clip.brightness,
                       color=clip.color, crop_px=crop_px)
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
                    cancel: threading.Event,
                    list_prefix: str = "concat") -> None:
    # The list file carries the job prefix so per-job cleanup covers it and a
    # concurrent job's cleanup can never touch another job's list.
    list_file = TEMP_DIR / f"{list_prefix}_{uuid.uuid4().hex}.txt"
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


def concat_with_text(segments: List[Path], out_path: Path, text_vf: str,
                     need_audio: bool, expected_duration: float,
                     on_progress: Callable[[float], None],
                     cancel: threading.Event,
                     list_prefix: str = "concat") -> None:
    """Concat the segments AND burn text overlays in a single re-encode pass.
    Used instead of concat_segments when the job has text overlays — the
    drawtext `t` is then the final-timeline timestamp (starting at the intro).
    Video is re-encoded (NVENC); audio is copied (segments share AAC params)."""
    list_file = TEMP_DIR / f"{list_prefix}_{uuid.uuid4().hex}.txt"
    with list_file.open("w", encoding="utf-8") as f:
        for seg in segments:
            posix = str(seg).replace("\\", "/")
            f.write(f"file '{posix}'\n")

    args = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-progress", "pipe:1", "-nostats",
        "-f", "concat", "-safe", "0",
        "-i", str(list_file),
        "-vf", text_vf,
        *NVENC_ARGS,
    ]
    args += ["-c:a", "copy"] if need_audio else ["-an"]
    args += ["-movflags", "+faststart", str(out_path)]
    _run_ffmpeg(args, expected_duration, on_progress, cancel)


def mix_background_music(video_in: Path, out_path: Path, music: "MusicTrack",
                         video_has_audio: bool, total_duration: float,
                         on_progress: Callable[[float], None],
                         cancel: threading.Event) -> None:
    """Final pass: lay a background-music track over the finished video.

    Video is stream-copied (no re-encode — fast remux); only audio is built.
    The music is an extra input (looped via -stream_loop when requested) and
    mixed with the original audio through amix (normalize=0 so the requested
    gains are honoured). With ducking, the music is side-chain compressed by
    the original audio so commentary/crowd stays on top. When the source has
    no audio, only the (faded, looped) music is written."""
    mv = f"{max(0.0, music.volume):.4f}"
    ov = f"{max(0.0, music.original_volume):.4f}"

    # Music post-gain fades. fade-out is anchored to the known total length.
    fades = []
    if music.fade_in > 0.01:
        fades.append(f"afade=t=in:st=0:d={music.fade_in:.3f}")
    if music.fade_out > 0.01 and total_duration > music.fade_out:
        st = max(0.0, total_duration - music.fade_out)
        fades.append(f"afade=t=out:st={st:.3f}:d={music.fade_out:.3f}")
    music_chain = f"[1:a]volume={mv}" + ("," + ",".join(fades) if fades else "") + "[m]"

    if video_has_audio:
        if music.duck:
            # Split the original into a mix copy + a sidechain key; the key
            # compresses the music so it dips under loud original audio.
            fc = (
                f"[0:a]volume={ov},asplit=2[oa][key];"
                f"{music_chain};"
                f"[m][key]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[mc];"
                f"[oa][mc]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]"
            )
        else:
            fc = (
                f"[0:a]volume={ov}[oa];{music_chain};"
                f"[oa][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]"
            )
    else:
        # No original audio: the music IS the soundtrack (cut to video length).
        # A non-looping track shorter than the video must be padded with
        # silence, otherwise -shortest would truncate the video to the track.
        fc = music_chain.replace("[m]", "[a]" if music.loop else ",apad[a]")

    args = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-progress", "pipe:1", "-nostats",
        "-i", str(video_in),
    ]
    if music.loop:
        args += ["-stream_loop", "-1"]
    args += [
        "-i", str(music.path),
        "-filter_complex", fc,
        "-map", "0:v:0", "-map", "[a]",
        "-c:v", "copy",
        *AAC_ARGS,
        "-shortest",
        "-movflags", "+faststart",
        str(out_path),
    ]
    _run_ffmpeg(args, total_duration, on_progress, cancel)


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

        # Per-source crop -> pixel rect against that source's probe dims. One
        # crop per source (like brightness), resolved once so the canvas and
        # every segment agree on the same rounded rectangle.
        def clip_crop_px(clip: Clip) -> Optional[Tuple[int, int, int, int]]:
            sp = clip.video_path or job.video_path
            info = source_info.get(sp, {})
            return _crop_pixels(clip.crop, info.get("width", 0), info.get("height", 0))

        # Canvas = resolution of the FIRST source (the first clip's video),
        # after its crop when one is set — the cropped region becomes the
        # canvas at native pixel size (no upscale for the canvas source).
        # Every segment is scaled+letterboxed onto this canvas so concat works.
        first = source_info[source_order[0]]
        width, height, fps = first["width"], first["height"], first["fps"]
        first_crop = clip_crop_px(job.clips[0]) if job.clips else None
        if first_crop:
            width, height = first_crop[0], first_crop[1]
        # Cap fps at 60 for slow-mo headroom; concat needs uniform timing.
        if fps > 60:
            fps = 60.0

        # Optional output downscale: shrink the canvas to the requested height
        # (aspect preserved, even dimensions). Only ever downscales — picking a
        # height >= source is treated as native. Every segment is scaled onto
        # this canvas by _video_filter, so this alone resizes the whole output.
        if job.out_height and 0 < job.out_height < height:
            new_h = job.out_height - (job.out_height % 2)
            new_w = round(width * new_h / height)
            new_w -= new_w % 2
            width, height = max(2, new_w), max(2, new_h)

        # If ANY source has audio, every segment must carry an audio track so the
        # final concat -c copy has a consistent stream layout. Silent sources get
        # a generated silent track.
        need_audio = any(bool(i.get("has_audio", False)) for i in source_info.values())

        def clip_has_audio(clip: Clip) -> bool:
            sp = clip.video_path or job.video_path
            return bool(source_info.get(sp, {}).get("has_audio", False))

        # Text overlays: build the drawtext chain once (canvas dims are known).
        # When present, the final step re-encodes (concat + drawtext) instead of
        # a `-c copy` concat, so weight it heavier for smooth progress.
        text_vf, _text_files = _build_text_filters(
            job.texts, width, height, job.job_id, intro_offset=job.intro_seconds)

        # Plan the work: per-segment weights so progress is monotonic.
        intro_weight = job.intro_seconds
        factor = 1.0 / max(0.05, job.slow_ratio)
        real_weights = [c.duration for c in job.clips]
        slow_weights = [c.duration * factor if c.slowmo else 0.0 for c in job.clips]
        segs_total = sum([intro_weight] + real_weights + slow_weights)
        concat_weight = segs_total * (0.6 if text_vf else 0.05)  # re-encode vs -c copy

        # Optional background-music pass (final). Audio-only re-encode + video
        # stream-copy, so it's cheap relative to the segment work.
        has_music = job.music is not None and Path(job.music.path).is_file()
        music_weight = segs_total * 0.08 if has_music else 0.0

        total = intro_weight + sum(real_weights) + sum(slow_weights) + concat_weight + music_weight
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
                        stage_progress(clip.duration), crop_px=clip_crop_px(clip))
            segments.append(real_file)
            completed += clip.duration

            if clip.slowmo:
                job.stage = f"clip {idx}/{len(job.clips)} - slowmo"
                job.message = f"Rendering clip {idx} (slow-mo {int(job.slow_ratio*100)}%)..."
                slow_file = TEMP_DIR / f"{job.job_id}_{idx:02d}_slow.mp4"
                render_slowmo(job, clip, slow_file, width, height, fps,
                              clip_has_audio(clip), need_audio,
                              stage_progress(clip.duration * factor),
                              crop_px=clip_crop_px(clip))
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

        # When music is added, the video is first assembled into a temp file and
        # the music is laid down in a final pass that writes out_path.
        video_target = (TEMP_DIR / f"{job.job_id}_premusic.mp4") if has_music else out_path

        if text_vf:
            # Text overlays present: re-encode (concat + drawtext) in one pass.
            # Works for a single segment too (concat of one file is fine).
            job.stage = "text"
            job.message = "Adding text overlays..."
            concat_with_text(segments, video_target, text_vf, need_audio,
                             _expected_total_duration(job),
                             stage_progress(concat_weight),
                             job.cancel,
                             list_prefix=f"{job.job_id}_concat")
        elif len(segments) == 1:
            # Single-segment export (e.g. real-only single clip with no intro):
            # rename instead of running concat.
            job.stage = "finalising"
            job.message = "Saving output..."
            shutil.move(str(segments[0]), str(video_target))
        else:
            job.stage = "concat"
            job.message = "Stitching final video..."
            concat_segments(segments, video_target,
                            _expected_total_duration(job),
                            stage_progress(concat_weight),
                            job.cancel,
                            list_prefix=f"{job.job_id}_concat")
        completed += concat_weight

        # 4. Background music (final audio pass over the assembled video).
        if has_music:
            if job.cancel.is_set():
                raise RuntimeError("Cancelled")
            job.stage = "music"
            job.message = "Mixing background music..."
            mix_background_music(video_target, out_path, job.music, need_audio,
                                 _expected_total_duration(job),
                                 stage_progress(music_weight),
                                 job.cancel)
            completed += music_weight
            Path(video_target).unlink(missing_ok=True)

        job.percent = 100.0
        job.status = "done"
        job.stage = "done"
        job.message = "Render complete."
        job.output_file = out_name

    except Exception as e:  # noqa: BLE001
        if job.cancel.is_set():
            # User-initiated cancel — a clean stop, not a failure.
            job.status = "cancelled"
            job.stage = "cancelled"
            job.message = "Cancelled."
        else:
            job.status = "error"
            job.error = str(e)
            job.message = f"Error: {e}"
    finally:
        # Always clean temp files belonging to this job (concat lists carry the
        # job prefix too, so this can never touch a concurrent job's files).
        try:
            for p in TEMP_DIR.glob(f"{job.job_id}_*"):
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
