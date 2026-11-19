r"""Renders video 3, "SHELLY v2" (about 2.5 min): the release keynote with SHELLY's own voice.
See docs/VIDEO_PLAN.md section 7. The timeline is built from the real lengths of the voice clips.

Needs: npm run video:record (footage), npm run video:vo (voice), npm run video:sfx (effects).
    python scripts/video-release.py [--live-on-air] [--preview SECONDS]
Writes video/renders/release_16x9.mp4.
"""
import argparse
import os

import numpy as np
import soundfile as sf
from PIL import Image, ImageDraw

from video_lib import (F_BLACK, F_BOLD, F_BRAND, F_SEMI, FPS, RED, RENDERS, ROOT, SR, TEAL, VO, Finisher, Mixer, blank, blend,
                       brightness, clip, cover, crop_rel, demo_tag, device, host_layer, ease, ease_out, encode, fast_blur, light_sweep,
                       paste_alpha, place_device, put_text, ramp, read_audio, slam, still, text_layer)

W, H = 1920, 1080
LEGACY = os.path.join(ROOT, "docs", "screenshots", "legacy.png")
SKIES = ["kiosk_clear-day", "kiosk_partly-day", "kiosk_fog", "kiosk_drizzle", "kiosk_rain", "kiosk_storm",
         "kiosk_sleet", "kiosk_snow", "kiosk_cloudy", "kiosk_clear-night", "kiosk_partly-night"]
STUDIO = ["studio_note", "studio_impacts", "studio_odds", "studio_planner", "studio_compare", "studio_risk", "studio_snow"]
OUTFITS = ["host_shades_happy", "host_winter_curious", "host_umbrella_focused", "host_sleepy", "host_none_happy"]
LIVE_SEG = 5.0  # live_show was recorded as 6 segments of 5 s


def vo_len(vid):
    info = sf.info(os.path.join(VO, vid + ".wav"))
    return info.frames / info.samplerate


def live(u, seg):
    return clip("live_show").frame(seg * LIVE_SEG + (u % LIVE_SEG))


# ---------------- shots: f(img_or_None, u, d) -> Image, u = seconds into the beat, d = beat length ----------------
def sh_skies_open(u, d):
    names = ["sky_storm", "sky_snow", "sky_rain"]
    i = min(2, int(u / (d / 3)))
    a = clip(names[i]).frame(u, loop=True)
    img = cover(a, W, H, zoom=1.08 + 0.08 * (u / d))
    return brightness(img, ramp(u, 0, 1.5))


def sh_ordinary(u, d):
    img = Image.open(LEGACY).convert("L").convert("RGB")
    img = cover(img, W, H, zoom=1.0 + 0.04 * u / d)
    return brightness(img, 0.55)


def sh_black(u, d):
    return blank(W, H)


def logo_layer(size, sweep):
    word = text_layer("SHELLY", F_BRAND, size, (255, 255, 255), 0.06)
    v2 = text_layer("v2", F_BLACK, int(size * 0.62), TEAL)
    lay = Image.new("RGBA", (int(word.width + v2.width + size * 0.25), max(word.height, v2.height)), (0, 0, 0, 0))
    lay.alpha_composite(word, (0, lay.height - word.height))
    lay.alpha_composite(v2, (int(word.width + size * 0.25), lay.height - v2.height - int(size * 0.05)))
    return light_sweep(lay, sweep, strength=0.7)


def sh_logo(u, d, tagline=None):
    img = blank(W, H)
    k = ease_out(u / 0.35)
    lay = logo_layer(190, ramp(u, 0.15, 1.8))
    sc = 1.25 - 0.25 * k
    lay = lay.resize((int(lay.width * sc), int(lay.height * sc)), Image.BICUBIC)
    paste_alpha(img, lay, (W / 2 - lay.width / 2, H / 2 - lay.height / 2 - (40 if tagline else 0)), min(1, u / 0.1) * (1 - ramp(u, d - 0.4, d)))
    if tagline:
        put_text(img, tagline, F_SEMI, 46, W / 2, H / 2 + 120, (190, 205, 220), ramp(u, 1.0, 1.6) * (1 - ramp(u, d - 0.4, d)))
    return img


