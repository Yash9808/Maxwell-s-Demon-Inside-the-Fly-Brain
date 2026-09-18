# -*- coding: utf-8 -*-
"""
brand_animation/make_brand_animation.py  (v2)

Builds the 4-second 1:1 looping brand animation from the project logo
(icon_image_project.png) WITHOUT redesigning it: every frame applies only
reversible geometric warps + additive glow to the original pixels, and all
motion periods are integer fractions of the 4 s loop, so phase(0) == phase(T)
and the loop is seamless.

The MAIN MOTION is the scene itself:
  * the demon RIDES the fly — bouncing and swaying in the saddle
  * the demon SHAKES THE REINS — a traveling wave runs along the rein line,
    whose two endpoints follow the demon's hands and the fly's neck
  * the fly gallops — body bobbing anti-phase to the rider with a rocking pitch
  * wings flutter, the neon ring breathes
  * camera never moves

Outputs (brand_animation/):
  brand_animation_hero.webp   hero crop: demon-riding-fly fills the frame
                              (this is what the lab page displays, circular via CSS)
  brand_animation.webp        full-frame variant (whole logo incl. ring)
  brand_animation_hero_poster.png / brand_animation_poster.png  first frames
  brand_animation_preview.gif half-size GIF preview of the hero variant
"""
import math
import os

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "icon_image_project.png")
OUT_DIR = os.path.join(ROOT, "brand_animation")
os.makedirs(OUT_DIR, exist_ok=True)

# ---------------------------------------------------------------- constants --
LOOP_SECONDS = 4.0
FPS = 30
N_FRAMES = int(LOOP_SECONDS * FPS)          # 120 frames; frame N == frame 0
SIZE = 512                                  # working size of the full logo
EDGE = 30                                   # bleed margin around the logo
HERO_OUT = 512                              # hero frames are upscaled to this

# Measured anchors in ORIGINAL logo space (1254x1254), from pixel analysis:
A = {
    "demon":  (627.0, 385.0),               # rider body center
    "hands":  (700.0, 520.0),               # demon hands = rein end A
    "neck":   (775.0, 605.0),               # fly neck  = rein end B
    "fly":    (610.0, 700.0),               # fly body center
    "wing":   (395.0, 525.0),               # wing mid
}
SCALE = SIZE / 1254.0                       # logo px -> working px
TO_CANVAS = SCALE                           # then + EDGE when pasting


def anchor(name):
    """Anchor in working-canvas coordinates (512 logo + 30px bleed)."""
    x, y = A[name]
    return np.array([x * SCALE + EDGE, y * SCALE + EDGE], dtype=np.float32)


def body_axis():
    """Unit vector along the fly body (abdomen -> head) in canvas coords."""
    head = np.array([790.0, 690.0]) * SCALE
    abdomen = np.array([430.0, 780.0]) * SCALE
    d = head - abdomen
    return d / np.linalg.norm(d)


# ------------------------------------------------------------------ loading --
def load_canvas():
    """Full logo resized to SIZE, padded by EDGE on all sides. Returns RGBA array."""
    im = Image.open(SRC).convert("RGBA").resize((SIZE, SIZE), Image.LANCZOS)
    canvas = Image.new("RGBA", (SIZE + 2 * EDGE, SIZE + 2 * EDGE), (0, 0, 0, 0))
    canvas.paste(im, (EDGE, EDGE), im)
    return np.asarray(canvas).astype(np.float32)


def hero_box():
    """Square crop (in canvas coords) that frames demon + fly with margin."""
    xs = [A[k][0] * SCALE + EDGE for k in ("demon", "hands", "neck", "fly", "wing")]
    ys = [A[k][1] * SCALE + EDGE for k in ("demon", "hands", "neck", "fly", "wing")]
    x0, x1 = min(xs) - 55, max(xs) + 55
    y0, y1 = min(ys) - 55, max(ys) + 55
    side = max(x1 - x0, y1 - y0)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    x0, y0 = cx - side / 2, cy - side / 2
    m = 12                                   # keep away from canvas edges
    x0 = min(max(x0, m), SIZE + 2 * EDGE - m - side)
    y0 = min(max(y0, m), SIZE + 2 * EDGE - m - side)
    return x0, y0, side


