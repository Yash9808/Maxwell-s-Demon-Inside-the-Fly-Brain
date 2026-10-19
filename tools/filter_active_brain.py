#!/usr/bin/env python3
"""Suppress blue/low-saturation pixels to make colored brain activity easier to see.

Example:
  python tools/filter_active_brain.py \
    --montage "C:/.../fig05_brain_montage.png" \
    --frame "C:/.../FlyImage_t618.94s.jpg" \
    --output-dir "C:/.../nature_figures_2026-10-01"

Original images are never modified. Pixels with blue/purple hue or low
saturation become white; colorful non-blue pixels remain in their original
colors. This is a visual color filter, not an independent neural-activity
measurement or validated active/silent classifier.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image


def suppress_blue(image_path: Path, output_path: Path,
                  silhouette_alpha: int = 0) -> tuple[int, int, int]:
    with Image.open(image_path) as source:
        rgb_image = source.convert("RGB")
        rgb = np.asarray(rgb_image, dtype=np.uint8)
        hsv = np.asarray(rgb_image.convert("HSV"), dtype=np.uint8)

    hue = hsv[:, :, 0].astype(np.int16)  # Pillow hue range: 0..255
    saturation = hsv[:, :, 1]
    value = hsv[:, :, 2]
    luminance = (0.2126 * rgb[:, :, 0] + 0.7152 * rgb[:, :, 1] +
                 0.0722 * rgb[:, :, 2])

    # Retain saturated non-blue colors (warm activity marks and any other
    # distinct non-blue colors) plus dark labels/annotations; whiten blue,
    # gray, and near-background pixels for a clean white-field presentation.
    blue_hue = (hue >= 135) & (hue <= 195)
    colorful_nonblue = (saturation >= 55) & (value >= 55) & ~blue_hue
    dark_annotation = luminance < 68
    keep = colorful_nonblue | dark_annotation

    result = np.full_like(rgb, 255)
    if silhouette_alpha > 0:
        # Preserve a faint positional outline from suppressed blue regions so
        # the filtered activity remains anatomically recognizable.
        silhouette = (blue_hue & (saturation >= 55)) | (saturation < 55)
        tint = np.array([194, 204, 215], dtype=np.float32)
        alpha = silhouette_alpha / 255.0
        base = rgb.astype(np.float32)
        faded = np.clip(base * alpha + tint * (1.0 - alpha), 0, 255).astype(np.uint8)
        result[silhouette] = faded[silhouette]
    result[keep] = rgb[keep]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(result, mode="RGB").save(output_path, format="PNG", optimize=True)
    return int(keep.sum()), int(keep.size), int((blue_hue & (saturation >= 55)).sum())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--montage", type=Path, required=True,
                        help="brain montage PNG to filter")
    parser.add_argument("--frame", type=Path,
                        help="optional full-resolution timestamped FlyImage to filter")
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()

    if not args.montage.is_file():
        raise SystemExit(f"missing montage: {args.montage}")
    if args.frame is not None and not args.frame.is_file():
        raise SystemExit(f"missing image frame: {args.frame}")

    outputs = [
        (args.montage, args.output_dir / "fig05_brain_active_only.png", 0),
        (args.montage, args.output_dir / "fig05_brain_active_highlighted.png", 78),
    ]
    if args.frame is not None:
        outputs.extend([
            (args.frame, args.output_dir / f"{args.frame.stem}_active_only.png", 0),
            (args.frame, args.output_dir / f"{args.frame.stem}_active_highlighted.png", 78),
        ])

    for source, destination, silhouette in outputs:
        kept, total, blue = suppress_blue(source, destination, silhouette)
        description = "faint silhouette" if silhouette else "white background"
        print(f"wrote {destination} ({description}) | retained {kept:,}/{total:,} pixels "
              f"({100 * kept / total:.1f}%), suppressed saturated blue {blue:,}")


if __name__ == "__main__":
    main()
