# Extract the module <script> from fly_demon_3d.html for syntax checking.
from pathlib import Path
import re
src = Path("fly_demon_3d.html").read_text(encoding="utf-8")
m = re.search(r'<script type="module">(.*?)</script>', src, re.S)
assert m, "module script not found"
Path("_check_3d10.tmp.mjs").write_text(m.group(1), encoding="utf-8")
print("extracted", m.group(1).count("\n"), "lines of module JS")
