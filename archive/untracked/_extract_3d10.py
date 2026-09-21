# -*- coding: utf-8 -*-
"""Extract JS from patched fly_demon_3d.html for node --check (companion to patch 10)."""
import re

data = open("fly_demon_3d.html", "rb").read()

m = re.search(rb"<script>\r?\n(.*?)</script>", data, re.S)
assert m, "classic script not found"
open("_check_3d10.js", "wb").write(m.group(1))

m = re.search(rb'<script type="module">\r?\n(.*?)</script>', data, re.S)
assert m, "module script not found"
open("_check_3d10_module.mjs", "wb").write(m.group(1))

print("extracted", len(m.group(1)), "module bytes")
