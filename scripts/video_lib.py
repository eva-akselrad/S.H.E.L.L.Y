"""Shared compositor for the SHELLY launch videos (video-forecast.py, video-release.py).

Pictures: real SHELLY footage recorded by scripts/video-record.mjs (PNG stills and JPEG frame clips),
composited with PIL. Sound: music from public/music, voice from video/vo, effects from video/sfx,
mixed with numpy. Frames are piped straight into ffmpeg (H.264 + AAC).
"""
import json
import math
import os
import subprocess
from functools import lru_cache

import numpy as np
import soundfile as sf
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FOOTAGE = os.environ.get("SHELLY_FOOTAGE") or os.path.join(os.environ.get("LOCALAPPDATA", ROOT), "shelly-video", "footage")
SFX = os.path.join(ROOT, "video", "sfx")
VO = os.path.join(ROOT, "video", "vo")
MUSIC = os.path.join(ROOT, "public", "music")
RENDERS = os.path.join(ROOT, "video", "renders")
FPS, SR = 30, 48000

F_BLACK = r"C:\Windows\Fonts\seguibl.ttf"   # Segoe UI Black: slams
F_BOLD = r"C:\Windows\Fonts\segoeuib.ttf"
F_SEMI = r"C:\Windows\Fonts\seguisb.ttf"
F_BRAND = r"C:\Windows\Fonts\palab.ttf"     # Palatino Linotype Bold: SHELLY's display face
TEAL = (62, 207, 154)
RED = (229, 57, 53)


