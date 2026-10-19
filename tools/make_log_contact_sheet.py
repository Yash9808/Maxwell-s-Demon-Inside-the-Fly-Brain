#!/usr/bin/env python3
"""Contact-sheet builder: LOG session plot series -> one animated GIF / MP4.

Assembles the PlotFlyPath_*.jpg (FLY MOVEMENT trajectory) and
PlotBrainMap_*.jpg (FLY BRAIN FIRING MAP) time series that the app's LOG
button records into a single side-by-side animation: fly path | brain map
over time, with a header strip showing session + timestamp.

Usage:
  python tools/make_log_contact_sheet.py <fly_session_*.zip | session_folder>
  python tools/make_log_contact_sheet.py                # newest zip in ./ or ./logs
  python tools/make_log_contact_sheet.py session.zip --format gif,mp4 --fps 4

Input comes straight from the LOG zip — no extraction needed (a folder with
the extracted session also works). Frames are paired by their t<row>s tag;
a missing partner renders as a neutral placeholder so the timeline stays
aligned. Only PIL (+ imageio for MP4, which bundles its own ffmpeg) —
no system dependencies.

Output (next to the input unless -o):
  <name>_contact_sheet.gif   and/or   .mp4
"""
import argparse, glob, io, os, re, sys, time, zipfile

import numpy as np
from PIL import Image, ImageDraw, ImageFont

TAG_RE = re.compile(r"^PlotFlyPath_t([\d.]+)s\.(jpg|png)$")
TAG_BRAIN_RE = re.compile(r"^PlotBrainMap_t([\d.]+)s\.(jpg|png)$")
GUTTER = 10
HEADER = 34


def find_input(args):
    if args.input:
        return args.input
    cands = sorted(glob.glob("fly_session_*.zip") + glob.glob("logs/fly_session_*.zip")
                   + glob.glob("logs/*.zip"), key=os.path.getmtime)
    if not cands:
        sys.exit("no fly_session_*.zip found — pass one: python tools/"
                 "make_log_contact_sheet.py <zip>")
    return cands[-1]


def collect_images(src):
    """-> {t: {"fly": PIL.Image|None, "brain": PIL.Image|None}, session_name}

    Reads PlotFlyPath_t*.jpg / PlotBrainMap_t*.jpg from a zip or folder and
    pairs them by their timestamp tag."""
    out, name = {}, None
    if os.path.isdir(src):
        name = os.path.basename(os.path.normpath(src))
        for p in glob.glob(os.path.join(src, "PlotFlyPath_*")):
            m = TAG_RE.match(os.path.basename(p))
            if m:
                out.setdefault(float(m.group(1)), {})["fly"] = Image.open(p).convert("RGB")
        for p in glob.glob(os.path.join(src, "PlotBrainMap_*")):
            m = TAG_BRAIN_RE.match(os.path.basename(p))
            if m:
                out.setdefault(float(m.group(1)), {})["brain"] = Image.open(p).convert("RGB")
    else:
        with zipfile.ZipFile(src) as z:
            name = os.path.basename(src).replace(".zip", "")
            for info in z.infolist():
                base = os.path.basename(info.filename)
                m = TAG_RE.match(base)
                if m:
                    out.setdefault(float(m.group(1)), {})["fly"] = \
                        Image.open(io.BytesIO(z.read(info))).convert("RGB")
                    continue
                m = TAG_BRAIN_RE.match(base)
                if m:
                    out.setdefault(float(m.group(1)), {})["brain"] = \
                        Image.open(io.BytesIO(z.read(info))).convert("RGB")
    return out, name


