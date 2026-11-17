r"""Local text-to-speech for SHELLY (Kokoro, runs on the CPU). OpenAI-style endpoint:

    POST /v1/audio/speech   {"input": "...", "voice": "af_heart", "speed": 1.0}   ->  audio/mpeg
    GET  /v1/voices

Listens on 127.0.0.1:8880 only. The auth proxy (scripts/llm-proxy.mjs) is what the tunnel talks to.
Run with the venv in %USERPROFILE%\.shelly-tts:   venv\Scripts\python.exe scripts\tts-server.py
Needs ffmpeg on PATH (WAV -> MP3).
"""
import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
from kokoro_onnx import Kokoro

HOME = os.path.join(os.path.expanduser("~"), ".shelly-tts")
PORT = int(os.environ.get("SHELLY_TTS_PORT", "8880"))
MAX_CHARS = 1500
DEFAULT_VOICE = os.environ.get("SHELLY_TTS_VOICE", "af_heart")

kokoro = Kokoro(os.path.join(HOME, "kokoro-v1.0.onnx"), os.path.join(HOME, "voices-v1.0.bin"))
VOICES = set(kokoro.get_voices())
lock = threading.Lock()  # one synthesis at a time


def to_mp3(samples: np.ndarray, rate: int) -> bytes:
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    p = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-f", "s16le", "-ar", str(rate), "-ac", "1", "-i", "pipe:0", "-b:a", "64k", "-f", "mp3", "pipe:1"],
        input=pcm, capture_output=True, check=True,
    )
    return p.stdout


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # quiet
        pass

    def send_json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.split("?")[0] == "/v1/voices":
            return self.send_json(200, {"voices": sorted(VOICES)})
        self.send_json(404, {"error": "not_found"})

    def do_POST(self):
        if self.path.split("?")[0] != "/v1/audio/speech":
            return self.send_json(404, {"error": "not_found"})
        try:
            n = int(self.headers.get("content-length", "0"))
            if n <= 0 or n > 20000:
                return self.send_json(413, {"error": "bad_size"})
            body = json.loads(self.rfile.read(n))
            text = " ".join(str(body.get("input", "")).split())[:MAX_CHARS]
            voice = body.get("voice") if body.get("voice") in VOICES else DEFAULT_VOICE
            speed = min(1.3, max(0.7, float(body.get("speed", 1.0))))
            if not text:
                return self.send_json(400, {"error": "empty"})
            with lock:
                samples, rate = kokoro.create(text, voice=voice, speed=speed, lang="en-us")
            mp3 = to_mp3(samples, rate)
        except Exception as e:  # never crash the server on one bad request
            print("tts error:", repr(e), file=sys.stderr)
            return self.send_json(500, {"error": "synthesis_failed"})
        self.send_response(200)
        self.send_header("content-type", "audio/mpeg")
        self.send_header("content-length", str(len(mp3)))
        self.end_headers()
        self.wfile.write(mp3)


if __name__ == "__main__":
    print(f"SHELLY TTS (Kokoro) on 127.0.0.1:{PORT}, {len(VOICES)} voices, default {DEFAULT_VOICE}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
