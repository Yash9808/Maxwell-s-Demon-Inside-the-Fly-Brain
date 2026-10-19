#!/usr/bin/env python3
"""Animate the timestamped fly-brain views with a progressive blue fade.

The blue fade is a visual effect applied by capture time, not a measurement of
neural activity. Non-blue image colors are retained for easier comparison.
Requires Pillow and NumPy (already used by the session figure workflow).

Example:
  python tools/animate_brain_blue_fade.py \
    --image-dir "C:/.../fly_session_2026-10-01T20-31-33" \
    --output "C:/.../nature_figures_2026-10-01/fly_brain_blue_fade.gif"
"""
from __future__ import annotations

import argparse
import math
import re
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

TIME_RE = re.compile(r"FlyImage_t([0-9]+(?:\.[0-9]+)?)s\.jpe?g$", re.IGNORECASE)
BLUE_TARGET = np.array([238, 243, 249], dtype=np.float32)


def list_frames(image_dir: Path) -> list[tuple[float, Path]]:
    frames = []
    for path in image_dir.glob("FlyImage_t*.jpg"):
        match = TIME_RE.search(path.name)
        if match:
            frames.append((float(match.group(1)), path))
    return sorted(frames, key=lambda item: item[0])


def load_font(size: int) -> ImageFont.ImageFont:
    for candidate in ("arial.ttf", "DejaVuSans.ttf", "LiberationSans-Regular.ttf"):
        try:
            return ImageFont.truetype(candidate, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def quantization_palette(frames: list[tuple[float, Path]]) -> Image.Image:
    """Build one stable palette for all frames to minimize GIF color flicker."""
    columns, thumb = 12, 96
    rows = math.ceil(len(frames) / columns)
    sheet = Image.new("RGB", (columns * thumb, rows * thumb + 48), "white")
    draw = ImageDraw.Draw(sheet)
    for idx, (_, path) in enumerate(frames):
        with Image.open(path) as image:
            image = image.convert("RGB")
            image.thumbnail((thumb, thumb), Image.Resampling.BILINEAR)
        x = (idx % columns) * thumb
        y = (idx // columns) * thumb
        sheet.paste(image, (x + (thumb - image.width) // 2,
                            y + (thumb - image.height) // 2))
    # Ensure consistent palette entries for the dark HUD, white type, and fade tint.
    y0 = rows * thumb
    swatches = [(15, 24, 38), (255, 255, 255), tuple(BLUE_TARGET.astype(int)), (245, 115, 45)]
    swatch_w = sheet.width // len(swatches)
    for i, color in enumerate(swatches):
        draw.rectangle((i * swatch_w, y0, (i + 1) * swatch_w - 1, y0 + 47), fill=color)
    return sheet.quantize(colors=256, method=Image.Quantize.MEDIANCUT)


def make_frame(path: Path, timestamp: float, progress: float,
               frame_index: int, frame_count: int, max_width: int) -> Image.Image:
    with Image.open(path) as image:
        rgb_image = image.convert("RGB")
        if rgb_image.width > max_width:
            height = round(rgb_image.height * max_width / rgb_image.width)
            rgb_image = rgb_image.resize((max_width, height), Image.Resampling.LANCZOS)
        rgb = np.asarray(rgb_image, dtype=np.uint8).copy()
        hsv = np.asarray(rgb_image.convert("HSV"), dtype=np.uint8)

    hue = hsv[:, :, 0].astype(np.int16)
    saturation = hsv[:, :, 1]
    value = hsv[:, :, 2]
    # Pillow hue is 0..255; this interval covers blue/cyan blue in the source.
    blue_mask = ((hue >= 130) & (hue <= 195) & (saturation >= 42) & (value >= 55))
    strength = 0.94 * progress
    if blue_mask.any() and strength > 0:
        pixels = rgb[blue_mask].astype(np.float32)
        rgb[blue_mask] = np.clip(pixels * (1.0 - strength) +
                                 BLUE_TARGET * strength, 0, 255).astype(np.uint8)

    result = Image.fromarray(rgb, mode="RGB")
    draw = ImageDraw.Draw(result, "RGBA")
    band_h = max(38, result.height // 23)
    draw.rectangle((0, 0, result.width, band_h), fill=(15, 24, 38, 220))
    font = load_font(max(15, result.width // 48))
    faded_pct = round(strength * 100)
    title = f"FLY BRAIN  |  {timestamp:.1f} s  |  BLUE DIMMING {faded_pct}%"
    draw.text((max(12, result.width // 70), max(6, band_h // 5)), title,
              font=font, fill=(255, 255, 255, 255))

    # A thin acquisition-progress bar makes the first-to-last direction clear.
    bar_y = result.height - max(7, result.height // 145)
    bar_h = max(4, result.height // 260)
    margin = max(12, result.width // 70)
    x_end = result.width - margin
    draw.rectangle((margin, bar_y, x_end, bar_y + bar_h), fill=(25, 38, 52, 180))
    fill_end = margin + round((x_end - margin) * frame_index / max(frame_count - 1, 1))
    if fill_end > margin:
        draw.rectangle((margin, bar_y, fill_end, bar_y + bar_h), fill=(48, 184, 151, 245))
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image-dir", type=Path, required=True,
                        help="directory containing FlyImage_t...jpg files")
    parser.add_argument("--output", type=Path, required=True,
                        help="output animated GIF path")
    parser.add_argument("--duration-ms", type=int, default=110,
                        help="duration per frame in milliseconds (default: 110)")
    parser.add_argument("--max-width", type=int, default=960,
                        help="maximum frame width in pixels (default: 960)")
    args = parser.parse_args()
    if not args.image_dir.is_dir():
        raise SystemExit(f"missing image directory: {args.image_dir}")
    frames = list_frames(args.image_dir)
    if len(frames) < 2:
        raise SystemExit(f"need at least two timestamped FlyImage JPEGs; found {len(frames)}")
    if args.duration_ms < 20:
        raise SystemExit("--duration-ms must be at least 20")

    processed = []
    n = len(frames)
    for index, (timestamp, path) in enumerate(frames):
        # Ease-in-out progression: original colors at frame 1, near-complete
        # blue fade by the final capture, while the other colors stay unchanged.
        p = index / (n - 1)
        eased = p * p * (3.0 - 2.0 * p)
        processed.append(make_frame(path, timestamp, eased, index, n, args.max_width))

    palette = quantization_palette(frames)
    pal_frames = [im.quantize(palette=palette, dither=Image.Dither.FLOYDSTEINBERG)
                  for im in processed]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    pal_frames[0].save(
        args.output,
        format="GIF",
        save_all=True,
        append_images=pal_frames[1:],
        duration=args.duration_ms,
        loop=0,
        optimize=False,
        disposal=2,
    )
    print(f"Wrote {args.output}")
    print(f"Frames: {n} ({frames[0][0]:.2f}–{frames[-1][0]:.2f} s); "
          f"{args.duration_ms} ms/frame; blue fade: 0–94%")
    print("This is a visual blue-pixel fade synchronized to image order, "
          "not a neural activity measurement.")


if __name__ == "__main__":
    main()
