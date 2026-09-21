# -*- coding: utf-8 -*-
"""Patch 11: replace the center brand <img> with the circular looping animation."""
P = "fly_demon_3d.html"
data = open(P, "rb").read()

def rep(old, new, tag):
    global data
    nb = data.count(old)
    assert nb == 1, f"[{tag}] expected 1 occurrence, found {nb}"
    data = data.replace(old, new)
    print("patched:", tag)

CRLF = b"\r\n"

# 1) CSS: circular clip + slow spin. Uses the standalone `rotate` property so
#    the hover `transform: scale(...)` no longer clobbers the rotation.
old_css = (
    b"  #brandCenter { margin-left:clamp(20px, 6vw, 120px); width:34px; height:34px;" + CRLF +
    b"                 border-radius:8px; object-fit:cover; border:1px solid var(--line);" + CRLF +
    b"                 background:#0a0f18; cursor:pointer;" + CRLF +
    b"                 animation:brandFloat 3.2s ease-in-out infinite;" + CRLF +
    b"                 transition:box-shadow .2s, transform .2s; }" + CRLF +
    b"  #brandCenter:hover { animation-play-state:paused; box-shadow:0 0 18px #3b82f6aa;" + CRLF +
    b"                       transform:scale(1.06); }"
)
new_css = (
    b"  #brandCenter { margin-left:clamp(20px, 6vw, 120px); width:38px; height:38px;" + CRLF +
    b"                 border-radius:50%; object-fit:cover; border:1px solid var(--line);" + CRLF +
    b"                 background:#0a0f18; cursor:pointer;" + CRLF +
    b"                 animation:brandSpin 12s linear infinite;" + CRLF +
    b"                 transition:box-shadow .2s, rotate .2s; }" + CRLF +
    b"  #brandCenter:hover { animation-play-state:paused; box-shadow:0 0 18px #3b82f6aa;" + CRLF +
    b"                       transform:scale(1.06); }"
)
rep(old_css, new_css, "css-center-circular")

old_kf = (
    b"  @keyframes brandFloat { 0%,100% { transform:translateY(0) rotate(0deg); }" + CRLF +
    b"                          25% { transform:translateY(-3px) rotate(-2deg); }" + CRLF +
    b"                          50% { transform:translateY(0) rotate(0deg); }" + CRLF +
    b"                          75% { transform:translateY(-2px) rotate(2deg); } }"
)
new_kf = b"  @keyframes brandSpin { from { rotate:0deg; } to { rotate:360deg; } }"
rep(old_kf, new_kf, "css-spin-keyframes")

# 2) replace the whole <img id="brandCenter" ...> element (index-based splice,
#    robust regardless of how long the embedded data URI is).
tag = b'  <img id="brandCenter" '
start = data.find(tag)
assert start != -1, "brandCenter <img> not found"
end = data.find(b">\r\n", start)
assert end != -1, "brandCenter <img> end not found"
old_len = end + 3 - start

new_el = ('  <img id="brandCenter" src="brand_animation/brand_animation.webp" '
          'alt="Maxwell Demon Lab" '
          'title="Maxwell Demon Lab \u2014 click to send a message">\r\n').encode("utf-8")
data = data[:start] + new_el + data[end + 3:]
print(f"patched: center-anim-src (replaced {old_len} bytes with {len(new_el)} bytes)")

# 3) embed the animated webp as base64, keeping the lab single-file portable.
B64 = open("brand_animation/_brand_animation_webp.b64", "rb").read().strip()
WEBP = b"data:image/webp;base64," + B64
marker = b'"brand_animation/brand_animation.webp"'
assert data.count(marker) == 1, "path-src marker not found exactly once"
data = data.replace(marker, b'"' + WEBP + b'"', 1)
print(f"patched: embedded animated webp ({len(WEBP)} byte src)")

open(P, "wb").write(data)
print("OK")
