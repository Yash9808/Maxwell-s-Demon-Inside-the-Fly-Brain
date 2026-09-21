# -*- coding: utf-8 -*-
"""Patch 13: hero animation in the center badge — bigger, no spin, real motion."""
P = "fly_demon_3d.html"
data = open(P, "rb").read()

def rep(old, new, tag):
    global data
    nb = data.count(old)
    assert nb == 1, f"[{tag}] expected 1 occurrence, found {nb}"
    data = data.replace(old, new)
    print("patched:", tag)

CRLF = b"\r\n"
NEW = "Maxwell's Demon: Inside the Fly Brain".encode("utf-8")

# 1) stop the CSS spin (it masked the real animation) + enlarge the badge
rep(b"                 animation:brandSpin 12s linear infinite;" + CRLF,
    b"",
    "remove-spin")

rep(b"  #brandCenter { margin-left:clamp(20px, 6vw, 120px); width:38px; height:38px;",
    b"  #brandCenter { margin-left:clamp(20px, 6vw, 120px); width:64px; height:64px;",
    "badge-size")

rep(b"  @keyframes brandSpin { from { rotate:0deg; } to { rotate:360deg; } }" + CRLF,
    b"",
    "remove-keyframes")

# 2) swap the embedded static-ish webp for the hero animation file
tag = b'  <img id="brandCenter" '
start = data.find(tag)
assert start != -1, "brandCenter <img> not found"
end = data.find(b">\r\n", start)
assert end != -1, "brandCenter <img> end not found"
old_len = end + 3 - start

new_el = ('  <img id="brandCenter" src="brand_animation/brand_animation_hero.webp" '
          'alt="' + NEW.decode() + '" '
          'title="' + NEW.decode() + ' \u2014 click to send a message">\r\n').encode("utf-8")
data = data[:start] + new_el + data[end + 3:]
print(f"patched: hero-anim-src (replaced {old_len} bytes with {len(new_el)} bytes)")

open(P, "wb").write(data)

import re
m = re.search(rb"<script>\r?\n(.*?)</script>", data, re.S)
assert m
open("_check_3d13.js", "wb").write(m.group(1))
print("OK")
