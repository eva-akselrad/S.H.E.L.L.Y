r"""Renders video 1, "Signal" (8 s): the cryptic tease-of-the-tease. See docs/VIDEO_PLAN.md section 5.

Inputs (real SHELLY pixels, captured from video/stage/ with headless Chrome):
    video/footage/signal/storm_1..3.png   the storm scene, 3840x2160
    video/footage/signal/eyes_<lid>.png   the host's eyes at lid 100/75/50/30/15/04, 3840x2160
Sound: video/sfx/*.wav (npm run video:sfx). No music, no voice.

    python scripts/video-signal.py [--date "SOON"] [--only 16x9|9x16]
Writes video/renders/signal_16x9.mp4 and signal_9x16.mp4 (H.264 + AAC, 30 fps).
"""
import argparse
import os
import subprocess

import numpy as np
import soundfile as sf
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FOOT = os.path.join(ROOT, "video", "footage", "signal")
SFX = os.path.join(ROOT, "video", "sfx")
OUT = os.path.join(ROOT, "video", "renders")
FPS, DUR, SR = 30, 8.0, 48000
FONT_BLACK = r"C:\Windows\Fonts\seguibl.ttf"
FONT_SEMI = r"C:\Windows\Fonts\seguisb.ttf"
TEAL = np.array([62, 207, 154], dtype=np.float32) / 255  # the host's skin teal
rng = np.random.default_rng(7)

# ---------------- timeline (seconds) ----------------
T_DOT = 1.5          # teal point + heartbeat
T_FLASH = 2.4        # lightning
T_EYES = 3.15        # eyes emerge from the dark
T_BLINK = 4.3
T_EYES_OUT = 4.85
T_TWO = 5.0          # the glitching "2"
T_CUT = 6.3          # hard cut to black (reverse_suck ends here)
T_DATE = 6.95        # date fades up
SFX_CUES = [  # (file, start s, gain dB)
    ("sub_rumble", 0.0, -2),
    ("heartbeat", T_DOT, 0),
    ("thunder", T_FLASH - 0.01, 0),
    ("ui_tick", T_BLINK + 0.03, -4),
    ("glitch", T_TWO, -1),
    ("slam", T_TWO, -5),
    ("glitch", T_TWO + 0.62, -6),
    ("reverse_suck", T_CUT - 1.6, -1),
    ("ui_pop", T_DATE, -3),
]


def load(name):
    return np.asarray(Image.open(os.path.join(FOOT, name + ".png")).convert("RGB"), dtype=np.float32) / 255


def fit(img, w, h, zoom=1.0, cx=0.5, cy=0.5):
    """Scale img to cover w x h (times zoom) and crop around (cx, cy)."""
    ih, iw = img.shape[:2]
    s = max(w / iw, h / ih) * zoom
    nw, nh = max(w, round(iw * s)), max(h, round(ih * s))
    im = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).resize((nw, nh), Image.LANCZOS)
    x = int(np.clip(cx * nw - w / 2, 0, nw - w))
    y = int(np.clip(cy * nh - h / 2, 0, nh - h))
    return np.asarray(im.crop((x, y, x + w, y + h)), dtype=np.float32) / 255


