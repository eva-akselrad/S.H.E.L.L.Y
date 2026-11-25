r"""A short vertical "we're live" TikTok for SHELLY Live (1080x1920, about 18 s, music + sound effects).

Each video is a folder under video/tiktok/<name>/ holding tiktok.json (the words) plus the
YouTube thumbnail and any forecast graphic it points to. Copy the last folder, change the words,
swap the pictures, and run:

    npm run video:tiktok -- <name>            # render video/renders/tiktok/<name>.mp4 (+ caption .txt)
    npm run video:tiktok -- <name> --preview  # just a few still frames, fast, to check the layout
    npm run video:tiktok -- <name> --drive    # render, then copy to Google Drive (G:\My Drive\SHELLY TikToks)

Host poses come from the recorded footage (npm run video:record); the video still renders without it.
Everything is kept inside TikTok's safe area (clear of the caption and the side buttons).
"""
import importlib.util
import json
import math
import os
import shutil
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from video_lib import (F_BLACK, F_BOLD, F_BRAND, F_SEMI, FOOTAGE, FPS, RED, RENDERS, Finisher, Mixer, blank, cover, encode,
                       ease_out, host_layer, paste_alpha, ramp, rounded, still, text_layer)

W, H = 1080, 1920
YELLOW = (255, 210, 63)
CORAL = (255, 138, 101)
INK = (11, 17, 32)
CARD = (20, 30, 52)
MAX_W = 920          # text width inside the safe area
CX = 510             # a bit left of centre: TikTok's buttons sit on the right

# scene starts (seconds); the last value is the total length
S_HOOK, S_HEAD, S_LIST, S_GFX, S_CTA, T_END = 0.0, 3.0, 6.6, 11.6, 14.4, 18.0
SCENES = [S_HOOK, S_HEAD, S_LIST, S_GFX, S_CTA, T_END]
XFADE = 0.22

_spec = importlib.util.spec_from_file_location("thumb", os.path.join(os.path.dirname(__file__), "video-thumbnail.py"))
_thumb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_thumb)
spiral = _thumb.spiral


# ---------------- helpers ----------------
def fit(text, font, max_w, size, min_size=40):
    while size > min_size and text_layer(text, font, size).width > max_w:
        size -= 4
    return size


