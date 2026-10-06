# Image fixtures (`crates/oel-img`)

Synthetic and deterministic: `python3 fixtures/img/src/make_fixtures.py` (Pillow) regenerates them.
Each picture has a sky gradient, eight hue patches (one per HSL band) and a textured ground.

| File | Case |
| --- | --- |
| `landscape.jpg` | full tonal range, moderate saturation |
| `portrait.jpg` | stored landscape with EXIF Orientation 6 (decodes to 160 × 240) |
| `high-key.jpg` | bright, low saturation (vibrance, dehaze) |
| `low-key.jpg` | dark (shadows, blacks) |
| `saturated.png` | fully saturated patches (saturation, HSL mixer) |
| `alpha.png` | transparent corners, half-transparent ring |
| `adobe-rgb.jpg` | embedded Adobe RGB (1998) profile (colord), converted to sRGB on decode |