def placeholder(w, h, text):
    img = Image.new("RGB", (w, h), (244, 246, 250))
    d = ImageDraw.Draw(img)
    d.text((w // 2, h // 2), text, fill=(150, 158, 170), anchor="mm", font=FONT)
    return img


def fit(img, h):
    w = max(1, round(img.width * h / img.height))
    return img.resize((w, h), Image.LANCZOS)


def build_frame(fly, brain, H, header_text):
    fw = max(1, round(fly.width * H / fly.height)) if fly else H
    bw = max(1, round(brain.width * H / brain.height)) if brain else H
    W = GUTTER + fw + GUTTER + bw + GUTTER
    frame = Image.new("RGB", (W, HEADER + H + GUTTER), (255, 255, 255))
    d = ImageDraw.Draw(frame)
    d.text((GUTTER, 7), header_text, fill=(20, 26, 38), font=FONT)
    y = HEADER
    if fly:
        frame.paste(fit(fly, H), (GUTTER, y))
    else:
        frame.paste(placeholder(fw, H, "no fly-path frame"), (GUTTER, y))
    d.rectangle([GUTTER - 1, y - 1, GUTTER + fw, y + H], outline=(210, 216, 226))
    x2 = GUTTER + fw + GUTTER
    if brain:
        frame.paste(fit(brain, H), (x2, y))
    else:
        frame.paste(placeholder(bw, H, "no brain-map frame"), (x2, y))
    d.rectangle([x2 - 1, y - 1, x2 + bw, y + H], outline=(210, 216, 226))
    return frame


def even(img_pil):
    w, h = img_pil.size
    return img_pil.crop((0, 0, w - (w % 2), h - (h % 2)))


def main():
    global FONT
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[1],
                                 epilog="frames come from the LOG plot series "
                                 "(PlotFlyPath_* / PlotBrainMap_*, 5 s cadence)")
    ap.add_argument("input", nargs="?", help="fly_session_*.zip or extracted folder")
    ap.add_argument("-o", "--out", help="output path prefix (default: beside input)")
    ap.add_argument("--format", default="gif", help="gif, mp4 or gif,mp4 (default gif)")
    ap.add_argument("--fps", type=float, default=2.0,
                    help="animation fps (frames are 5 s apart live; 2 fps = 2.5x speed)")
    ap.add_argument("--height", type=int, default=440, help="panel height in px")
    ap.add_argument("--max-frames", type=int, default=400, help="safety cap")
    args = ap.parse_args()

    try:
        FONT = ImageFont.truetype("segoeui.ttf", 15)
    except Exception:
        try:
            FONT = ImageFont.truetype("arial.ttf", 15)
        except Exception:
            FONT = ImageFont.load_default()

    src = find_input(args)
    print("input:", src)
    series, name = collect_images(src)
    if not series:
        sys.exit("no PlotFlyPath_*/PlotBrainMap_* frames in " + src +
                 " — this session predates the plot series (LOG feature)")
    ts = sorted(series)
    if len(ts) > args.max_frames:
        step = len(ts) / args.max_frames
        ts = [ts[round(i * step)] for i in range(args.max_frames)]
    n_fly = sum(1 for t in ts if series[t].get("fly"))
    n_brain = sum(1 for t in ts if series[t].get("brain"))
    print(f"frames: {len(ts)} (fly-path {n_fly}, brain-map {n_brain}, "
          f"t = {ts[0]:.2f}s .. {ts[-1]:.2f}s)")

    frames = []
    for i, t in enumerate(ts):
        pair = series[t]
        hdr = (f"{name}   t = {t:6.2f} s   frame {i + 1}/{len(ts)}      "
               f"FLY MOVEMENT (trajectory)  |  FLY BRAIN FIRING MAP")
        frames.append(build_frame(pair.get("fly"), pair.get("brain"),
                                  args.height, hdr))

    prefix = args.out or (os.path.splitext(src)[0] if os.path.isfile(src)
                          else os.path.join(os.path.dirname(os.path.normpath(src)), name))
    fmts = [f.strip().lower() for f in args.format.split(",")]
    made = []
    dur = int(1000 / max(0.1, args.fps))

    if "gif" in fmts:
        out = prefix + "_contact_sheet.gif"
        frames[0].save(out, save_all=True, append_images=frames[1:],
                       duration=dur, loop=0, optimize=True)
        made.append(out)
    if "mp4" in fmts:
        out = prefix + "_contact_sheet.mp4"
        try:
            import imageio.v2 as iio
            frames_even = [even(f) for f in frames]
            with iio.get_writer(out, fps=args.fps, codec="libx264",
                                quality=8, pixelformat="yuv420p") as w:
                for f in frames_even:
                    w.append_data(np.asarray(f))
            made.append(out)
        except Exception as e:
            print(f"  MP4 skipped ({e}) — GIF still written" if "gif" in fmts
                  else f"MP4 failed: {e}")

    for out in made:
        print(f"  wrote {out}  ({os.path.getsize(out) // 1024} KB, "
              f"{len(frames)} frames, {len(frames) / args.fps:.1f} s at {args.fps} fps)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
