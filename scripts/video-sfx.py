r"""SHELLY video sound-effects kit: every sound is synthesized here from scratch (no samples, no licences).

Writes 48 kHz / 24-bit stereo WAVs to video/sfx/. Same seed, same sounds, every run.
Run with any Python that has numpy + soundfile, e.g. the voice venv:
    %USERPROFILE%\.shelly-tts\venv\Scripts\python.exe scripts\video-sfx.py
"""
import os

import numpy as np
import soundfile as sf

SR = 48000
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "video", "sfx")
rng = np.random.default_rng(2026)


def t(sec):
    return np.arange(int(sec * SR)) / SR


def white(sec):
    return rng.uniform(-1, 1, int(sec * SR))


def brown(sec):
    x = np.cumsum(white(sec)) * 0.02
    x -= np.convolve(x, np.ones(2001) / 2001, mode="same")  # remove drift
    return x / (np.abs(x).max() + 1e-9)


def lowpass(x, cutoff):
    """One-pole low-pass; cutoff may be a number or a per-sample array (Hz)."""
    c = np.broadcast_to(np.asarray(cutoff, dtype=float), x.shape)
    a = 1 - np.exp(-2 * np.pi * c / SR)
    y, s = np.empty_like(x), 0.0
    for i in range(len(x)):
        s += a[i] * (x[i] - s)
        y[i] = s
    return y


def highpass(x, cutoff):
    return x - lowpass(x, cutoff)


def bandpass(x, center, q=2.0):
    """State-variable band-pass with a moving centre frequency (Hz, number or array)."""
    c = np.broadcast_to(np.asarray(center, dtype=float), x.shape)
    f = 2 * np.sin(np.pi * np.clip(c, 20, SR / 6) / SR)
    damp = 1 / q
    low = band = 0.0
    y = np.empty_like(x)
    for i in range(len(x)):
        high = x[i] - low - damp * band
        band += f[i] * high
        low += f[i] * band
        y[i] = band
    return y


def sweep_sine(f0, f1, sec, curve="exp"):
    tt = t(sec)
    if curve == "exp":
        freq = f0 * (f1 / f0) ** (tt / sec)
    else:
        freq = f0 + (f1 - f0) * tt / sec
    return np.sin(2 * np.pi * np.cumsum(freq) / SR)


def saw(freq, sec):
    ph = np.cumsum(np.broadcast_to(np.asarray(freq, dtype=float), t(sec).shape)) / SR
    return 2 * (ph % 1) - 1


def env_exp(sec, decay):
    return np.exp(-t(sec) / decay)


def fade(x, a=0.005, r=0.05):
    n_a, n_r = int(a * SR), int(r * SR)
    x = x.copy()
    if n_a:
        x[:n_a] *= np.linspace(0, 1, n_a)
    if n_r:
        x[-n_r:] *= np.linspace(1, 0, n_r)
    return x


def pad(x, sec):
    n = int(sec * SR)
    return np.pad(x, (0, max(0, n - len(x))))[:n]


def stereo(x, pan=None, width=0.0):
    """pan: -1..1 (number or array). width adds a short delay to one side for a wider sound."""
    p = np.broadcast_to(np.asarray(0.0 if pan is None else pan, dtype=float), x.shape)
    left, right = x * np.cos((p + 1) * np.pi / 4), x * np.sin((p + 1) * np.pi / 4)
    if width:
        d = int(width * SR)
        right = np.concatenate([np.zeros(d), right[:-d]]) if d else right
    return np.stack([left, right], axis=1) * np.sqrt(2)


def save(name, x, peak_db=-1.0):
    if x.ndim == 1:
        x = stereo(x)
    x = x / (np.abs(x).max() + 1e-9)
    x = np.tanh(x * 1.2) / np.tanh(1.2)  # gentle glue (after normalizing, so it never distorts)
    x = x / (np.abs(x).max() + 1e-9) * 10 ** (peak_db / 20)
    sf.write(os.path.join(OUT, f"{name}.wav"), x.astype(np.float32), SR, subtype="PCM_24")
    print(f"  {name:16s} {len(x) / SR:4.1f}s")


# ---------- sounds ----------

def boom(sec=3.0, f0=95, f1=32, decay=0.7, click=True):
    body = sweep_sine(f0, f1, sec) * env_exp(sec, decay)
    sub = np.sin(2 * np.pi * f1 * t(sec)) * env_exp(sec, decay * 1.6) * 0.5
    x = body + sub
    if click:
        x[: int(0.02 * SR)] += lowpass(white(0.02), 2500) * 1.5 * np.linspace(1, 0, int(0.02 * SR))
    return np.tanh(x * 2.0)