def sh_rebuilt(u, d):
    old = brightness(cover(Image.open(LEGACY).convert("L").convert("RGB"), W, H), 0.5)
    new = cover(clip("kiosk_partly-day").frame(u, loop=True), W, H)
    split = 1 - ease((u - (d * 0.68)) / 0.5)  # old slides away on "rebuilt from scratch"
    x = int(W * 0.5 * split) if u > 0.6 else int(W * 0.5 * ease(u / 0.6))
    img = new.copy()
    if x > 0:
        img.paste(old.crop((0, 0, x, H)), (0, 0))
        ImageDraw.Draw(img).rectangle((x - 2, 0, x + 2, H), fill=TEAL)
    return img


def sh_dedication(u, d):
    img = blank(W, H)
    lay = host_layer("host_none_happy", 560)
    a = ramp(u, 0, 0.8) * (1 - ramp(u, d - 0.5, d))
    paste_alpha(img, lay, (W / 2 - lay.width / 2, H * 0.42 - lay.height / 2), a * 0.9)
    put_text(img, "for Shelly", F_BRAND, 64, W / 2, H * 0.82, (220, 230, 225), ramp(u, 0.6, 1.4) * (1 - ramp(u, d - 0.5, d)), tracking=0.08)
    return img


def sh_local_ai(u, d):
    img = blank(W, H)
    lay = host_layer(clip("host_swim").frame(u, loop=True), 520)
    lay = light_sweep(lay, ramp(u, 0.2, 2.2), strength=0.4)
    paste_alpha(img, lay, (W / 2 - lay.width / 2, H * 0.36 - lay.height / 2), ramp(u, 0, 0.4))
    slam(img, "Its own AI.", u - 0.6, W / 2, H * 0.74, 110, hold=d)
    put_text(img, "On its own machine.", F_SEMI, 50, W / 2, H * 0.86, (190, 205, 220), ramp(u, d * 0.5, d * 0.5 + 0.4))
    return img


def sh_laptop_open(u, d):
    img = blank(W, H, (8, 10, 14))
    dev = device(clip("web_clear").frame(u, loop=True), "laptop", 1180)
    place_device(img, dev, W / 2, H / 2 + 30, scale=0.92 + 0.08 * ease_out(u / d), opacity=ease_out(u / 0.4))
    return img


def sh_screens(u, d):
    img = blend(blank(W, H, (6, 8, 12)), blank(W, H, (14, 34, 44)), 0.45)
    tv = device(clip("kiosk_partly-day").frame(u, loop=True), "tv", 880)
    lap = device(clip("web_clear").frame(u, loop=True), "laptop", 600)
    ph = device(clip("phone_clear").frame(u, loop=True).resize((390, 844)), "phone", 210)
    for k, (dev, x, y, at) in enumerate([(tv, W * 0.31, H * 0.5, 0.0), (lap, W * 0.70, H * 0.58, d * 0.33), (ph, W * 0.89, H * 0.55, d * 0.56)]):
        a = u - at
        if a >= 0:
            op = ease_out(a / 0.3)
            place_device(img, dev, x, y + (1 - op) * 70, opacity=op)
    return img


def sh_sky_run(u, d):
    i = min(len(SKIES) - 1, int(u / (d / len(SKIES))))
    img = cover(clip(SKIES[i]).frame(u, loop=True), W, H, zoom=1.05)
    if u > d * 0.55:
        img = brightness(fast_blur(img, 6), 0.35)
        slam(img, "Twelve skies.", u - d * 0.55, W / 2, H / 2, 170)
    return img


def sh_matters(u, d):
    img = blank(W, H)
    slam(img, "What really matters.", u - 0.1, W / 2, H / 2, 120)
    return img


