#!/usr/bin/env python3
"""Generates the synthetic image fixtures for crates/oel-img (deterministic, Pillow only).

    python3 fixtures/img/src/make_fixtures.py

Each image mixes smooth gradients (tone controls), colour patches covering the eight HSL
bands (mixer, grading, vibrance), and fine noise (texture, sharpening, noise reduction).
"""
import colorsys
import math
import random
from pathlib import Path

from PIL import Image

OUT = Path(__file__).resolve().parent.parent
W, H = 240, 160


def clamp(v):
    return max(0, min(255, int(round(v))))


def scene(w, h, *, lo, hi, sat, seed):
    """Sky gradient on top, eight hue patches across the middle, textured ground below."""
    rng = random.Random(seed)
    img = Image.new("RGB", (w, h))
    px = img.load()
    hues = [0, 30, 60, 120, 180, 240, 270, 300]
    for y in range(h):
        for x in range(w):
            t = y / (h - 1)
            n = (rng.random() - 0.5) * 18
            if t < 0.35:
                # sky: blue → pale, left → right brightness ramp
                v = lo + (hi - lo) * (0.55 + 0.45 * x / (w - 1))
                r, g, b = colorsys.hsv_to_rgb(0.58, 0.45 * sat * (1 - t), v)
                n *= 0.2
            elif t < 0.65:
                band = min(7, x * 8 // w)
                v = lo + (hi - lo) * (0.35 + 0.6 * (1 - abs((t - 0.5) / 0.15)))
                r, g, b = colorsys.hsv_to_rgb(hues[band] / 360, sat, v)
                n *= 0.5
            else:
                # ground: warm midtones with a radial spot and fine texture
                d = math.hypot(x - w * 0.7, y - h * 0.85) / w
                v = lo + (hi - lo) * (0.25 + 0.5 * max(0, 1 - d * 2.5))
                r, g, b = colorsys.hsv_to_rgb(0.08, 0.35 * sat, v)
            px[x, y] = (clamp(r * 255 + n), clamp(g * 255 + n), clamp(b * 255 + n))
    return img


def main():
    OUT.mkdir(exist_ok=True)
    scene(W, H, lo=0.05, hi=0.95, sat=0.7, seed=1).save(OUT / "landscape.jpg", quality=92)
    scene(W, H, lo=0.55, hi=1.0, sat=0.35, seed=2).save(OUT / "high-key.jpg", quality=92)
    scene(W, H, lo=0.0, hi=0.35, sat=0.6, seed=3).save(OUT / "low-key.jpg", quality=92)
    scene(W, H, lo=0.15, hi=0.9, sat=1.0, seed=4).save(OUT / "saturated.png")

    # Portrait: pixels stored landscape, EXIF Orientation 6 (rotate 90° clockwise to display).
    portrait = scene(H, W, lo=0.1, hi=0.9, sat=0.5, seed=5).rotate(90, expand=True)
    exif = Image.Exif()
    exif[0x0112] = 6
    portrait.save(OUT / "portrait.jpg", quality=92, exif=exif.tobytes())

    # PNG with alpha: transparent corners, half-transparent ring.
    rgba = scene(W, H, lo=0.1, hi=0.9, sat=0.6, seed=6).convert("RGBA")
    px = rgba.load()
    for y in range(H):
        for x in range(W):
            d = math.hypot((x - W / 2) / (W / 2), (y - H / 2) / (H / 2))
            a = 255 if d < 0.8 else 128 if d < 0.95 else 0
            r, g, b, _ = px[x, y]
            px[x, y] = (r, g, b, a)
    rgba.save(OUT / "alpha.png")

    # Adobe RGB (1998) tagged JPEG: the decoder must convert to sRGB through the profile.
    icc = Path("/usr/share/color/icc/colord/AdobeRGB1998.icc")
    if icc.exists():
        scene(W, H, lo=0.1, hi=0.9, sat=0.9, seed=7).save(
            OUT / "adobe-rgb.jpg", quality=95, icc_profile=icc.read_bytes()
        )


if __name__ == "__main__":
    main()
