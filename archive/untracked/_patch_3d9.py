# -*- coding: utf-8 -*-
"""Patch 9: move the open-live-plots button directly under "run all six"."""
P = "fly_demon_3d.html"
data = open(P, "rb").read()

def rep(old, new, tag):
    global data
    nb = data.count(old)
    assert nb == 1, f"[{tag}] expected 1 occurrence, found {nb}"
    data = data.replace(old, new)
    print("patched:", tag)

# 1) remove the button row from its current spot below the E8 card
plots_row = (
    '        <div class="row" style="margin-top:6px">\n'
    '      <button id="btnOpenPlots" style="flex:1">\U0001F4C8 Open live plots (maximize)</button>\n'
    '    </div>\n'
).encode("utf-8")
rep(plots_row, b"", "remove-old-spot")

# 2) re-insert it right after the run-all-six row (indent normalized to 6 spaces)
run_all = (
    '      <button id="btnRunAllSix" title="Queue E2-E5, E7, E8 in one session; '
    'the six-brain figure animates panel-by-panel in the plots window">'
    '\u25b6\u25b6 run all six \u00b7 animate figure</button>\n'
    '    </div>\n'
).encode("utf-8")
rep(
    run_all,
    run_all + plots_row.replace(b'        <div class="row"', b'      <div class="row"'),
    "insert-under-run-all-six")

open(P, "wb").write(data)

import re
m = re.search(rb"<script>\r?\n(.*?)</script>", data, re.S)
assert m
open("_check_3d9.js", "wb").write(m.group(1))
print("OK")