def whoosh(sec=1.4, lo=250, hi=5000, pan_from=-0.8, pan_to=0.8):
    tt = t(sec)
    shape = np.sin(np.pi * tt / sec) ** 2
    center = lo + (hi - lo) * shape
    x = bandpass(white(sec), center, q=1.6) * shape
    return stereo(x, pan=np.linspace(pan_from, pan_to, len(x)))


def shimmer(sec=2.5, n=40):
    x = np.zeros(int(sec * SR))
    for _ in range(n):
        f = rng.uniform(2200, 7000)
        start = int(rng.uniform(0, sec * 0.5) * SR)
        length = len(x) - start
        tone = np.sin(2 * np.pi * f * np.arange(length) / SR) * np.exp(-np.arange(length) / SR / rng.uniform(0.15, 0.6))
        x[start:] += tone * rng.uniform(0.3, 1)
    return stereo(fade(x, 0.01, 0.3), width=0.011)


def braam(sec=4.0, root=55.0):
    tt = t(sec)
    x = sum(saw(root * m * (1 + d), sec) for m, d in [(1, 0), (1, 0.006), (1, -0.005), (2, 0.003), (0.5, 0)])
    cutoff = 180 + 1400 * np.exp(-((tt - 0.35) ** 2) / 0.08)
    x = lowpass(lowpass(x, cutoff), cutoff)
    amp = np.minimum(1, tt / 0.04) * np.exp(-np.maximum(0, tt - 0.4) / 1.4)
    return stereo(np.tanh(x * amp * 1.5), width=0.008)


def main():
    os.makedirs(OUT, exist_ok=True)
    print("SHELLY sfx ->", OUT)

    save("sub_rumble", fade(lowpass(brown(5), 70) * np.sin(np.pi * t(5) / 5) ** 1.5, 0.5, 0.5), -3)
    save("boom", boom())
    save("slam", boom(1.0, 140, 45, 0.18))  # tight hit for text slamming in
    hb = np.zeros(int(1.2 * SR))
    for at, g in [(0.0, 1.0), (0.28, 0.7)]:
        s = int(at * SR)
        thump = np.sin(2 * np.pi * 52 * t(0.35)) * env_exp(0.35, 0.07)
        hb[s : s + len(thump)] += thump * g
    save("heartbeat", lowpass(hb, 300), -2)
    save("whoosh", whoosh())
    save("whoosh_fast", whoosh(0.6, 400, 7000, 0.6, -0.6))
    suck = white(1.6) * np.exp((t(1.6) - 1.6) / 0.35)
    save("reverse_suck", stereo(fade(bandpass(suck, np.linspace(300, 6000, len(suck)), 1.2), 0.2, 0.004), width=0.006))
    riser_t = t(6)
    riser = bandpass(white(6), 200 * (40 ** (riser_t / 6)), 1.4) * (riser_t / 6) ** 2
    riser += saw(90 * (8 ** (riser_t / 6)), 6) * (riser_t / 6) ** 3 * 0.25
    save("riser", stereo(fade(lowpass(riser, 9000), 0.3, 0.003), width=0.009))
    g = np.zeros(int(0.6 * SR))
    pos = 0
    while pos < len(g):
        n = int(rng.uniform(0.012, 0.05) * SR)
        if rng.random() < 0.7:
            f = rng.choice([180, 440, 880, 1760, 3300])
            chunk = np.sign(np.sin(2 * np.pi * f * np.arange(n) / SR)) * 0.6 + rng.uniform(-1, 1, n) * rng.uniform(0, 0.6)
            g[pos : pos + n] = np.round(chunk[: len(g) - pos] * 4) / 4  # bit-crushed
        pos += n
    save("glitch", stereo(g, pan=rng.uniform(-0.6, 0.6, len(g))), -3)
    crack = highpass(white(0.15), 1500) * env_exp(0.15, 0.03)
    roll = lowpass(brown(4.5), 220) * (0.4 + 0.6 * np.abs(lowpass(white(4.5), 3))) * 3
    roll *= np.minimum(1, t(4.5) / 0.08) * env_exp(4.5, 1.6)
    thunder = pad(crack * 1.4, 4.5) + roll
    save("thunder", stereo(fade(thunder, 0.001, 0.4), width=0.015))
    save("shimmer", shimmer(), -4)
    tick = np.sin(2 * np.pi * 2600 * t(0.07)) * env_exp(0.07, 0.008)
    save("ui_tick", tick, -6)
    pop = sweep_sine(500, 1400, 0.12) * env_exp(0.12, 0.03)
    save("ui_pop", pop, -6)
    save("braam", braam())
    logo = pad(boom(4.0), 4.0)[:, None] * 0.9 + braam(4.0) * 0.7 + shimmer(4.0) * 0.35
    save("logo_hit", logo)
    print("done")


if __name__ == "__main__":
    main()
