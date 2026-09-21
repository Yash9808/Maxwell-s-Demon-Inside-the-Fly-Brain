# -*- coding: utf-8 -*-
"""Patch 12: rename header/title/tooltips/contact copy to the new lab name."""
P = "fly_demon_3d.html"
data = open(P, "rb").read()

def rep(old, new, tag):
    global data
    nb = data.count(old)
    assert nb == 1, f"[{tag}] expected 1 occurrence, found {nb}"
    data = data.replace(old, new)
    print("patched:", tag)

DASH = "\u2014".encode("utf-8")
NEW = "Maxwell's Demon: Inside the Fly Brain".encode("utf-8")

# 1) tab title
rep(b"<title>Maxwell Demon Lab 3D " + DASH +
    b" real fly brain (FAFB v783 / MCNS)</title>",
    b"<title>" + NEW + b" " + DASH +
    b" real fly brain (FAFB v783 / MCNS)</title>",
    "tab-title")

# 2) corner logo alt + tooltip
rep(b'alt="Maxwell Demon Lab" title="Maxwell Demon Lab ' + DASH +
    b' click to contact the author">',
    b'alt="' + NEW + b'" title="' + NEW + b" " + DASH +
    b' click to contact the author">',
    "corner-logo-alt")

# 3) the visible header: drop the warning sign + "3D", use the new name
rep('\u26a0 Maxwell Demon Lab <span style="color:var(--dim)">3D</span>'.encode("utf-8"),
    NEW,
    "header-h1")

# 4) center animation alt + tooltip
rep(b'alt="Maxwell Demon Lab" title="Maxwell Demon Lab ' + DASH +
    b' click to send a message">',
    b'alt="' + NEW + b'" title="' + NEW + b" " + DASH +
    b' click to send a message">',
    "center-anim-alt")

# 5) contact modal copy
rep(b"Questions or feedback about the Maxwell Demon Lab?",
    b"Questions or feedback about " + NEW + b"?",
    "modal-copy")

# 6) email subject used by the contact form
rep(b'"Maxwell Demon Lab 3D ' + DASH + b' message from a visitor"',
    b'"' + NEW + b" " + DASH + b' message from a visitor"',
    "mail-subject")

open(P, "wb").write(data)
print("OK")