def ease(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


class Signal:
    def __init__(self, w, h, date):
        self.w, self.h, self.date = w, h, date
        self.vertical = h > w
        storms = [load(f"storm_{i}") for i in (1, 2, 3)]
        self.storm = [fit(s, w, h) for s in storms]
        lids = {k: load(f"eyes_{k}") for k in ("100", "75", "50", "30", "15", "04")}
        # eyes in the dark: keep the whites, sink the face. Scale so both eyes fit the frame width.
        z = 1.0 if not self.vertical else 0.56
        self.eyes = {}
        # a soft spotlight around the open eyes, so only a hint of the face survives and no edge shows
        open_white = np.clip((lids["100"].min(axis=2) - 0.78) / 0.2, 0, 1)
        spot = Image.fromarray((open_white * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(160))
        spot = np.asarray(spot, dtype=np.float32) / 255
        spot = (spot / max(spot.max(), 1e-6))[..., None]
        for k, im in lids.items():
            white = np.clip((im.min(axis=2) - 0.78) / 0.2, 0, 1)[..., None]
            self.eyes[k] = im * 0.05 * spot + white * im * 0.95
        self.eye_zoom = z
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        r = np.hypot((xx - w / 2) / (min(w, h) / 2), (yy - h / 2) / (min(w, h) / 2))
        self.vignette = np.clip(1.25 - r * 0.55, 0, 1)[..., None]
        self.r = r
        self.two = self.render_text("2", int(min(w, h) * (0.62 if not self.vertical else 0.5)), FONT_BLACK)
        self.date_img = self.render_text(date, int(min(w, h) * 0.045), FONT_SEMI, tracking=0.32)

    def render_text(self, text, size, font, tracking=0.0):
        f = ImageFont.truetype(font, size)
        im = Image.new("L", (self.w, self.h), 0)
        d = ImageDraw.Draw(im)
        spaced = text if not tracking else text
        if tracking:  # draw letter by letter with extra spacing
            widths = [d.textlength(c, font=f) for c in text]
            gap = size * tracking
            total = sum(widths) + gap * (len(text) - 1)
            x = (self.w - total) / 2
            for c, cw in zip(text, widths):
                d.text((x, 0), c, font=f, fill=255)
                x += cw + gap
            bbox = im.getbbox() or (0, 0, 1, 1)
            line = im.crop((0, bbox[1], self.w, bbox[3]))
            out = Image.new("L", (self.w, self.h), 0)
            out.paste(line, (0, int(self.h * (0.86 if not self.vertical else 0.8))))
            return np.asarray(out, dtype=np.float32) / 255
        bbox = d.textbbox((0, 0), spaced, font=f)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        d.text(((self.w - tw) / 2 - bbox[0], (self.h - th) / 2 - bbox[1]), spaced, font=f, fill=255)
        return np.asarray(im, dtype=np.float32) / 255

    # ---------- shots ----------
    def dot(self, t):
        u = t - T_DOT
        if u < 0 or u > 1.0:
            return None
        pulse = 1 + 0.35 * np.exp(-((u - 0.0) / 0.06) ** 2) + 0.25 * np.exp(-((u - 0.28) / 0.06) ** 2)
        life = ease(u / 0.08) * (1 - ease((u - 0.55) / 0.4))
        core = np.exp(-(self.r / (0.010 * pulse)) ** 2)
        halo = np.exp(-(self.r / (0.07 * pulse)) ** 2) * 0.35
        return (core[..., None] * 1.0 + halo[..., None] * TEAL * 1.4) * life

    def flash(self, t):
        f = round((t - T_FLASH) * FPS)
        strike = {0: (0, 0.95), 1: (0, 0.35), 2: (1, 0.8)}
        if f in strike:
            i, k = strike[f]
            sky = self.storm[i] * (1 + 2.2 * k) + np.array([0.87, 0.9, 1.0]) * k * 0.55
            return np.clip(sky, 0, 1)
        if 3 <= f <= 16:  # afterimage dying away
            return self.storm[2] * 0.35 * (1 - (f - 3) / 13) ** 2
        return None

    def eyes_shot(self, t):
        if t < T_EYES or t >= T_EYES_OUT + 0.15:
            return None
        u = t - T_EYES
        # opening: shut -> open over 0.35 s, then a blink at T_BLINK
        open_seq = ["04", "04", "15", "30", "50", "75", "100"]
        blink_seq = ["50", "15", "04", "04", "15", "50", "75", "100"]
        fo = int(u * FPS)
        fb = int((t - T_BLINK) * FPS)
        if fo < len(open_seq):
            k = open_seq[fo]
        elif 0 <= fb < len(blink_seq):
            k = blink_seq[fb]
        else:
            k = "100"
        zoom = self.eye_zoom * (1.0 + 0.06 * (u / (T_EYES_OUT - T_EYES)))
        drift = 0.5 + 0.01 * np.sin(u * 1.3)
        img = fit(self.eyes[k], self.w, self.h, zoom=zoom, cx=drift, cy=0.47) if zoom >= 1 else self.place(self.eyes[k], zoom * (1.0 + 0.06 * u))
        light = ease(u / 0.55) * (1 - ease((t - T_EYES_OUT) / 0.15))
        return img * light * self.vignette

    def place(self, img, scale):
        """Scale img down to `scale` of its cover size and centre it on black (for the vertical cut)."""
        ih, iw = img.shape[:2]
        s = max(self.w / iw, self.h / ih) * scale
        nw, nh = round(iw * s), round(ih * s)
        im = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).resize((nw, nh), Image.LANCZOS)
        canvas = Image.new("RGB", (self.w, self.h))
        canvas.paste(im, ((self.w - nw) // 2, int(self.h * 0.47 - nh * 0.47)))
        return np.asarray(canvas, dtype=np.float32) / 255

    def two_shot(self, t):
        if t < T_TWO or t >= T_CUT:
            return None
        u = t - T_TWO
        f = int(u * FPS)
        # flicker pattern: on most frames, off on a few, harder near the start and the cut
        if f in (1, 4, 5, 11, 19, 30, 33) or (t > T_CUT - 0.25 and f % 2):
            return np.zeros((self.h, self.w, 3), np.float32)
        a = self.two
        out = np.zeros((self.h, self.w, 3), np.float32)
        intensity = 1.0 if f < 8 or t > T_CUT - 0.5 else 0.35
        split = int(self.w * 0.012 * intensity * (1 + rng.random()))
        out[..., 0] = np.roll(a, -split, axis=1)
        out[..., 1] = a * 0.9 + np.roll(a, split // 2, axis=1) * 0.1
        out[..., 2] = np.roll(a, split, axis=1)
        out = out * 0.8 + a[..., None] * TEAL * 0.35
        # horizontal slice tears
        for _ in range(int(2 + 6 * intensity)):
            y0 = rng.integers(0, self.h - 10)
            hh = int(rng.integers(6, int(self.h * 0.06)))
            out[y0 : y0 + hh] = np.roll(out[y0 : y0 + hh], int(rng.normal(0, self.w * 0.04 * intensity)), axis=1)
        zoom_kick = 1 + 0.04 * np.exp(-u / 0.12)
        if zoom_kick > 1.001:
            out = fit(out, self.w, self.h, zoom=zoom_kick)
        return np.clip(out, 0, 1)

    def date_shot(self, t):
        if t < T_DATE:
            return None
        k = ease((t - T_DATE) / 0.35) * (1 - ease((t - (DUR - 0.35)) / 0.35))
        return self.date_img[..., None] * np.array([0.75, 0.84, 0.92]) * k

    def frame(self, t):
        img = np.zeros((self.h, self.w, 3), np.float32)
        for shot in (self.dot, self.flash, self.eyes_shot, self.two_shot, self.date_shot):
            s = shot(t)
            if s is not None:
                img = np.maximum(img, s)
        # film grain, a touch stronger in the dark
        grain = rng.normal(0, 0.018, (self.h // 2, self.w // 2)).astype(np.float32)
        grain = np.repeat(np.repeat(grain, 2, 0), 2, 1)[: self.h, : self.w, None]
        img = img + grain * (0.35 + 0.65 * (1 - img))
        return (np.clip(img, 0, 1) * 255).astype(np.uint8)


def mix_audio(path):
    n = int(DUR * SR)
    bus = np.zeros((n, 2), np.float32)
    for name, start, db in SFX_CUES:
        x, r = sf.read(os.path.join(SFX, name + ".wav"), dtype="float32", always_2d=True)
        assert r == SR, name
        s = int(start * SR)
        if s >= n:
            continue
        seg = x[: n - s] * 10 ** (db / 20)
        if start < T_CUT:  # everything before the cut stops dead on it; silence follows
            seg = seg[: max(0, int(T_CUT * SR) - s)]
        bus[s : s + len(seg)] += seg
    peak = np.abs(bus).max()
    bus *= 10 ** (-2.5 / 20) / max(peak, 1e-9)  # peak -2.5 dBFS, so the AAC encode stays under -1 dBTP
    sf.write(path, bus, SR, subtype="PCM_24")


def render(w, h, date, name):
    os.makedirs(OUT, exist_ok=True)
    wav = os.path.join(OUT, f"_{name}.wav")
    mix_audio(wav)
    sig = Signal(w, h, date)
    out = os.path.join(OUT, f"{name}.mp4")
    ff = subprocess.Popen(
        ["ffmpeg", "-y", "-loglevel", "error",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-r", str(FPS), "-i", "pipe:0",
         "-i", wav,
         "-c:v", "libx264", "-preset", "slow", "-crf", "15", "-pix_fmt", "yuv420p", "-profile:v", "high",
         "-c:a", "aac", "-b:a", "320k", "-movflags", "+faststart", "-shortest", out],
        stdin=subprocess.PIPE,
    )
    frames = int(DUR * FPS)
    for i in range(frames):
        ff.stdin.write(sig.frame(i / FPS).tobytes())
    ff.stdin.close()
    ff.wait()
    os.remove(wav)
    print(f"  {out}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default="SOON", help='text on the last card, e.g. "12.05" (default SOON)')
    ap.add_argument("--only", choices=["16x9", "9x16"])
    a = ap.parse_args()
    if a.only != "9x16":
        render(1920, 1080, a.date, "signal_16x9")
    if a.only != "16x9":
        render(1080, 1920, a.date, "signal_9x16")


if __name__ == "__main__":
    main()