def sh_takeover(u, d):
    if u < d * 0.5:
        img = cover(clip("kiosk_takeover").frame(u, loop=True), W, H, zoom=1.0 + 0.06 * u / d)
    else:
        img = pan_page(still("web_takeover_page"), ease((u - d * 0.5) / (d * 0.5)), 0.0, 0.55)
    demo_tag(img)
    return img


def sh_push(u, d):
    img = blend(blank(W, H, (8, 4, 6)), blank(W, H, (40, 8, 10)), 0.5)
    ph = device(clip("phone_takeover").frame(u, loop=True).resize((390, 844)), "phone", 330)
    place_device(img, ph, W * 0.3, H * 0.5, opacity=ease_out(u / 0.35))
    put_text(img, "Matched to the exact", F_BLACK, 76, W * 0.47, H * 0.42, opacity=ramp(u, 0.4, 0.8), anchor="lm")
    put_text(img, "shape of the warning.", F_BLACK, 76, W * 0.47, H * 0.52, opacity=ramp(u, 0.6, 1.0), anchor="lm")
    put_text(img, "Outside it? Quiet.", F_SEMI, 52, W * 0.47, H * 0.64, (200, 210, 220), ramp(u, d * 0.6, d * 0.6 + 0.4), anchor="lm")
    demo_tag(img)
    return img


def sh_promise(u, d):
    img = blank(W, H)
    lines = [("Alert wording comes from", F_SEMI, 64, 0.30, 0.18), ("the National Weather Service.", F_BLACK, 96, 0.42, 0.36),
             ("Never from AI.", F_BLACK, 110, 0.60, 0.62), ("Not one word.", F_BLACK, 110, 0.75, 0.82)]
    for text, font, size, y, at in lines:
        a = u - at * d
        if a >= 0:
            k = ease_out(a / 0.18)
            put_text(img, text, font, size, W / 2, H * y, opacity=min(1, a / 0.08), scale=1.3 - 0.3 * k)
    return img


def sh_demo_note(u, d):
    img = brightness(fast_blur(cover(clip("kiosk_takeover").frame(u, loop=True), W, H), 10), 0.5)
    demo_tag(img)
    put_text(img, "Demo alerts.", F_BLACK, 110, W / 2, H * 0.42, opacity=ramp(u, 0, 0.2))
    return img


def pan_page(page, k, a=0.08, b=0.92):
    """Show a full-width window of a tall page, scrolled from fraction a to b as k goes 0..1."""
    view_h = H * page.width / W
    y0 = max(0, page.height - view_h) * (a + (b - a) * k)
    return page.resize((W, H), Image.BICUBIC, box=(0, y0, page.width, y0 + view_h))


def sh_everyday(u, d):
    img = blend(blank(W, H, (8, 10, 14)), blank(W, H, (12, 28, 40)), 0.4)
    page = still("phone_page")  # every card, stacked
    k = ease(u / d)
    view = int(page.width * 844 / 390)
    y0 = int((page.height - view) * (0.04 + 0.6 * k))
    scr = page.crop((0, y0, page.width, y0 + view)).resize((390, 844), Image.BICUBIC)
    place_device(img, device(scr, "phone", 360), W * 0.3, H * 0.5, opacity=ease_out(u / 0.4))
    chips = ["Rain and snow nowcast", "Storm reports", "What to wear"]
    for i, text in enumerate(chips):
        at = 0.5 + i * (d - 2.0) / len(chips)
        a = u - at
        if a >= 0:
            put_text(img, text, F_BLACK, 76, W * 0.5, H * (0.34 + i * 0.15), opacity=ease_out(a / 0.25), anchor="lm")
    return img


def sh_app_in(u, d):
    img = blank(W, H, (8, 10, 14))
    ph = device(still("phone_getandroid").crop((0, 0, 1170, 2532)).resize((390, 844)), "phone", 340)
    place_device(img, ph, W / 2, H / 2 + (1 - ease_out(u / 0.5)) * 300, opacity=ease_out(u / 0.4))
    return img


