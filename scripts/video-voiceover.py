r"""Makes the release-video voiceover with SHELLY's own local voice (Kokoro, on this PC).

Reads video/voiceover.txt ("<id> | <text>" per line) and writes one full-quality WAV per line to
video/vo/<id>.wav, plus video/vo/_all.wav (every line in order, for a quick listen).
It talks to Kokoro directly, not through the tunnel or the 64k-MP3 server, so the files are clean.

Run with the voice venv (scripts/start-llm.cmd sets it up):
    %USERPROFILE%\.shelly-tts\venv\Scripts\python.exe scripts\video-voiceover.py [--voice af_heart] [--speed 0.95] [ids...]
Lines whose text hasn't changed since the last run are skipped (video/vo/<id>.txt holds what was spoken).
"""
import argparse
import os
import re
import sys

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, "video", "voiceover.txt")
OUT = os.path.join(ROOT, "video", "vo")
HOME = os.path.join(os.path.expanduser("~"), ".shelly-tts")
LINE = re.compile(r"^([0-9]{2}-[0-9]{2}[a-z]?)\s*\|\s*(.+)$")


def read_script(path):
    lines = []
    with open(path, encoding="utf-8") as f:
        for raw in f:
            raw = raw.strip()
            if not raw or raw.startswith("#"):
                continue
            m = LINE.match(raw)
            if not m:
                sys.exit(f"bad line in voiceover.txt: {raw!r}")
            lines.append((m.group(1), " ".join(m.group(2).split())))
    return lines


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default=os.environ.get("SHELLY_TTS_VOICE", "af_heart"))
    ap.add_argument("--speed", type=float, default=0.95)
    ap.add_argument("--force", action="store_true", help="remake every line")
    ap.add_argument("ids", nargs="*", help="only these ids (default: all)")
    a = ap.parse_args()

    kokoro = Kokoro(os.path.join(HOME, "kokoro-v1.0.onnx"), os.path.join(HOME, "voices-v1.0.bin"))
    if a.voice not in set(kokoro.get_voices()):
        sys.exit(f"unknown voice {a.voice}")
    os.makedirs(OUT, exist_ok=True)

    lines = read_script(SCRIPT)
    want = set(a.ids)
    tag = f"{a.voice}@{a.speed}"
    rate = 24000
    for vid, text in lines:
        if want and vid not in want:
            continue
        wav, note = os.path.join(OUT, f"{vid}.wav"), os.path.join(OUT, f"{vid}.txt")
        spoken = f"{tag}\n{text}"
        if not a.force and os.path.exists(wav) and os.path.exists(note) and open(note, encoding="utf-8").read() == spoken:
            print(f"  same  {vid}")
            continue
        samples, rate = kokoro.create(text, voice=a.voice, speed=a.speed, lang="en-us")
        peak = float(np.abs(samples).max())
        if peak > 0.89:  # keep 1 dB of headroom so no clip ever clips
            samples = samples * (0.89 / peak)
        sf.write(wav, samples, rate, subtype="PCM_24")
        with open(note, "w", encoding="utf-8") as f:
            f.write(spoken)
        print(f"  made  {vid}  {len(samples) / rate:5.1f}s")

    # one file with every main line in order (skips "b" alternatives), for listening through
    gap = np.zeros(int(0.7 * 24000), dtype=np.float32)
    parts, total = [], 0.0
    for vid, _ in lines:
        if vid.endswith("b"):
            continue
        path = os.path.join(OUT, f"{vid}.wav")
        if os.path.exists(path):
            s, r = sf.read(path, dtype="float32")
            parts += [s, gap]
            total += len(s) / r
    if parts:
        sf.write(os.path.join(OUT, "_all.wav"), np.concatenate(parts), 24000, subtype="PCM_24")
        print(f"_all.wav: {total / 60:.1f} min of speech")


if __name__ == "__main__":
    main()
