r"""SHELLY profile picture (1080x1080 PNG): the turtle on a night-sky circle, safe for round crops.

    python scripts/video-pfp.py [pose] [--drive]
pose is a host_* footage folder (default host_shades_happy). Writes video/renders/pfp_<pose>.png.
"""
import os
import shutil
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from video_lib import RENDERS, host_layer, still

S = 1080
pose = next((a for a in sys.argv[1:] if not a.startswith("--")), "host_shades_happy")

# radial night sky, lighter behind the turtle
yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
r = np.hypot(xx - S / 2, yy - S * 0.47) / (S * 0.7)
inner, outer = np.array([44, 72, 118], np.float32), np.array([10, 16, 34], np.float32)
img = Image.fromarray((inner + (outer - inner) * np.clip(r, 0, 1)[..., None] ** 0.9).astype(np.uint8))

# sea at the bottom, clipped by the round crop anyway
sea = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(sea)
for base_y, col, amp, ph in [(800, (28, 110, 130, 255), 22, 0.0), (850, (16, 66, 92, 255), 16, 1.7)]:
    pts = [(x, base_y + amp * np.sin(x / 120 + ph)) for x in range(0, S + 20, 20)]
    d.polygon(pts + [(S, S), (0, S)], fill=col)
img.paste(sea, (0, 0), sea)

# turtle with a soft glow, centred inside the circle
turtle = host_layer(still(pose), 560)
glow = Image.new("RGBA", (S, S), (120, 230, 190, 255))
mask = Image.new("L", (S, S), 0)
mask.paste(turtle.getchannel("A"), ((S - turtle.width) // 2, 230))
glow.putalpha(mask.filter(ImageFilter.GaussianBlur(40)).point(lambda v: int(v * 0.45)))
img.paste(glow, (0, 0), glow)
img.paste(turtle, ((S - turtle.width) // 2, 230), turtle)

out = os.path.join(RENDERS, f"pfp_{pose}.png")
os.makedirs(RENDERS, exist_ok=True)
img.save(out)
print(out)
if "--drive" in sys.argv:
    drive = os.environ.get("SHELLY_DRIVE", r"G:\My Drive\SHELLY TikToks")
    os.makedirs(drive, exist_ok=True)
    shutil.copy2(out, os.path.join(drive, "shelly-profile-picture.png"))
    print("copied to", drive)