def sh_app(u, d):
    k = 1.7
    return sh_app_in(u, k) if u < k else sh_android(u - k, d - k)


def sh_android(u, d):
    img = blend(blank(W, H, (8, 10, 14)), blank(W, H, (10, 30, 34)), 0.4)
    page = still("phone_getandroid")
    if u < d * 0.42:
        k = ease(u / (d * 0.42))
        y0 = max(0, (page.height - 2532) * k * 0.6)
        scr = page.crop((0, int(y0), 1170, int(y0) + 2532)).resize((390, 844))
    else:
        scr = clip("phone_takeover").frame(u, loop=True).resize((390, 844))
    place_device(img, device(scr, "phone", 340), W * 0.3, H * 0.5)
    if u >= d * 0.42:
        demo_tag(img)
    chips = [("Warnings wherever you are.", 0.0), ("Even when it's closed.", 0.3), ("Turns red when it matters.", 0.62)]
    for k, (text, at) in enumerate(chips):
        a = u - at * d
        if a >= 0:
            put_text(img, text, F_BLACK, 62, W * 0.45, H * (0.34 + k * 0.15), RED if k == 2 else (255, 255, 255), ease_out(a / 0.25), anchor="lm")
    return img


SIZZLE = [("kiosk_storm", None), ("kiosk_takeover", None), ("phone_takeover", "phone"), ("studio_snow", "still"),
          ("host_shades_happy", "host"), ("live_show", None), ("web_takeover", None), ("studio_odds", "still"),
          ("kiosk_snow", None), ("studio_risk", "still"), ("host_winter_curious", "host"), ("phone_clear", "phone"),
          ("kiosk_rain", None), ("studio_planner", "still"), ("host_umbrella_focused", "host"), ("kiosk_clear-night", None)]


def sh_sizzle(u, d):
    """Music-only montage: one shot per beat of Cumulus Commute (about 107.7 BPM)."""
    beat = 60 / 107.7
    i = min(len(SIZZLE) - 1, int(u / beat))
    name, kind = SIZZLE[i]
    v = (u % beat) / beat
    if kind == "still":
        img = cover(still(name), W, H, zoom=1.12 - 0.08 * v)
    elif kind == "host":
        img = blank(W, H)
        lay = host_layer(name, 600 * (1 + 0.06 * v))
        paste_alpha(img, lay, (W / 2 - lay.width / 2, H / 2 - lay.height / 2))
    elif kind == "phone":
        img = blend(blank(W, H, (8, 10, 14)), blank(W, H, (12, 28, 40)), 0.4)
        place_device(img, device(clip(name).frame(u, loop=True).resize((390, 844)), "phone", 330), W / 2, H / 2, scale=1.0 + 0.05 * v)
    else:
        img = cover(clip(name).frame(u + i, loop=True), W, H, zoom=1.15 - 0.1 * v)
    if name in ("kiosk_takeover", "phone_takeover", "web_takeover"):
        demo_tag(img)
    return brightness(img, 1.0 - 0.6 * ramp(u, d - 0.5, d))


def sh_live_montage(u, d):
    seg = 1 + min(4, int(u / (d / 5)))
    v = (u % (d / 5)) / (d / 5)
    return cover(live(u, seg), W, H, zoom=1.12 - 0.1 * ease(v), cx=0.45 + 0.1 * v)


def sh_omt(u, d, word_times):
    img = blank(W, H)
    words = ["One.", "More.", "Thing."]
    xs = [W * 0.24, W * 0.5, W * 0.77]
    for wd, x, at in zip(words, xs, word_times):
        a = u - at
        if a >= 0:
            put_text(img, wd, F_BLACK, 130, x, H / 2, opacity=min(1, a / 0.06), scale=1.2 - 0.2 * ease_out(a / 0.15))
    return img