# --------------------------------------------------------------- warp utils --
def remap(a, xs, ys):
    """Bilinear sample of HxWxC array a at float coordinate fields."""
    H, W = a.shape[:2]
    x0 = np.clip(np.floor(xs).astype(np.int32), 0, W - 1)
    y0 = np.clip(np.floor(ys).astype(np.int32), 0, H - 1)
    x1 = np.clip(x0 + 1, 0, W - 1)
    y1 = np.clip(y0 + 1, 0, H - 1)
    fx = np.clip(xs - x0, 0.0, 1.0)[..., None]
    fy = np.clip(ys - y0, 0.0, 1.0)[..., None]
    top = a[y0, x0] * (1 - fx) + a[y0, x1] * fx
    bot = a[y1, x0] * (1 - fx) + a[y1, x1] * fx
    return top * (1 - fy) + bot * fy


def grid(H, W):
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    return xx, yy


def gauss(px, py, cx, cy, sx, sy):
    return np.exp(-(((px - cx) / sx) ** 2 + ((py - cy) / sy) ** 2) / 2)


def dist_to_seg(xx, yy, ax, ay, bx, by):
    """Distance field from points (xx,yy) to segment A-B, plus param s in [0,1]."""
    abx, aby = bx - ax, by - ay
    ab2 = abx * abx + aby * aby
    s = ((xx - ax) * abx + (yy - ay) * aby) / ab2
    s = np.clip(s, 0.0, 1.0)
    dx = xx - (ax + s * abx)
    dy = yy - (ay + s * aby)
    return np.hypot(dx, dy), s


# ------------------------------------------------------------------- motion --
def wing_pass(rgb, alpha, t, amp):
    """Wing flutter: vertical stretch centered on the wing, strongest at tips."""
    H, W = alpha.shape[:2]
    xx, yy = grid(H, W)
    wx, wy = anchor("wing")
    m = gauss(xx, yy, wx, wy, 100, 52)
    s = amp * 0.045 * math.sin(2 * math.pi * 4 * t / LOOP_SECONDS) * m   # 4 beats / loop
    sy = wy + (yy - wy) * (1.0 + s)
    sx = xx + 0.30 * s * (xx - wx)
    return remap(rgb, sx, sy), remap(alpha, sx, sy)


def ride_field(t, amp):
    """Displacement fields (dx, dy) for the whole riding scene.

    demon: bounces +-8px, sways +-3.5px, leans in the saddle
    fly:   bobs anti-phase +-5px with a rocking gallop along its body axis
    reins: traveling wave (3 flicks per loop) along the rein segment whose
           endpoints ride along with the demon's hands and the fly's neck
    """
    H = W = SIZE + 2 * EDGE
    xx, yy = grid(H, W)
    w = 2 * math.pi * (t / LOOP_SECONDS)

    dem = anchor("demon")
    fly = anchor("fly")
    u = body_axis()                                   # fly body axis (abdomen->head)

    # --- demon bounce + sway + lean (2 bounces per loop)
    bounce = math.sin(2 * w)                          # k=2
    sway = math.cos(2 * w)
    fall_d = gauss(xx, yy, dem[0], dem[1], 62, 58)
    dx_d = (3.5 * sway) * fall_d
    dy_d = (8.0 * bounce + 2.5 * sway * (xx - dem[0]) / 70.0) * fall_d

    # --- fly bob (anti-phase) + rocking gallop along the body axis
    fall_f = gauss(xx, yy, fly[0], fly[1], 135, 88)
    along = ((xx - fly[0]) * u[0] + (yy - fly[1]) * u[1]) / 120.0
    dx_f = (2.0 * sway) * fall_f
    dy_f = (-5.0 * bounce + 3.5 * math.sin(2 * w + math.pi / 2) * along) * fall_f

    # --- reins: endpoints follow their movers, then a wave travels along
    hands = anchor("hands") + np.array([dx_d[np.int32(round(anchor("hands")[1])),
                                               np.int32(round(anchor("hands")[0]))],
                                        dy_d[np.int32(round(anchor("hands")[1])),
                                             np.int32(round(anchor("hands")[0]))]])
    neck = anchor("neck") + np.array([dx_f[np.int32(round(anchor("neck")[1])),
                                           np.int32(round(anchor("neck")[0]))],
                                      dy_f[np.int32(round(anchor("neck")[1])),
                                           np.int32(round(anchor("neck")[0]))]])
    d, s = dist_to_seg(xx, yy, hands[0], hands[1], neck[0], neck[1])
    ribbon = np.exp(-(d / 20.0) ** 2) * amp
    ph = 3 * w - 4 * math.pi * s                   # k=3 flicks, traveling A->B
    dx_r = 2.0 * np.sin(ph) * ribbon
    dy_r = 7.0 * np.cos(ph) * ribbon

    return dx_d + dx_f + dx_r, dy_d + dy_f + dy_r


