r"""YouTube thumbnails for the SHELLY Live stream (1280x720 PNG): an everyday one and a severe-weather one.

Needs the recorded footage (npm run video:record).
    python scripts/video-thumbnail.py
Writes video/renders/thumb_live.png and thumb_live_severe.png.
"""
import importlib.util
import os

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

from video_lib import (F_BLACK, F_BOLD, F_BRAND, RED, RENDERS, TEAL, blank, blend, brightness, clip, cover, fast_blur,
                       host_layer, paste_alpha, put_text, text_layer)

W, H = 1280, 720
S = 2  # draw at 2x, then scale down for clean edges
CORAL = (255, 138, 101)

_spec = importlib.util.spec_from_file_location("forecast", os.path.join(os.path.dirname(__file__), "video-forecast.py"))
_fc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_fc)
SPIRAL = _fc.SPIRAL


def spiral(size, color=CORAL):
    """The site's spiral logo as an RGBA layer."""
    lay = Image.new("RGBA", (int(size), int(size)), (0, 0, 0, 0))
    sc = size / 32
    pts = [(x * sc, y * sc) for x, y in SPIRAL]
    w = max(2, int(2.6 * sc))
    d = ImageDraw.Draw(lay)
    d.line(pts, fill=color + (255,), width=w, joint="curve")
    for p in (pts[0], pts[-1]):
        d.ellipse((p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2), fill=color + (255,))
    return lay


def gradient_left(img, color, strength):
    """Darken the left side so the words read, fading out to the right."""
    w, h = img.size
    ramp_ = np.clip(1.15 - np.linspace(0, 1, w) * 1.5, 0, 1) * strength
    mask = Image.fromarray((np.tile(ramp_, (h, 1)) * 255).astype(np.uint8))
    return Image.composite(Image.new("RGB", img.size, color), img, mask)


def pill(img, text, x, y, size, fill, dot=True):
    lay = text_layer(text, F_BLACK, size, (255, 255, 255), 0.06)
    pad = size * 0.45
    dw = size * 0.75 if dot else 0
    d = ImageDraw.Draw(img)
    box = (x, y, x + lay.width + pad * 2 + dw, y + lay.height + pad * 1.1)
    d.rounded_rectangle(box, radius=size * 0.3, fill=fill)
    if dot:
        r = size * 0.2
        cy = (box[1] + box[3]) / 2
        d.ellipse((x + pad, cy - r, x + pad + 2 * r, cy + r), fill=(255, 255, 255))
    img.paste(lay, (int(x + pad + dw), int(y + pad * 0.55)), lay)
    return box


def thumb(severe):
    w, h = W * S, H * S
    sky = clip("sky_storm" if severe else "sky_rain").frame(1.2)
    img = cover(sky, w, h, zoom=1.15, cx=0.6)
    if severe:
        img = blend(brightness(img, 0.75), Image.new("RGB", img.size, (120, 10, 14)), 0.45)
    img = gradient_left(img, (4, 8, 14) if not severe else (20, 2, 4), 0.92)

    # the host, big on the right, with a soft glow behind
    turtle = host_layer("host_worried" if severe else "host_umbrella_focused", h * (0.46 if severe else 0.6))
    glow = Image.new("RGBA", turtle.size, (0, 0, 0, 0))
    glow.paste(((RED if severe else TEAL) + (255,)), (0, 0), turtle.getchannel("A"))
    glow = glow.filter(ImageFilter.GaussianBlur(40 * S))
    tx, ty = w * 0.985 - turtle.width, h * 0.6 - turtle.height / 2
    paste_alpha(img, glow, (tx, ty), 0.55)
    paste_alpha(img, turtle, (tx, ty))

    x0 = 64 * S
    box = pill(img, "LIVE", x0, 58 * S, 34 * S, RED)
    put_text(img, "24/7" if not severe else "NOW", F_BLACK, 40 * S, box[2] + 22 * S, (box[1] + box[3]) / 2, (255, 255, 255), anchor="lm")

    lines = ["PHILLY", "WEATHER"] if not severe else ["SEVERE", "WEATHER"]
    for k, text in enumerate(lines):
        col = (255, 255, 255) if (k == 1 or not severe) else (255, 214, 102)
        lay = text_layer(text, F_BLACK, 132 * S, col, 0.0)
        sh = text_layer(text, F_BLACK, 132 * S, (0, 0, 0), 0.0)
        sh.putalpha(sh.getchannel("A").filter(ImageFilter.GaussianBlur(9 * S)).point(lambda v: v * 0.75))
        y = 160 * S + k * 140 * S
        paste_alpha(img, sh, (x0 + 6 * S, y + 8 * S))
        paste_alpha(img, lay, (x0, y))
    sub = "Radar · Forecast · Alerts" if not severe else "Live coverage · Philadelphia region"
    put_text(img, sub, F_BOLD, 38 * S, x0 + 4 * S, 500 * S, (225, 232, 240), anchor="lm")

    # brand: spiral + wordmark, bottom left
    sp = spiral(58 * S)
    img_rgba = img.convert("RGBA")
    img_rgba.alpha_composite(sp, (x0, 590 * S))
    img = img_rgba.convert("RGB")
    put_text(img, "SHELLY Live", F_BRAND, 50 * S, x0 + 76 * S, 621 * S, (255, 255, 255), anchor="lm")

    return img.resize((W, H), Image.LANCZOS)


def main():
    os.makedirs(RENDERS, exist_ok=True)
    for severe, name in [(False, "thumb_live.png"), (True, "thumb_live_severe.png")]:
        p = os.path.join(RENDERS, name)
        thumb(severe).save(p, optimize=True)
        print(f"  wrote video/renders/{name} ({os.path.getsize(p) // 1024} KB)")


if __name__ == "__main__":
    main()