def sh_live_meet(u, d):
    img = cover(live(u, 0), W, H, zoom=1.12 - 0.12 * ease_out(u / d))
    if u < 2.2:
        dark = brightness(img, 0.45)
        img = blend(img, dark, 1 - ramp(u, 1.6, 2.2))
        slam(img, "SHELLY Live", u - 0.15, W / 2, H / 2, 150, hold=2.2)
    return img


def sh_host(u, d):
    img = blank(W, H)
    if u < d * 0.35:
        lay = host_layer(clip("host_swim").frame(u, loop=True), 640)
        paste_alpha(img, lay, (W / 2 - lay.width / 2, H / 2 - lay.height / 2), ramp(u, 0, 0.3))
        return img
    v = u - d * 0.35
    i = min(len(OUTFITS) - 1, int(v / ((d * 0.65) / len(OUTFITS))))
    lay = host_layer(OUTFITS[i], 640)
    lay = light_sweep(lay, (v % ((d * 0.65) / len(OUTFITS))) / ((d * 0.65) / len(OUTFITS)), strength=0.35)
    paste_alpha(img, lay, (W / 2 - lay.width / 2, H / 2 - lay.height / 2))
    return img


def sh_live_meet_host(u, d):
    k = d * 0.62  # "Hosted by... a sea turtle" starts about here
    return sh_live_meet(u, k) if u < k else sh_host(u - k, d - k)


def sh_live_control(u, d):
    seg = 1 + min(3, int(u / (d / 4)))
    img = cover(live(u, seg), W, H, zoom=1.04)
    lines = [("The AI writes the calm stuff.", 0.0), ("A person approves it.", 0.36), ("Real warnings break through.", 0.6)]
    shown = [ln for ln in lines if u >= ln[1] * d and (u < 0.36 * d if ln[1] == 0.0 else u < 0.6 * d if ln[1] == 0.36 else True)]
    if u >= 0.6 * d:  # a TEST warning breaking through
        img = cover(clip("kiosk_takeover").frame(u, loop=True), W, H)
        demo_tag(img)
    if shown:
        band = Image.new("RGBA", (W, 230), (6, 8, 12, 215))
        paste_alpha(img, band, (0, H * 0.38), 1)
        for k, (text, at) in enumerate(shown):
            put_text(img, text, F_BLACK, 84, W / 2, H * 0.38 + 115 + (k - (len(shown) - 1) / 2) * 92, opacity=ramp(u, at * d, at * d + 0.2))
    return img


def sh_live_soon(u, d, on_air):
    img = brightness(cover(live(u, 5), W, H, zoom=1.03), 0.5)
    slam(img, "On the air now." if on_air else "Coming soon.", u - 0.1, W / 2, H / 2, 130)
    return img


def sh_studio(u, d):
    step = d / len(STUDIO)
    i = min(len(STUDIO) - 1, int(u / step))
    v = (u % step) / step
    img = cover(still(STUDIO[i]), W, H, zoom=1.06 - 0.06 * ease_out(v))
    if u < 1.6:
        band = Image.new("RGBA", (W, 170), (6, 8, 12, 220))
        paste_alpha(img, band, (0, H - 220), 1 - ramp(u, 1.3, 1.6))
        put_text(img, "Forecaster Studio", F_BLACK, 90, W / 2, H - 135, opacity=1 - ramp(u, 1.3, 1.6))
    return img


class Wave:
    def __init__(self, vid):
        x = read_audio(os.path.join(VO, vid + ".wav")).mean(axis=1)
        hop = SR // FPS
        self.env = np.array([np.sqrt(np.mean(x[i:i + hop] ** 2)) for i in range(0, len(x), hop)])
        self.env /= max(1e-6, self.env.max())

    def __call__(self, u, d):
        img = blank(W, H)
        i = int(u * FPS)
        bars = 64
        d2 = ImageDraw.Draw(img)
        for b in range(bars):
            j = i - bars // 2 + b
            e = self.env[j] if 0 <= j < len(self.env) else 0
            hgt = 6 + e * 300 * (1 - abs(b - bars / 2) / (bars / 1.6))
            x = W / 2 + (b - bars / 2) * 22
            d2.rounded_rectangle((x - 7, H * 0.45 - hgt / 2, x + 7, H * 0.45 + hgt / 2), 7, fill=TEAL)
        put_text(img, "SHELLY's own voice.", F_BLACK, 70, W / 2, H * 0.73, opacity=ramp(u, 0.5, 0.9))
        put_text(img, "No cloud. A computer in the next room.", F_SEMI, 44, W / 2, H * 0.81, (190, 205, 220), ramp(u, d * 0.35, d * 0.35 + 0.5))
        return img


