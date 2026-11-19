r"""Renders video 2, "Forecast" (30 s): cryptic. Skies, the turtle and the spiral logo. Never the name, never the app's screens. See docs/VIDEO_PLAN.md section 6.

Footage: npm run video:record (real SHELLY UI). Music: Strong Breeze from 1:36. Sound: video/sfx.
    python scripts/video-forecast.py [--date "SOON"] [--only 16x9|9x16]
Writes video/renders/forecast_16x9.mp4 and forecast_9x16.mp4.
"""
import argparse
import os

from PIL import Image, ImageDraw

from video_lib import (F_BLACK, F_BRAND, F_SEMI, FPS, RED, RENDERS, TEAL, Finisher, Mixer, blank, blend, brightness, clip, cover,
                       crop_rel, demo_tag, device, host_layer, ease, ease_out, encode, fast_blur, light_sweep, paste_alpha, place_device,
                       put_text, ramp, slam, still, text_layer)

DUR = 30.0
BEAT = 60 / 103.4              # Strong Breeze tempo
MUSIC_FROM = 96.0              # seconds into Strong Breeze
T_SKY, T_SCREEN, T_WARN = 8.0, 11.0, 14.0
T_TURTLE, T_RUSH, T_LOGO, T_DATE = 17.0, 22.0, 23.0, 25.6
CORAL = (255, 138, 101)        # the site's --accent, the colour of the spiral

# Never shows the app's screens or the name. Only the bare animated skies, the turtle, and the spiral.
# fragments (3..8 s): (source, crop box in 0..1). "host:" crops the turtle cut-out.
FRAGMENTS = [
    ("sky_storm", (0.10, 0.05, 0.45, 0.40)), ("sky_rain", (0.55, 0.20, 0.95, 0.60)), ("host:host_winter_curious", (0.45, 0.0, 1.0, 0.55)),
    ("sky_snow", (0.30, 0.30, 0.70, 0.70)), ("sky_storm", (0.50, 0.00, 0.95, 0.45)), ("sky_rain", (0.00, 0.40, 0.40, 0.95)),
    ("host:host_shades_happy", (0.40, 0.0, 1.0, 0.6)), ("sky_snow", (0.60, 0.05, 1.00, 0.50)), ("sky_storm", (0.20, 0.45, 0.70, 0.95)),
    ("sky_rain", (0.25, 0.00, 0.75, 0.45)), ("host:host_umbrella_focused", (0.0, 0.0, 0.7, 0.7)), ("sky_snow", (0.00, 0.50, 0.45, 1.00)),
    ("sky_storm", (0.65, 0.40, 1.00, 0.85)), ("sky_rain", (0.40, 0.55, 0.90, 1.00)), ("host:host_sleepy", (0.3, 0.2, 1.0, 0.9)),
    ("sky_snow", (0.15, 0.10, 0.55, 0.55)), ("sky_storm", (0.30, 0.20, 0.80, 0.70)),
]
SKIES = ["sky_rain", "sky_snow", "sky_storm", "sky_rain", "sky_snow", "sky_storm"]
OUTFITS = ["host_shades_happy", "host_winter_curious", "host_umbrella_focused", "host_sleepy"]


