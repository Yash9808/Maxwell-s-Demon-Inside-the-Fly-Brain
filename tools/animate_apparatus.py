#!/usr/bin/env python3
"""Create a looping, timestamped GIF from the session's apparatus screenshots.

This animates the original ExpImage_t...jpg series in acquisition-time order.
It is a visualization of recorded screenshots, not a 3D reconstruction.

Example:
  python tools/animate_apparatus.py \
    --image-dir "C:/.../fly_session_2026-10-01T20-31-33" \
    --output "C:/.../nature_figures_2026-10-01/apparatus_session.gif"
"""
from __future__ import annotations

import argparse
import math
import re
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

TIME_RE = re.compile(r"ExpImage_t([0-9]+(?:\.[0-9]+)?)s\.jpe?g$", re.IGNORECASE)


def list_frames(image_dir: Path) -> list[tuple[float, Path]]:
    frames = []
    for path in image_dir.glob("ExpImage_t*.jpg"):
        match = TIME_RE.search(path.name)
        if match:
            frames.append((float(match.group(1)), path))
    return sorted(frames, key=lambda item: item[0])


def load_font(size: int) -> ImageFont.ImageFont:
    for name in ("arial.ttf", "DejaVuSans.ttf", "LiberationSans-Regular.ttf"):
        try:
            return ImageFont.truetype(name, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def prepare_frame(path: Path, timestamp: float, index: int, count: int,
                  size: tuple[int, int]) -> Image.Image:
    with Image.open(path) as source:
        image = source.convert("RGB")
        image.thumbnail(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", size, "white")
    canvas.paste(image, ((size[0] - image.width) // 2, (size[1] - image.height) // 2))
    draw = ImageDraw.Draw(canvas, "RGBA")
    band_h = max(34, size[1] // 24)
    draw.rectangle((0, 0, size[0], band_h), fill=(15, 24, 38, 220))
    draw.text((max(10, size[0] // 70), max(5, band_h // 5)),
              f"APPARATUS  |  {timestamp:.2f} s",
              font=load_font(max(14, size[0] // 48)), fill=(255, 255, 255, 255))
    margin = max(10, size[0] // 70)
    bar_y = size[1] - max(8, size[1] // 120)
    bar_h = max(4, size[1] // 250)
    x_end = size[0] - margin
    draw.rectangle((margin, bar_y, x_end, bar_y + bar_h), fill=(25, 38, 52, 190))
    fill_end = margin + round((x_end - margin) * index / max(count - 1, 1))
    if fill_end > margin:
        draw.rectangle((margin, bar_y, fill_end, bar_y + bar_h),
                       fill=(48, 184, 151, 255))
    return canvas


def shared_palette(frames: list[Image.Image]) -> Image.Image:
    """Quantize every frame against one palette to reduce color flicker."""
    thumb = 96
    columns = 12
    rows = math.ceil(len(frames) / columns)
    sheet = Image.new("RGB", (columns * thumb, rows * thumb + 48), "white")
    for i, frame in enumerate(frames):
        sample = frame.copy()
        sample.thumbnail((thumb, thumb), Image.Resampling.BILINEAR)
        x, y = (i % columns) * thumb, (i // columns) * thumb
        sheet.paste(sample, (x, y))
    draw = ImageDraw.Draw(sheet)
    for i, color in enumerate(((15, 24, 38), (255, 255, 255), (48, 184, 151), (220, 225, 232))):
        x0 = i * sheet.width // 4
        x1 = (i + 1) * sheet.width // 4 - 1
        draw.rectangle((x0, rows * thumb, x1, rows * thumb + 47), fill=color)
    return sheet.quantize(colors=256, method=Image.Quantize.MEDIANCUT)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image-dir", type=Path, required=True,
                        help="directory containing ExpImage_t...jpg files")
    parser.add_argument("--output", type=Path, required=True, help="output GIF path")
    parser.add_argument("--duration-ms", type=int, default=110,
                        help="duration per frame in milliseconds (default: 110)")
    parser.add_argument("--max-width", type=int, default=960,
                        help="maximum GIF width in pixels (default: 960)")
    args = parser.parse_args()
    if not args.image_dir.is_dir():
        raise SystemExit(f"missing image directory: {args.image_dir}")
    frames = list_frames(args.image_dir)
    if len(frames) < 2:
        raise SystemExit(f"need at least two timestamped ExpImage JPEGs; found {len(frames)}")
    if args.duration_ms < 20 or args.max_width < 100:
        raise SystemExit("duration must be >=20 ms and max width must be >=100 px")

    with Image.open(frames[0][1]) as first:
        width = min(args.max_width, first.width)
        height = max(1, round(first.height * width / first.width))
    size = (width, height)
    rgb_frames = [prepare_frame(path, timestamp, i, len(frames), size)
                  for i, (timestamp, path) in enumerate(frames)]
    palette = shared_palette(rgb_frames)
    pal_frames = [frame.quantize(palette=palette, dither=Image.Dither.FLOYDSTEINBERG)
                  for frame in rgb_frames]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    pal_frames[0].save(args.output, format="GIF", save_all=True,
                       append_images=pal_frames[1:], duration=args.duration_ms,
                       loop=0, optimize=False, disposal=2)
    print(f"Wrote {args.output}")
    print(f"Frames: {len(frames)} ({frames[0][0]:.2f}–{frames[-1][0]:.2f} s); "
          f"{width}×{height} px; {args.duration_ms} ms/frame; looping GIF")
    print("Frames are original timestamped apparatus screenshots; no color-based activity filter is applied.")


if __name__ == "__main__":
    main()