def ease(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def ease_out(x):
    x = min(1.0, max(0.0, x))
    return 1 - (1 - x) ** 3


def ramp(t, a, b):
    """0 before a, 1 after b, eased between."""
    return ease((t - a) / max(1e-6, b - a))


# ---------------- footage ----------------
class Clip:
    """A recorded clip: numbered JPEG frames + clip.json. frame(t) loops or holds."""

    def __init__(self, name):
        self.dir = os.path.join(FOOTAGE, name)
        meta = json.load(open(os.path.join(self.dir, "clip.json")))
        self.fps, self.n = meta["fps"], meta["frames"]

    def frame(self, t, loop=False, start=0.0):
        i = int((t + start) * self.fps)
        i = i % self.n if loop else min(max(i, 0), self.n - 1)
        return _load(os.path.join(self.dir, f"{i + 1:04d}.jpg"))


@lru_cache(maxsize=48)
def _load(path):
    return Image.open(path).convert("RGB")


def still(name, path=None):
    return _load(path or os.path.join(FOOTAGE, name, "still.png"))


@lru_cache(maxsize=None)
def clip(name):
    return Clip(name)


def cover(img, w, h, zoom=1.0, cx=0.5, cy=0.5, resample=Image.BICUBIC):
    """Scale to cover w x h, times zoom, cropped around (cx, cy) in the source's 0..1 space."""
    iw, ih = img.size
    s = max(w / iw, h / ih) * zoom
    cw, ch = w / s, h / s
    x0 = min(max(cx * iw - cw / 2, 0), iw - cw)
    y0 = min(max(cy * ih - ch / 2, 0), ih - ch)
    return img.resize((w, h), resample, box=(x0, y0, x0 + cw, y0 + ch))


def crop_rel(img, box, w, h):
    """Crop a 0..1 box from img and fill w x h (cover)."""
    iw, ih = img.size
    x0, y0, x1, y1 = box[0] * iw, box[1] * ih, box[2] * iw, box[3] * ih
    bw, bh = x1 - x0, y1 - y0
    s = max(w / bw, h / bh)
    cw, ch = w / s, h / s
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    return img.resize((w, h), Image.BICUBIC, box=(cx - cw / 2, cy - ch / 2, cx + cw / 2, cy + ch / 2))


def fast_blur(img, radius):
    if radius <= 0.5:
        return img
    k = 4
    small = img.resize((max(1, img.width // k), max(1, img.height // k)), Image.BILINEAR)
    return small.filter(ImageFilter.GaussianBlur(radius / k)).resize(img.size, Image.BILINEAR)


def brightness(img, k):
    if abs(k - 1) < 1e-3:
        return img
    return Image.eval(img, lambda v: min(255, int(v * k)))


# ---------------- canvas helpers ----------------
def blank(w, h, color=(0, 0, 0)):
    return Image.new("RGB", (w, h), color)


def paste_alpha(base, layer, xy, opacity=1.0):
    """Paste an RGBA layer onto RGB base at xy with extra opacity."""
    if opacity <= 0:
        return
    if layer.mode != "RGBA":
        layer = layer.convert("RGBA")
    if opacity < 1:
        a = layer.getchannel("A").point(lambda v: int(v * opacity))
        layer = layer.copy()
        layer.putalpha(a)
    base.paste(layer, (int(round(xy[0])), int(round(xy[1]))), layer)


def blend(a, b, k):
    return b if k >= 1 else a if k <= 0 else Image.blend(a, b, k)


def rounded(img, radius):
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, img.width - 1, img.height - 1), radius, fill=255)
    out = img.convert("RGBA")
    out.putalpha(mask)
    return out


@lru_cache(maxsize=64)
def _shadow(w, h, radius, blur, alpha):
    pad = blur * 3
    m = Image.new("L", (w + pad * 2, h + pad * 2), 0)
    ImageDraw.Draw(m).rounded_rectangle((pad, pad, pad + w, pad + h), radius, fill=alpha)
    m = m.filter(ImageFilter.GaussianBlur(blur))
    sh = Image.new("RGBA", m.size, (0, 0, 0, 0))
    sh.putalpha(m)
    return sh, pad


def device(screen, kind, width):
    """Wrap a screen image in a simple device body. Returns RGBA. kind: tv | laptop | phone."""
    sw = width
    if kind == "phone":
        sh = int(sw * screen.height / screen.width)
        bez = max(6, sw // 26)
        body = Image.new("RGBA", (sw + bez * 2, sh + bez * 2), (0, 0, 0, 0))
        d = ImageDraw.Draw(body)
        d.rounded_rectangle((0, 0, body.width - 1, body.height - 1), int(sw * 0.16), fill=(18, 20, 26, 255), outline=(70, 76, 90, 255), width=max(2, bez // 4))
        body.alpha_composite(rounded(screen.resize((sw, sh), Image.BICUBIC), int(sw * 0.13)), (bez, bez))
        d.rounded_rectangle((body.width // 2 - sw // 8, bez + sw // 40, body.width // 2 + sw // 8, bez + sw // 40 + sw // 16), sw // 32, fill=(10, 10, 12, 255))
        return body
    sh = int(sw * screen.height / screen.width)
    if kind == "tv":
        bez = max(6, sw // 90)
        body = Image.new("RGBA", (sw + bez * 2, sh + bez * 2 + sw // 14), (0, 0, 0, 0))
        d = ImageDraw.Draw(body)
        d.rounded_rectangle((0, 0, sw + bez * 2 - 1, sh + bez * 2 - 1), bez * 2, fill=(12, 13, 16, 255), outline=(60, 64, 74, 255), width=2)
        body.paste(screen.resize((sw, sh), Image.BICUBIC), (bez, bez))
        cx = body.width // 2
        d.polygon([(cx - sw // 18, sh + bez * 2), (cx + sw // 18, sh + bez * 2), (cx + sw // 7, body.height - 4), (cx - sw // 7, body.height - 4)], fill=(30, 32, 38, 255))
        return body
    # laptop
    bez = max(6, sw // 40)
    base_h = max(10, sw // 32)
    body = Image.new("RGBA", (int(sw * 1.16), sh + bez * 2 + base_h), (0, 0, 0, 0))
    ox = (body.width - sw - bez * 2) // 2
    d = ImageDraw.Draw(body)
    d.rounded_rectangle((ox, 0, ox + sw + bez * 2, sh + bez * 2), bez, fill=(16, 17, 21, 255), outline=(66, 70, 82, 255), width=2)
    body.paste(screen.resize((sw, sh), Image.BICUBIC), (ox + bez, bez))
    d.rounded_rectangle((0, sh + bez * 2, body.width - 1, body.height - 1), base_h // 2, fill=(150, 154, 164, 255))
    d.rectangle((body.width // 2 - sw // 12, sh + bez * 2, body.width // 2 + sw // 12, sh + bez * 2 + base_h // 3), fill=(110, 114, 124, 255))
    return body


def place_device(base, dev, cx, cy, scale=1.0, opacity=1.0, rotate=0.0, shadow=True):
    d = dev
    if scale != 1.0:
        d = d.resize((max(1, int(d.width * scale)), max(1, int(d.height * scale))), Image.BICUBIC)
    if rotate:
        d = d.rotate(rotate, Image.BICUBIC, expand=True)
    if shadow:
        sh, pad = _shadow(d.width, d.height, max(8, d.width // 30), max(10, d.width // 25), 150)
        paste_alpha(base, sh, (cx - d.width / 2 - pad, cy - d.height / 2 - pad + d.height * 0.04), opacity)
    paste_alpha(base, d, (cx - d.width / 2, cy - d.height / 2), opacity)


def host_layer(src, height):
    """Cut the host out of a black-background capture: tight crop, transparent background, scaled to height."""
    img = src if isinstance(src, Image.Image) else still(src)
    lum = img.convert("L")
    mask = lum.point(lambda v: 255 if v > 14 else 0)
    box = mask.getbbox() or (0, 0, img.width, img.height)
    pad = int(0.02 * img.height)
    box = (max(0, box[0] - pad), max(0, box[1] - pad), min(img.width, box[2] + pad), min(img.height, box[3] + pad))
    lay = img.crop(box).convert("RGBA")
    lay.putalpha(mask.crop(box).filter(ImageFilter.GaussianBlur(1.2)))
    s = height / lay.height
    return lay.resize((max(1, int(lay.width * s)), int(height)), Image.BICUBIC)


def light_sweep(img, t, width=0.18, angle=0.35, strength=0.55):
    """A soft diagonal light band crossing the image as t goes 0..1 (keeps alpha)."""
    w, h = img.size
    xs = np.linspace(0, 1, w, dtype=np.float32)[None, :]
    ys = np.linspace(0, 1, h, dtype=np.float32)[:, None]
    pos = xs + ys * angle
    c = -0.3 + t * (1.6 + angle)
    band = np.exp(-((pos - c) / width) ** 2) * strength
    arr = np.asarray(img.convert("RGBA"), dtype=np.float32)
    arr[..., :3] = np.minimum(255, arr[..., :3] + band[..., None] * 255 * (arr[..., 3:4] / 255))
    return Image.fromarray(arr.astype(np.uint8), "RGBA")


# ---------------- type ----------------
@lru_cache(maxsize=256)
def text_layer(text, font, size, color=(255, 255, 255), tracking=0.0, stroke=0):
    """Render text tightly as RGBA (cached)."""
    f = ImageFont.truetype(font, size)
    probe = ImageDraw.Draw(Image.new("L", (1, 1)))
    if tracking:
        widths = [probe.textlength(c, font=f) for c in text]
        total = int(sum(widths) + size * tracking * (len(text) - 1)) + size
    else:
        total = int(probe.textlength(text, font=f)) + size
    asc, desc = f.getmetrics()
    im = Image.new("RGBA", (total, asc + desc + size // 4), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if tracking:
        x = size // 2
        for c, cw in zip(text, widths):
            d.text((x, size // 8), c, font=f, fill=color + (255,), stroke_width=stroke)
            x += cw + size * tracking
    else:
        d.text((size // 2, size // 8), text, font=f, fill=color + (255,), stroke_width=stroke)
    return im.crop(im.getbbox() or (0, 0, 1, 1))


def put_text(base, text, font, size, cx, cy, color=(255, 255, 255), opacity=1.0, scale=1.0, tracking=0.0, anchor="mm"):
    lay = text_layer(text, font, size, color, tracking)
    if scale != 1.0:
        lay = lay.resize((max(1, int(lay.width * scale)), max(1, int(lay.height * scale))), Image.BICUBIC)
    x = cx - (lay.width / 2 if anchor[0] == "m" else 0 if anchor[0] == "l" else lay.width)
    y = cy - (lay.height / 2 if anchor[1] == "m" else 0 if anchor[1] == "t" else lay.height)
    paste_alpha(base, lay, (x, y), opacity)
    return lay.size


def slam(base, text, t, cx, cy, size, font=F_BLACK, hold=None, color=(255, 255, 255)):
    """Keynote slam: lands big and settles in 0.18 s; fades out over the last 0.2 s of hold."""
    if t < 0 or (hold is not None and t > hold):
        return
    k = ease_out(t / 0.18)
    sc = 1.35 - 0.35 * k
    op = min(1.0, t / 0.08)
    if hold is not None:
        op *= 1 - ramp(t, hold - 0.2, hold)
    put_text(base, text, font, size, cx, cy, color=color, opacity=op, scale=sc)


def demo_tag(base, opacity=1.0):
    """The required on-screen line over every alert shot."""
    w, h = base.size
    s = max(18, int(min(w, h) * 0.024))
    pill = text_layer("DEMO ALERT  ·  TEST", F_BOLD, s, (255, 255, 255), 0.08)
    note = text_layer("Demo alerts shown. Real alerts come from the National Weather Service.", F_SEMI, int(s * 0.8), (235, 238, 245))
    pad = s // 2
    bw = max(pill.width, note.width) + pad * 2
    bh = pill.height + note.height + pad * 3
    box = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
    ImageDraw.Draw(box).rounded_rectangle((0, 0, bw - 1, bh - 1), s // 2, fill=(10, 12, 18, 205))
    box.alpha_composite(pill, (pad, pad))
    box.alpha_composite(note, (pad, pad * 2 + pill.height))
    paste_alpha(base, box, (w * 0.5 - bw / 2, h - bh - h * 0.04), opacity)


# ---------------- finishing ----------------
class Finisher:
    """Film grain + soft vignette, precomputed."""

    def __init__(self, w, h, grain=0.016, vignette=0.22, seed=3):
        rng = np.random.default_rng(seed)
        self.grains = [(rng.normal(0, grain, (h // 2, w // 2)).astype(np.float32)) for _ in range(6)]
        self.grains = [np.repeat(np.repeat(g, 2, 0), 2, 1)[:h, :w, None] for g in self.grains]
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        r = np.hypot((xx - w / 2) / (w / 2), (yy - h / 2) / (h / 2))
        self.vig = (1 - vignette * np.clip(r - 0.35, 0, 1) ** 1.6)[..., None].astype(np.float32)

    def __call__(self, img, i):
        a = np.asarray(img, dtype=np.float32) / 255
        a = a * self.vig
        a = a + self.grains[i % len(self.grains)] * (0.3 + 0.7 * (1 - a))
        return (np.clip(a, 0, 1) * 255).astype(np.uint8)


# ---------------- audio ----------------
def read_audio(path, start=0.0, dur=None):
    """Any audio file -> float32 stereo at 48 kHz (via ffmpeg)."""
    cmd = ["ffmpeg", "-v", "error", "-ss", str(start)] + (["-t", str(dur)] if dur else []) + ["-i", path, "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, 2).copy()


def duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], capture_output=True, text=True).stdout
    return float(out.strip())


class Mixer:
    def __init__(self, seconds):
        self.n = int(seconds * SR)
        self.music = np.zeros((self.n, 2), np.float32)
        self.fx = np.zeros((self.n, 2), np.float32)
        self.voice = np.zeros((self.n, 2), np.float32)

    def _add(self, bus, x, at, db=0.0, fade_in=0.0, fade_out=0.0, until=None):
        s = int(at * SR)
        if s >= self.n:
            return
        x = x[: self.n - s].copy() * (10 ** (db / 20))
        if until is not None:
            x = x[: max(0, int((until - at) * SR))]
        if fade_in > 0:
            k = min(len(x), int(fade_in * SR))
            x[:k] *= np.linspace(0, 1, k, dtype=np.float32)[:, None]
        if fade_out > 0:
            k = min(len(x), int(fade_out * SR))
            x[len(x) - k :] *= np.linspace(1, 0, k, dtype=np.float32)[:, None]
        if s < 0:
            x = x[-s:]
            s = 0
        bus[s : s + len(x)] += x

    def sfx(self, name, at, db=0.0, until=None):
        x, r = sf.read(os.path.join(SFX, name + ".wav"), dtype="float32", always_2d=True)
        self._add(self.fx, x, at, db, until=until)

    def vo(self, vid, at, db=0.0):
        x = read_audio(os.path.join(VO, vid + ".wav"))
        self._add(self.voice, x, at, db)
        return len(x) / SR

    def track(self, title, at, src_start, dur, db=-4.0, fade_in=0.05, fade_out=0.6, lowpass_until=None):
        if dur <= 0.05 or at >= self.n / SR:
            return
        x = read_audio(os.path.join(MUSIC, title + ".mp3"), src_start, dur)
        if lowpass_until is not None:  # muffled intro that opens up at lowpass_until (seconds from `at`)
            cut = int(lowpass_until * SR)
            y = x.copy()
            a = 1 - math.exp(-2 * math.pi * 500 / SR)
            s = np.zeros(2, np.float32)
            for i in range(min(cut, len(y))):
                s += a * (y[i] - s)
                y[i] = s
            x[:cut] = y[:cut] * 1.4
        self._add(self.music, x, at, db, fade_in, fade_out)

    def render(self, path, duck_db=-14.0, cut_silence=(), music_db=-3.0, fx_db=-7.0, target_lufs=-16.0):
        # duck music under the voice (smoothed envelope)
        env = np.abs(self.voice).max(axis=1)
        k = int(0.25 * SR)
        env = np.convolve(env, np.ones(k, np.float32) / k, mode="same")
        talking = np.clip(env / 0.01, 0, 1)
        k2 = int(0.4 * SR)
        talking = np.convolve(talking, np.ones(k2, np.float32) / k2, mode="same")
        duck = 10 ** (duck_db * talking / 20)
        mix = self.music * 10 ** (music_db / 20) * duck[:, None] + self.fx * 10 ** (fx_db / 20) + self.voice
        for a, b in cut_silence:
            mix[int(a * SR) : int(b * SR)] = 0
        # loudness: measure with ffmpeg ebur128, aim for target_lufs (-16: a notch under YouTube's level so hits never blast), soft-limit peaks
        tmp = path + ".tmp.wav"
        sf.write(tmp, mix, SR, subtype="FLOAT")
        out = subprocess.run(["ffmpeg", "-hide_banner", "-i", tmp, "-af", "ebur128", "-f", "null", "-"], capture_output=True, text=True).stderr
        os.remove(tmp)
        lufs = float([ln for ln in out.splitlines() if ln.strip().startswith("I:")][-1].split()[1])
        mix *= 10 ** ((target_lufs - lufs) / 20)
        lim = 10 ** (-3.0 / 20)  # AAC adds overshoot; this keeps the encoded true peak under -1 dB
        over = np.abs(mix) > lim * 0.8
        mix[over] = np.sign(mix[over]) * (lim * 0.8 + (lim * 0.2) * np.tanh((np.abs(mix[over]) - lim * 0.8) / (lim * 0.2)))
        sf.write(path, mix, SR, subtype="PCM_24")
        return lufs


def encode(frames_fn, n_frames, w, h, wav, out):
    os.makedirs(os.path.dirname(out), exist_ok=True)
    ff = subprocess.Popen(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-r", str(FPS), "-i", "pipe:0",
         "-i", wav, "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-profile:v", "high",
         "-c:a", "aac", "-b:a", "320k", "-movflags", "+faststart", "-shortest", out],
        stdin=subprocess.PIPE,
    )
    for i in range(n_frames):
        ff.stdin.write(frames_fn(i).tobytes())
        if i % (FPS * 10) == 0:
            print(f"    {i / FPS:5.0f}s / {n_frames / FPS:.0f}s", flush=True)
    ff.stdin.close()
    ff.wait()
    if ff.returncode:
        raise SystemExit(f"ffmpeg failed for {out}")