def neon_sheen(rgb, t, amp):
    """Soft sheen rotating once per loop inside the ring annulus (adds light)."""
    H, W = rgb.shape[:2]
    xx, yy = grid(H, W)
    cx, cy = W / 2.0, H / 2.0
    rr = np.hypot(xx - cx, yy - cy) / (W / 2.0)
    band = np.exp(-((rr - 0.30) / 0.06) ** 2)
    ang = np.arctan2(yy - cy, xx - cx)
    sweep = 0.5 + 0.5 * np.cos(ang - 2 * math.pi * (t / LOOP_SECONDS))
    env = 0.5 - 0.5 * math.cos(2 * math.pi * (t / LOOP_SECONDS))
    glow = (band * (0.10 + 0.13 * sweep) * env)[..., None] * amp
    warm = np.array([255, 220, 170], dtype=np.float32) / 255.0
    denom = np.maximum(rgb.max(axis=-1, keepdims=True), 1e-6)
    return np.clip(rgb + (warm - rgb / denom) * glow * 0.35, 0, 255)


def render_frame(base, t, box, amp):
    x0, y0, side = box
    rgb, alpha = base
    rgb1, a1 = wing_pass(rgb, alpha, t, amp)
    dx, dy = ride_field(t, amp)
    H, W = alpha.shape[:2]
    xx, yy = grid(H, W)
    rgb2 = remap(rgb1, xx - dx, yy - dy)
    a2 = remap(alpha, xx - dx, yy - dy)
    rgb3 = neon_sheen(rgb2, t, amp * 0.6)
    frame = np.dstack([rgb3, a2[..., 0] * 255.0]).astype(np.uint8)
    im = Image.fromarray(frame, "RGBA").crop(
        (int(round(x0)), int(round(y0)),
         int(round(x0 + side)), int(round(y0 + side))))
    if im.width != HERO_OUT:
        im = im.resize((HERO_OUT, HERO_OUT), Image.LANCZOS)
    return im


# -------------------------------------------------------------------- main ---
def main():
    arr = load_canvas()
    base = (arr[..., :3].copy(), arr[..., 3:4] / 255.0)
    box = hero_box()
    print("hero crop:", tuple(round(v, 1) for v in box), "of canvas",
          SIZE + 2 * EDGE)

    frames_hero, frames_full = [], []
    for i in range(N_FRAMES):
        t = LOOP_SECONDS * i / N_FRAMES
        frames_hero.append(render_frame(base, t, box, amp=1.0))
        frames_full.append(render_frame(base, t, (EDGE, EDGE, SIZE), amp=0.55))
        if i % 30 == 0:
            print(f"  frame {i}/{N_FRAMES}")

    hp = os.path.join(OUT_DIR, "brand_animation_hero.webp")
    frames_hero[0].save(hp, save_all=True, append_images=frames_hero[1:],
                        duration=int(1000 / FPS), loop=0, quality=72, method=5)
    print("wrote", hp, os.path.getsize(hp), "bytes")

    fp = os.path.join(OUT_DIR, "brand_animation.webp")
    frames_full[0].save(fp, save_all=True, append_images=frames_full[1:],
                        duration=int(1000 / FPS), loop=0, quality=70, method=5)
    print("wrote", fp, os.path.getsize(fp), "bytes")

    frames_hero[0].save(os.path.join(OUT_DIR, "brand_animation_hero_poster.png"))
    frames_full[0].save(os.path.join(OUT_DIR, "brand_animation_poster.png"))
    circle = frames_hero[0].copy()
    mask = Image.new("L", circle.size, 0)
    ImageDraw.Draw(mask).ellipse((0, 0, circle.width, circle.height), fill=255)
    circle.putalpha(mask)
    circle.save(os.path.join(OUT_DIR, "brand_animation_hero_poster_circle.png"))

    small = [f.resize((256, 256), Image.LANCZOS) for f in frames_hero]
    gp = os.path.join(OUT_DIR, "brand_animation_preview.gif")
    small[0].save(gp, save_all=True, append_images=small[1:],
                  duration=int(1000 / FPS), loop=0)
    print("wrote", gp, os.path.getsize(gp), "bytes")


if __name__ == "__main__":
    main()