def sh_outro(u, d):
    img = blank(W, H)
    host = host_layer(clip("host_swim").frame(u, loop=True), 380)
    paste_alpha(img, host, (W / 2 - host.width / 2, H * 0.12), ramp(u, 0, 0.5))
    put_text(img, "shelly.evaakselrad.com", F_BLACK, 96, W / 2, H * 0.62, opacity=ramp(u, 0.3, 0.7))
    put_text(img, "Android app: shelly.evaakselrad.com/get-android", F_SEMI, 46, W / 2, H * 0.74, (190, 205, 220), ramp(u, 2.0, 2.5))
    fade = 1 - ramp(u, d - 1.2, d)
    return brightness(img, fade)


# ---------------- timeline ----------------
def build(on_air):
    """Returns [(start, dur, shot_fn)], voice cues [(vid, at)], word times for 07-01, and chapter starts."""
    beats, cues, marks = [], [], {}
    t = 0.0

    def beat(vid, fn, pre=0.0, post=0.4, extra=0.0, mark=None):
        nonlocal t
        if mark:
            marks[mark] = t
        d_vo = vo_len(vid) if vid else 0.0
        if vid:
            cues.append((vid, t + pre))
        d = pre + d_vo + post + extra
        beats.append((t, d, fn, vid, t + pre))
        t += d
        return t - d

    beat("01-01", sh_skies_open, pre=3.0, post=0.4, mark="Cold open")
    beat("01-02", sh_ordinary, post=0.1)
    beat("01-03", sh_black, pre=0.1, post=0.4)
    beat("01-04", lambda u, d: sh_logo(u, d), post=1.8)
    beat("02-01", Wave("02-01"), pre=0.5, post=0.6, mark="Local AI")
    beat("02-02", sh_local_ai, pre=0.1, post=0.8)
    beat("02-03", sh_promise, pre=0.2, post=1.2)
    beat("03-01", sh_screens, pre=0.4, post=0.3, mark="Every screen, every sky")
    beat("03-02", sh_sky_run, post=3.6)
    beat("04-01", sh_takeover, pre=0.4, post=0.3, mark="Built for warnings")
    beat("04-02", sh_push, post=0.8)
    beat("05-01", sh_everyday, pre=0.4, post=1.6, mark="Every day")
    beat("06-01", sh_app, pre=0.3, post=1.2, mark="The Android app")
    beat(None, sh_sizzle, extra=len(SIZZLE) * 60 / 107.7)  # montage is now 8 shots
    # "One. More. Thing." with real pauses: the clip is split at its two quietest gaps
    omt_parts = split_words("07-01", 3)
    gap = 0.3
    omt_len = sum(len(p) for p in omt_parts) / SR + gap * 2
    marks["SHELLY Live"] = t
    word_times = []
    start = t + 0.4
    acc = start
    for p in omt_parts:
        word_times.append(acc - t)
        acc += len(p) / SR + gap
    beats.append((t, 0.4 + omt_len + 0.8, lambda u, d, wt=word_times: sh_omt(u, d, wt), "07-01", start))
    omt = (omt_parts, start, gap)
    t += 0.4 + omt_len + 0.8
    braam_at = t - 0.8
    beat("07-02", sh_live_meet_host, pre=0.1, post=0.6)
    beat(None, sh_live_montage, extra=7.5)
    beat("07-03", sh_live_control, post=0.9)
    beat("07-04a" if on_air else "07-04b", lambda u, d: sh_live_soon(u, d, on_air), post=0.6)
    beat("08-01", sh_studio, pre=0.3, post=3.0, mark="Forecaster Studio")
    beat("09-01", lambda u, d: sh_logo(u, d, "Weather, the way it always should have been."), pre=0.4, post=0.9, mark="Outro")
    beat("09-02", sh_outro, pre=0.2, post=3.5)
    cues = [c for c in cues if c[0] != "07-01"]
    return beats, cues, omt, braam_at, marks, t


