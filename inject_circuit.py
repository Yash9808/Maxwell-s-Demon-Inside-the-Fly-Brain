"""Inject fly_brain_circuit.json into fly_demon_lab_template.html -> fly_demon_lab.html."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent
tpl = (ROOT / "fly_demon_lab_template.html").read_text(encoding="utf-8")
circuit = (ROOT / "fly_brain_circuit.json").read_text(encoding="utf-8")

# sanity: JSON must parse and be compact enough to embed
data = json.loads(circuit)
n = sum(len(l) for l in data["layers"])
print(f"circuit: {n:,} neurons, {len(data['edges']):,} edges, "
      f"{len(circuit)/1e6:.2f} MB json")

pat = re.compile(r"/\*__CIRCUIT__\*/.*?/\*__END__\*/", re.DOTALL)
assert pat.search(tpl), "placeholder not found in template"
out = pat.sub("/*FAFB v783 circuit*/" + circuit, tpl, count=1)

(ROOT / "fly_demon_lab.html").write_text(out, encoding="utf-8")
size = (ROOT / "fly_demon_lab.html").stat().st_size
print(f"wrote fly_demon_lab.html ({size/1e6:.2f} MB)")