def spiral_points(n=400):
    """The SHELLY spiral from src/components/Chrome.tsx, as points in its 32x32 box (path converted to absolute curves)."""
    curves = [((16, 28), (9.4, 28), (4, 23.3), (4, 17.5)), ((4, 17.5), (4, 11.7), (9.4, 6), (16, 6)),
              ((16, 6), (22.6, 6), (26, 9.8), (26, 14.5)), ((26, 14.5), (26, 19.2), (22.4, 22), (18, 22)),
              ((18, 22), (13.6, 22), (11.5, 19.6), (11.5, 17)), ((11.5, 17), (11.5, 14.4), (13, 11.5), (15, 11.5))]
    pts = []
    for p0, p1, p2, p3 in curves:
        for k in range(n // len(curves)):
            t = k / (n // len(curves))
            m = 1 - t
            pts.append(tuple(m ** 3 * a + 3 * m * m * t * b + 3 * m * t * t * c + t ** 3 * d for a, b, c, d in zip(p0, p1, p2, p3)))
    pts.append((15, 11.5))
    return pts


SPIRAL = spiral_points()


class Forecast:
    def __init__(self, w, h, date):
        self.w, self.h, self.date, self.v = w, h, date, h > w
        self.fin = Finisher(w, h)
        self.title = int(min(w, h) * (0.13 if not self.v else 0.12))

    # ---------------- shots ----------------
    def macro(self, t):
        img = clip("sky_rain").frame(t, loop=True)
        img = cover(img, self.w, self.h, zoom=2.2 + 0.15 * t / 3, cx=0.45, cy=0.4)
        return brightness(fast_blur(img, 8), 0.9 * ramp(t, 0, 1.2))

    def fragment(self, t):
        i = int((t - 3.0) / 0.3)
        name, box = FRAGMENTS[i % len(FRAGMENTS)]
        u = ((t - 3.0) % 0.3) / 0.3
        if name.startswith("host:"):
            lay = host_layer(name[5:], self.h * 1.1)
            src = blank(lay.width, lay.height)
            src.paste(lay, (0, 0), lay)
        else:
            src = clip(name).frame(t - 3.0, loop=True)
        img = crop_rel(src, box, self.w, self.h)
        img = cover(img, self.w, self.h, zoom=1.0 + 0.08 * u)
        if i % 4 == 2:  # a glitchy one
            r, g, b = img.split()
            from PIL import ImageChops
            img = Image.merge("RGB", (ImageChops.offset(r, self.w // 90, 0), g, ImageChops.offset(b, -self.w // 90, 0)))
        return brightness(img, 0.8)

    def skies(self, t):
        u = t - T_SKY
        i = min(len(SKIES) - 1, int(u / BEAT))
        img = clip(SKIES[i]).frame(u + i, loop=True)
        img = cover(img, self.w, self.h, zoom=1.1 + 0.05 * ((u % BEAT) / BEAT), cx=0.5 if not self.v else 0.4)
        img = brightness(img, 0.6)
        slam(img, "Look up.", u, self.w / 2, self.h / 2, self.title)
        return img

    def screens(self, t):
        u = t - T_SCREEN
        img = blank(self.w, self.h, (6, 8, 12))
        glow = Image.new("RGB", (self.w, self.h), (12, 30, 40))
        img = blend(img, glow, 0.5)
        sky = lambda n, k: clip(n).frame(u + k, loop=True)  # the screens show only sky, never the app
        tv = device(sky("sky_storm", 0), "tv", int(self.w * (0.46 if not self.v else 0.82)))
        lap = device(sky("sky_rain", 1), "laptop", int(self.w * (0.30 if not self.v else 0.62)))
        ph = device(cover(sky("sky_snow", 2), 390, 844), "phone", int(self.w * (0.11 if not self.v else 0.26)))
        if not self.v:
            spots = [(tv, self.w * 0.30, self.h * 0.52), (lap, self.w * 0.70, self.h * 0.58), (ph, self.w * 0.88, self.h * 0.55)]
        else:
            spots = [(tv, self.w * 0.5, self.h * 0.30), (lap, self.w * 0.40, self.h * 0.62), (ph, self.w * 0.80, self.h * 0.66)]
        for k, (dev, x, y) in enumerate(spots):
            a = u - k * BEAT
            if a < 0:
                continue
            op = ease_out(a / 0.25)
            place_device(img, dev, x, y + (1 - op) * self.h * 0.06, opacity=op)
        slam(img, "Everywhere.", u, self.w / 2, self.h * (0.12 if not self.v else 0.86), int(self.title * 0.8))
        return img

    def warning(self, t):
        u = t - T_WARN
        img = clip("sky_storm").frame(u + 1.0, loop=True)
        img = cover(img, self.w, self.h, zoom=1.25 + 0.08 * u / 3, cx=0.5, cy=0.45)
        red = Image.new("RGB", img.size, RED)
        img = blend(brightness(img, 0.6), red, 0.22 + 0.14 * abs(((u * 2) % 2) - 1))
        slam(img, "Listen.", u, self.w / 2, self.h * 0.45, self.title)
        return img

    def turtle(self, t):
        u = t - T_TURTLE
        img = blank(self.w, self.h)
        beat = int(u / BEAT)
        flash = 1 <= beat <= len(OUTFITS) and (u % BEAT) < BEAT * 0.55
        x = self.w * (-0.2 + 1.4 * u / (T_RUSH - T_TURTLE))
        hgt = self.h * 0.5 if not self.v else self.w * 0.62
        if flash:
            lay = host_layer(OUTFITS[beat - 1], hgt)
            lay = light_sweep(lay, (u % BEAT) / (BEAT * 0.55))
            paste_alpha(img, lay, (x - lay.width / 2, self.h * 0.5 - lay.height / 2))
        else:  # silhouette with a teal rim
            lay = host_layer(clip("host_swim").frame(u, loop=True), hgt)
            alpha = lay.getchannel("A")
            rim = alpha.filter(__import__("PIL.ImageFilter", fromlist=["x"]).FIND_EDGES).point(lambda v: 255 if v > 40 else 0)
            sil = Image.new("RGBA", lay.size, (0, 0, 0, 0))
            sil.paste((4, 8, 12, 255), (0, 0), alpha)
            sil.paste(TEAL + (255,), (0, 0), rim)
            paste_alpha(img, sil, (x - lay.width / 2, self.h * 0.5 - lay.height / 2))
        return img

    def rush(self, t):
        u = t - T_RUSH
        img = self.turtle(T_RUSH - 0.01)
        z = 1 + 3 * ease(u)
        img = cover(img, self.w, self.h, zoom=z)
        return brightness(fast_blur(img, 30 * u), 1 - ease(u))

    def logo(self, t):
        """The spiral draws itself on, glows, and holds. No name, ever. The date fades in under it."""
        u = t - T_LOGO
        img = blank(self.w, self.h)
        size = min(self.w, self.h) * 0.36
        cx, cy = self.w / 2, self.h * (0.44 if not self.v else 0.45)
        sc = size / 32 * (1.08 - 0.08 * ease_out(u / 1.6))
        n = max(2, int(len(SPIRAL) * ease(u / 1.1)))
        pts = [(cx + (x - 16) * sc, cy + (y - 17) * sc) for x, y in SPIRAL[:n]]
        width = int(2.4 * sc)
        fade = 1 - ramp(u, DUR - T_LOGO - 0.8, DUR - T_LOGO)
        layer = Image.new("RGB", (self.w, self.h))
        d = ImageDraw.Draw(layer)
        d.line(pts, fill=CORAL, width=width, joint="curve")
        for p in (pts[0], pts[-1]):  # round caps
            d.ellipse((p[0] - width / 2, p[1] - width / 2, p[0] + width / 2, p[1] + width / 2), fill=CORAL)
        glow = brightness(fast_blur(layer, size * 0.09), 1.6 + 0.6 * max(0, 1 - abs(u - 1.15) / 0.4))
        from PIL import ImageChops
        img = ImageChops.add(img, glow)
        img = ImageChops.lighter(img, layer)
        if u > 1.1:  # one light pass along the stroke when it closes
            img = blend(img, ImageChops.add(img, brightness(layer, 0.5)), max(0, 1 - abs(u - 1.3) / 0.3))
        img = brightness(img, fade)
        put_text(img, self.date, F_SEMI, int(min(self.w, self.h) * 0.045), self.w / 2, cy + size * 0.78, (200, 214, 230),
                 ramp(t, T_DATE, T_DATE + 0.6) * fade, tracking=0.32)
        return img

    def frame(self, i):
        t = i / FPS
        if t < 3.0:
            img = self.macro(t)
        elif t < T_SKY:
            img = self.fragment(t)
        elif t < T_SCREEN:
            img = self.skies(t)
        elif t < T_WARN:
            img = self.screens(t)
        elif t < T_TURTLE:
            img = self.warning(t)
        elif t < T_RUSH:
            img = self.turtle(t)
        elif t < T_LOGO:
            img = self.rush(t)
        else:
            img = self.logo(t)
        return self.fin(img, i)


def audio(path):
    m = Mixer(DUR)
    m.track("Strong Breeze", 0.0, MUSIC_FROM, T_RUSH + 0.05, db=-5, fade_in=1.5, fade_out=0.05, lowpass_until=T_SKY)
    m.sfx("riser", T_SKY - 6.0, -3)
    for k in range(16):
        m.sfx("whoosh_fast", 3.0 + k * 0.3, -9)
    m.sfx("glitch", 3.6, -6)
    m.sfx("glitch", 6.0, -6)
    m.sfx("slam", T_SKY, -6)
    m.sfx("boom", T_SKY, -11)
    m.sfx("slam", T_SCREEN, -6)
    for k in range(3):
        m.sfx("whoosh", T_SCREEN + k * BEAT - 0.25, -8)
    m.sfx("slam", T_WARN, -6)
    m.sfx("boom", T_WARN, -8)
    for k in range(1, 5):
        m.sfx("shimmer", T_TURTLE + k * BEAT, -9)
        m.sfx("ui_pop", T_TURTLE + k * BEAT, -6)
    m.sfx("riser", T_RUSH - 5.0, -6, until=T_LOGO)
    m.sfx("reverse_suck", T_LOGO - 1.6, -2, until=T_LOGO)
    m.sfx("whoosh", T_LOGO - 0.1, -6)
    m.sfx("logo_hit", T_LOGO + 1.1, -5)
    m.sfx("ui_pop", T_DATE, -6)
    return m.render(path)


def render(w, h, date, name):
    os.makedirs(RENDERS, exist_ok=True)
    wav = os.path.join(RENDERS, f"_{name}.wav")
    lufs = audio(wav)
    print(f"  {name}: mix measured {lufs:.1f} LUFS before normalizing")
    f = Forecast(w, h, date)
    encode(f.frame, int(DUR * FPS), w, h, wav, os.path.join(RENDERS, f"{name}.mp4"))
    os.remove(wav)
    print(f"  wrote video/renders/{name}.mp4")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default="SOON")
    ap.add_argument("--only", choices=["16x9", "9x16"])
    a = ap.parse_args()
    if a.only != "9x16":
        render(1920, 1080, a.date, "forecast_16x9")
    if a.only != "16x9":
        render(1080, 1920, a.date, "forecast_9x16")