def split_words(vid, n):
    """Split a short voice clip into n words at its quietest gaps."""
    x, r = sf.read(os.path.join(VO, vid + ".wav"), dtype="float32")
    x = x if x.ndim == 1 else x.mean(axis=1)
    win = int(0.02 * r)
    env = np.convolve(np.abs(x), np.ones(win) / win, mode="same")
    lo, hi = int(0.12 * len(x)), int(0.92 * len(x))
    cuts = []
    e = env.copy()
    for _ in range(n - 1):
        i = lo + int(np.argmin(e[lo:hi]))
        cuts.append(i)
        e[max(lo, i - int(0.15 * r)): min(hi, i + int(0.15 * r))] = 1e9
    cuts.sort()
    parts = np.split(x, cuts)
    import subprocess
    out = []
    for p in parts:  # to 48 kHz stereo
        raw = subprocess.run(["ffmpeg", "-v", "error", "-f", "f32le", "-ar", str(r), "-ac", "1", "-i", "pipe:0", "-ar", str(SR), "-ac", "2", "-f", "f32le", "-"],
                             input=p.astype(np.float32).tobytes(), capture_output=True, check=True).stdout
        out.append(np.frombuffer(raw, np.float32).reshape(-1, 2).copy())
    return out


def audio(path, beats, cues, omt, braam_at, marks, total):
    m = Mixer(total)
    for vid, at in cues:
        m.vo(vid, at)
    parts, start, gap = omt
    acc = start
    for p in parts:
        m._add(m.voice, p, acc)
        acc += len(p) / SR + gap
    ch = marks
    # music beds
    m.track("Catch the Sun", 0.0, 0.0, ch["Local AI"] + 0.5, db=-5, fade_in=0.5, fade_out=1.2)
    m.track("Midnight Reverie", ch["Local AI"] + 0.2, 0.0, ch["Every screen, every sky"] - ch["Local AI"] + 0.2, db=-11, fade_in=1.5, fade_out=0.8)
    m.track("Cumulus Commute (v4)", ch["Every screen, every sky"] - 0.2, 20.0, ch["Built for warnings"] - ch["Every screen, every sky"] + 0.6, db=-6, fade_in=0.6, fade_out=0.8)
    m.track("Cumulus Commute (v4)", ch["Every day"] - 0.5, 80.0, ch["SHELLY Live"] - ch["Every day"] + 0.5, db=-6, fade_in=1.0, fade_out=1.0)
    m.track("Midnight Reverie", braam_at + 0.3, 68.0, ch["Outro"] - braam_at + 0.2, db=-6, fade_in=1.5, fade_out=1.0)
    m.track("Catch the Sun", ch["Outro"], 16.0, total - ch["Outro"], db=-5, fade_in=1.0, fade_out=3.0)
    # warnings chapter: no music, a low rumble instead
    for k in range(int((ch["Every day"] - ch["Built for warnings"]) / 4.5) + 1):
        m.sfx("sub_rumble", ch["Built for warnings"] + k * 4.5, -10, until=ch["Every day"])
    # hits, by beat
    for (t0, d, fn, vid, vat) in beats:
        name = fn.__name__ if hasattr(fn, "__name__") else ""
        if vid == "01-03":
            m.sfx("boom", vat + 0.15, -7)
        elif vid == "01-04":
            m.sfx("logo_hit", t0, -5)
        elif vid == "02-01":
            m.sfx("glitch", t0, -8)
        elif vid == "02-02":
            m.sfx("slam", t0 + 0.7, -8)
        elif vid == "02-03":
            for at in (0.18, 0.36, 0.62):
                m.sfx("slam", t0 + at * d, -9)
            m.sfx("boom", t0 + 0.82 * d, -6)
        elif vid == "03-01":
            for at in (0.0, d * 0.33, d * 0.56):
                m.sfx("whoosh", t0 + at - 0.2, -8)
        elif vid == "03-02":
            for k in range(12):
                m.sfx("ui_tick", t0 + k * d / 12, -10)
            m.sfx("slam", t0 + d * 0.55, -7)
        elif vid == "04-01":
            m.sfx("slam", t0 + 0.1, -6)
        elif vid == "05-01":
            for k in range(3):
                m.sfx("ui_pop", t0 + 0.5 + k * (d - 2.0) / 3, -9)
        elif vid == "06-01":
            m.sfx("whoosh", t0 + 0.1, -6)
            m.sfx("slam", t0 + 1.7 + (d - 1.7) * 0.62, -8)
        elif vid == "07-02":
            m.sfx("slam", t0 + 0.15, -8)
            for k in range(len(OUTFITS)):
                m.sfx("shimmer", t0 + d * 0.62 + (d * 0.38) * (0.35 + k * 0.65 / len(OUTFITS)), -10)
        elif vid == "07-03":
            m.sfx("boom", t0 + 0.6 * d, -9)
        elif vid in ("07-04a", "07-04b"):
            m.sfx("slam", t0 + 0.1, -7)
        elif vid == "08-01":
            for k in range(len(STUDIO)):
                m.sfx("ui_pop", t0 + k * d / len(STUDIO), -9)
        elif fn is sh_sizzle:
            for k in range(len(SIZZLE)):
                m.sfx("whoosh_fast" if k % 4 == 0 else "ui_tick", t0 + k * 60 / 107.7 - (0.15 if k % 4 == 0 else 0), -10)
        elif fn is sh_live_montage:
            for k in range(5):
                m.sfx("whoosh", t0 + k * d / 5 - 0.3, -12)
        elif vid == "09-01":
            m.sfx("logo_hit", t0, -5)
    for at in [start + sum(len(p) for p in parts[:k]) / SR + gap * k for k in range(3)]:
        m.sfx("slam", at, -10)
    m.sfx("braam", braam_at, -6)
    m.sfx("riser", ch["SHELLY Live"] - 4.0, -8, until=ch["SHELLY Live"])
    return m.render(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--live-on-air", action="store_true", help='use 07-04a ("on the air right now") instead of "coming soon"')
    ap.add_argument("--preview", type=float, default=0, help="only render the first N seconds")
    a = ap.parse_args()
    beats, cues, omt, braam_at, marks, total = build(a.live_on_air)
    if a.preview:
        total = min(total, a.preview)
    print(f"  release: {total:.1f} s ({total / 60:.2f} min)")
    for k, v in marks.items():
        print(f"    {int(v // 60)}:{int(v % 60):02d} {k}")
    os.makedirs(RENDERS, exist_ok=True)
    wav = os.path.join(RENDERS, "_release.wav")
    audio(wav, beats, cues, omt, braam_at, marks, total)
    fin = Finisher(W, H, grain=0.012)

    def frame(i):
        t = i / FPS
        for (t0, d, fn, vid, vat) in beats:
            if t0 <= t < t0 + d:
                return fin(fn(t - t0, d), i)
        return fin(blank(W, H), i)

    encode(frame, int(total * FPS), W, H, wav, os.path.join(RENDERS, "release_16x9.mp4"))
    os.remove(wav)
    with open(os.path.join(RENDERS, "release_chapters.txt"), "w", encoding="utf-8") as f:
        for k, v in marks.items():
            f.write(f"{int(v // 60)}:{int(v % 60):02d} {k}\n")
    print("  wrote video/renders/release_16x9.mp4 and release_chapters.txt")


if __name__ == "__main__":
    main()