def shadowed(text, font, size, color):
    """Text with a soft dark drop shadow, as one RGBA layer."""
    fg = text_layer(text, font, size, color)
    pad = size // 6
    lay = Image.new("RGBA", (fg.width + pad * 2, fg.height + pad * 2), (0, 0, 0, 0))
    sh = text_layer(text, font, size, (0, 0, 0))
    lay.alpha_composite(sh, (pad + size // 28, pad + size // 18))
    a = lay.getchannel("A").filter(ImageFilter.GaussianBlur(size / 22)).point(lambda v: int(v * 0.75))
    lay.putalpha(a)
    lay.alpha_composite(fg, (pad, pad))
    return lay


def place(base, lay, cx, cy, scale=1.0, opacity=1.0):
    if scale != 1.0:
        lay = lay.resize((max(1, int(lay.width * scale)), max(1, int(lay.height * scale))), Image.BICUBIC)
    paste_alpha(base, lay, (cx - lay.width / 2, cy - lay.height / 2), opacity)


def slam_in(base, lay, lt, cx, cy):
    """Lands big and settles in 0.18 s."""
    if lt < 0:
        return
    k = ease_out(lt / 0.18)
    place(base, lay, cx, cy, 1.35 - 0.35 * k, min(1.0, lt / 0.08))


def wrap(text, font, size, max_w):
    f = ImageFont.truetype(font, size)
    d = ImageDraw.Draw(Image.new("L", (1, 1)))
    lines, cur = [], ""
    for w in text.split():
        nxt = (cur + " " + w).strip()
        if d.textlength(nxt, font=f) <= max_w or not cur:
            cur = nxt
        else:
            lines.append(cur)
            cur = w
    return lines + [cur]


def pill(text, size, fill, color=(255, 255, 255), dot=None):
    t = text_layer(text, F_BLACK, size, color, 0.04)
    pad_x, pad_y = int(size * 0.55), int(size * 0.32)
    dot_w = int(size * 0.9) if dot is not None else 0
    lay = Image.new("RGBA", (t.width + pad_x * 2 + dot_w, t.height + pad_y * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    d.rounded_rectangle((0, 0, lay.width - 1, lay.height - 1), int(size * 0.3), fill=fill + (255,))
    if dot is not None:
        r = size * 0.24 * (0.8 + 0.2 * dot)
        cy = lay.height / 2
        d.ellipse((pad_x + size * 0.2 - r, cy - r, pad_x + size * 0.2 + r, cy + r), fill=(255, 255, 255, int(150 + 105 * dot)))
    lay.alpha_composite(t, (pad_x + dot_w, pad_y))
    return lay


def host(name, height):
    if not name or not os.path.exists(os.path.join(FOOTAGE, name, "still.png")):
        return None
    return host_layer(still(name), height)


# ---------------- background: night sky, rain, sea ----------------
class Backdrop:
    def __init__(self):
        g = np.linspace(0, 1, H, dtype=np.float32)[:, None, None]
        top, bot = np.array([10, 16, 34], np.float32), np.array([30, 50, 86], np.float32)
        self.sky = Image.fromarray((top + (bot - top) * g ** 1.2).repeat(W, 1).astype(np.uint8))
        cloud = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(cloud)
        for x, y, rx, ry in [(780, 260, 420, 130), (240, 190, 360, 110), (560, 120, 300, 90)]:
            d.ellipse((x - rx, y - ry, x + rx, y + ry), fill=(70, 90, 130, 120))
        self.cloud = cloud.filter(ImageFilter.GaussianBlur(40))
        rng = np.random.default_rng(7)
        self.drops = [(rng.uniform(-200, W), rng.uniform(0, H), rng.uniform(900, 1500), rng.uniform(40, 90), rng.uniform(60, 130)) for _ in range(90)]

    def __call__(self, t, flash=0.0):
        img = self.sky.copy()
        img.paste(self.cloud, (int(-30 * math.sin(t * 0.3)), 0), self.cloud)
        rain = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(rain)
        for x0, y0, v, ln, a in self.drops:
            y = (y0 + v * t) % (H + 200) - 100
            x = x0 + (y - y0) * 0.18
            d.line((x, y, x + ln * 0.18, y + ln), fill=(170, 195, 235, int(a)), width=3)
        img.paste(rain, (0, 0), rain)
        sea = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(sea)
        for k, (base_y, col, amp, sp) in enumerate([(1690, (28, 110, 130, 255), 26, 1.4), (1760, (16, 66, 92, 255), 20, -1.1)]):
            pts = [(x, base_y + amp * math.sin(x / 150 + t * sp + k)) for x in range(0, W + 20, 20)]
            d.polygon(pts + [(W, H), (0, H)], fill=col)
        img.paste(sea, (0, 0), sea)
        if flash > 0:
            img = Image.blend(img, Image.new("RGB", (W, H), (220, 230, 255)), min(0.75, flash))
        return img


# ---------------- scenes ----------------
class Video:
    def __init__(self, folder, cfg):
        self.cfg, self.folder = cfg, folder
        self.bg = Backdrop()
        self.host_open = host(cfg.get("host_open"), 470)
        self.host_close = host(cfg.get("host_close"), 300)
        hook = cfg["hook"]
        self.hook = [shadowed(hook[0], F_BLACK, fit(hook[0], F_BLACK, MAX_W, 230), (255, 255, 255)),
                     shadowed(hook[1], F_BLACK, fit(hook[1], F_BLACK, MAX_W, 330), tuple(cfg.get("hook_color", RED)))]
        self.badge = cfg.get("badge", "LIVE NOW")  # the pulsing pill over the hook; "" hides it
        h = cfg["headline"]
        self.head = [shadowed(h[0], F_BLACK, fit(h[0], F_BLACK, MAX_W, 170), (255, 255, 255)),
                     shadowed(h[1], F_BLACK, fit(h[1], F_BLACK, MAX_W, 170), YELLOW)]
        self.tag = pill(cfg["tagline"], fit(cfg["tagline"], F_BLACK, MAX_W - 80, 58), INK)
        when = cfg.get("when_line") or "SHELLY LIVE  •  " + cfg["when"]
        self.when = shadowed(when, F_BLACK, fit(when, F_BLACK, MAX_W, 60), (255, 255, 255))
        self.list_title = text_layer(cfg["bullets_title"], F_BLACK, 64, YELLOW, 0.08)
        self.cards = [self._card(b) for b in cfg["bullets"]]
        self.gfx = None
        if cfg.get("graphic"):
            g = Image.open(os.path.join(folder, cfg["graphic"])).convert("RGB")
            self.gfx = g.resize((1960, int(g.height * 1960 / g.width)), Image.LANCZOS)
            self.gfx_focus = cfg.get("graphic_focus", [0.5, 0.5])
        self.gfx_label = shadowed(cfg.get("graphic_label", ""), F_BLACK, fit(cfg.get("graphic_label", " "), F_BLACK, MAX_W, 66), (255, 255, 255))
        th = Image.open(os.path.join(folder, cfg.get("thumbnail", "thumbnail.png"))).convert("RGB")
        self.thumb = self._framed(th.resize((900, int(th.height * 900 / th.width)), Image.LANCZOS), 26)
        self.cta = [shadowed(c, F_BLACK, fit(c, F_BLACK, MAX_W, 150), YELLOW if i else (255, 255, 255)) for i, c in enumerate(cfg["cta"])]
        sub = cfg["cta_sub"]  # where to watch: a web address or a YouTube handle
        self.cta_sub = pill(sub, fit(sub, F_BLACK, MAX_W - 110, 72), YELLOW, color=INK)
        note = cfg.get("cta_note", "")
        self.cta_note = shadowed(note, F_BLACK, fit(note, F_BLACK, 560, 64), (255, 255, 255)) if note else None
        self.logo = spiral(84)
        self.brand = text_layer("SHELLY LIVE", F_BRAND, 70, (255, 255, 255), 0.12)

    def _framed(self, img, radius):
        r = rounded(img, radius)
        pad = 40
        out = Image.new("RGBA", (r.width + pad * 2, r.height + pad * 2), (0, 0, 0, 0))
        m = Image.new("L", out.size, 0)
        ImageDraw.Draw(m).rounded_rectangle((pad, pad + 14, pad + r.width, pad + r.height + 14), radius, fill=170)
        out.putalpha(m.filter(ImageFilter.GaussianBlur(18)))
        out.alpha_composite(r, (pad, pad))
        return out

    def _card(self, text):
        size = 54
        lines = wrap(text, F_BOLD, size, MAX_W - 110)
        lh = int(size * 1.25)
        h = lh * len(lines) + 70
        card = Image.new("RGBA", (MAX_W + 20, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(card)
        d.rounded_rectangle((0, 0, card.width - 1, h - 1), 22, fill=CARD + (235,))
        d.rounded_rectangle((0, 0, 16, h - 1), 8, fill=YELLOW + (255,))
        f = ImageFont.truetype(F_BOLD, size)
        for i, ln in enumerate(lines):
            d.text((56, 35 + i * lh + lh / 2), ln, font=f, fill=(245, 247, 252, 255), anchor="lm")
        return card

    # each scene draws onto base at local time lt
    def s_hook(self, base, lt):
        pulse = 0.5 + 0.5 * math.sin(lt * 7)
        if self.badge:
            slam_in(base, pill(self.badge, 64, RED, dot=pulse), lt, CX, 330)
        slam_in(base, self.hook[0], lt - 0.25, CX, 610)
        slam_in(base, self.hook[1], lt - 0.55, CX, 860)
        if self.host_open:
            k = ease_out((lt - 0.4) / 0.6)
            place(base, self.host_open, CX, 1290 + (1 - k) * 700 + 10 * math.sin(lt * 3), opacity=min(1, k * 2))

    def s_head(self, base, lt):
        slam_in(base, self.head[0], lt - 0.1, CX, 560)
        slam_in(base, self.head[1], lt - 0.4, CX, 740)
        k = ease_out((lt - 0.9) / 0.4)
        place(base, self.tag, CX, 930 + (1 - k) * 40, opacity=k)
        k = ease_out((lt - 1.4) / 0.4)
        place(base, self.when, CX, 1080 + (1 - k) * 40, opacity=k)
        if self.host_open:
            place(base, self.host_open, CX, 1340 + 10 * math.sin((lt + 3) * 3), 0.85)

    def s_list(self, base, lt):
        k = ease_out(lt / 0.3)
        place(base, self.list_title, CX, 300, opacity=k)
        y = 400
        for i, card in enumerate(self.cards):
            k = ease_out((lt - 0.5 - i * 0.7) / 0.35)
            if k > 0:
                paste_alpha(base, card, (CX - card.width / 2 + (1 - k) * 120, y), k)
            y += card.height + 26
        k = ease_out((lt - 3.6) / 0.4)
        place(base, self.when, CX, max(y + 70, 1400), opacity=k)

    def s_gfx(self, base, lt):
        place(base, self.gfx_label, CX, 420, opacity=ease_out(lt / 0.3))
        k = ease_out(lt / 0.45)
        z = 1 + 0.9 * ramp(lt, 1.0, 1.9)  # show the whole graphic, then push in on graphic_focus
        gw, gh = 980, int(980 * self.gfx.height / self.gfx.width)
        view = cover(self.gfx, gw, gh, z, *self.gfx_focus, resample=Image.LANCZOS)
        g = self._framed(view, 22).rotate(-4 * (1 - k), Image.BICUBIC, expand=True)
        place(base, g, CX, 820 + (1 - k) * 260, scale=0.92 + 0.08 * k, opacity=min(1, k * 1.5))
        k = ease_out((lt - 0.8) / 0.4)
        place(base, self.when, CX, 1200 + (1 - k) * 40, opacity=k)
        if self.host_close:
            place(base, self.host_close, CX, 1400 + 8 * math.sin(lt * 3), opacity=k)

    def s_cta(self, base, lt):
        k = ease_out(lt / 0.35)
        row = Image.new("RGBA", (self.logo.width + 24 + self.brand.width, max(self.logo.height, self.brand.height)), (0, 0, 0, 0))
        row.alpha_composite(self.logo, (0, (row.height - self.logo.height) // 2))
        row.alpha_composite(self.brand, (self.logo.width + 24, (row.height - self.brand.height) // 2))
        place(base, row, CX, 290, opacity=k)
        slam_in(base, self.cta[0], lt - 0.2, CX, 450)
        slam_in(base, self.cta[1], lt - 0.45, CX, 600)
        k = ease_out((lt - 0.7) / 0.45)
        place(base, self.thumb, CX, 960 + (1 - k) * 120, scale=0.94 + 0.06 * k, opacity=k)
        k = ease_out((lt - 1.1) / 0.35)
        place(base, self.cta_sub, CX, 1300 + (1 - k) * 30, scale=0.9 + 0.1 * k, opacity=k)
        k = ease_out((lt - 1.6) / 0.4)
        if self.host_close:
            hx = 250 if self.cta_note else CX
            place(base, self.host_close.resize((self.host_close.width * 2 // 3, self.host_close.height * 2 // 3), Image.BICUBIC),
                  hx, 1470 + 6 * math.sin(lt * 3), opacity=k)
        if self.cta_note:
            place(base, self.cta_note, 640 if self.host_close else CX, 1470 + (1 - k) * 30, opacity=k)

    def scene(self, idx, t):
        lt = t - SCENES[idx]
        flash = max(0.0, 1 - lt / 0.25) * 0.8 if idx == 0 else 0.0
        if idx == 0 and 1.6 < lt < 1.9:
            flash = 0.5 * (1 - (lt - 1.6) / 0.3)
        base = self.bg(t, flash)
        [self.s_hook, self.s_head, self.s_list, self.s_gfx, self.s_cta][idx](base, lt)
        return base

    def frame(self, t):
        idx = max(i for i in range(5) if SCENES[i] <= t)
        img = self.scene(idx, t)
        if idx > 0 and t - SCENES[idx] < XFADE:
            prev = self.scene(idx - 1, t)
            img = Image.blend(prev, img, ramp(t - SCENES[idx], 0, XFADE))
        if t > T_END - 0.5:
            img = Image.blend(img, blank(W, H), ramp(t, T_END - 0.5, T_END) * 0.9)
        return img


def soundtrack(cfg, wav):
    m = Mixer(T_END)
    m.track(cfg.get("music", "Strong Breeze"), 0.0, float(cfg.get("music_start", 0)), T_END, db=-5, fade_in=0.3, fade_out=1.5)
    m.sfx("braam", 0.0, -3)
    m.sfx("thunder", 0.0, -2)
    m.sfx("slam", 0.25)
    m.sfx("slam", 0.55)
    m.sfx("thunder", 1.6, -8)
    for at in (S_HEAD, S_LIST, S_GFX, S_CTA):
        m.sfx("whoosh", at - 0.12, -4)
    m.sfx("slam", S_HEAD + 0.1, -2)
    m.sfx("slam", S_HEAD + 0.4, -2)
    for i in range(len(cfg["bullets"])):
        m.sfx("ui_pop", S_LIST + 0.5 + i * 0.7, -2)
    m.sfx("logo_hit", S_CTA + 0.2, -2)
    return m.render(wav)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        raise SystemExit("usage: npm run video:tiktok -- <folder under video/tiktok> [--preview] [--drive]")
    name = args[0]
    folder = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "video", "tiktok", name)
    cfg = json.load(open(os.path.join(folder, "tiktok.json"), encoding="utf-8"))
    v = Video(folder, cfg)
    out_dir = os.path.join(RENDERS, "tiktok")
    os.makedirs(out_dir, exist_ok=True)

    if "--preview" in sys.argv:
        for t in (1.5, 5.0, 10.8, 13.5, 16.5):
            p = os.path.join(out_dir, f"{name}_preview_{t:04.1f}s.png")
            v.frame(t).save(p)
            print(p)
        return

    out = os.path.join(out_dir, f"{name}.mp4")
    wav = os.path.join(out_dir, f"{name}.wav")
    print(f"  mixing sound ({soundtrack(cfg, wav):.1f} LUFS before leveling)")
    fin = Finisher(W, H, grain=0.012, vignette=0.18)
    n = int(T_END * FPS)
    encode(lambda i: fin(v.frame(i / FPS), i), n, W, H, wav, out)
    os.remove(wav)
    cap = os.path.join(out_dir, f"{name}_caption.txt")
    with open(cap, "w", encoding="utf-8") as f:
        f.write(cfg.get("caption", "") + "\n")
    print(f"  wrote {out}\n  wrote {cap}")

    if "--drive" in sys.argv:
        drive = os.environ.get("SHELLY_DRIVE", r"G:\My Drive\SHELLY TikToks")
        os.makedirs(drive, exist_ok=True)
        for p in (out, cap):
            shutil.copy2(p, drive)
        print(f"  copied to {drive}")


if __name__ == "__main__":
    main()
