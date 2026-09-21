"""Inject the 2D-lab circuit payload (data/circuits/lab_circuit.js) into fly_demon_lab_template.html -> fly_demon_lab.html.

Payload-split workflow (see PAYLOAD_SEPARATION_PLAN.md): the generated
fly_demon_lab.html now loads its circuit from data/circuits/lab_circuit.js as a
blocking <script src> instead of embedding it inline. The template keeps the
/*__CIRCUIT__*/…/*__END__*/ placeholder for provenance, but the placeholder is
replaced by the loader binding rather than the multi-megabyte JSON.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent
PAYLOAD = ROOT / "data" / "circuits" / "lab_circuit.js"
TEMPLATE = ROOT / "fly_demon_lab_template.html"
OUT = ROOT / "fly_demon_lab.html"


def main() -> None:
    raw = PAYLOAD.read_text(encoding="utf-8")
    # payload file format: comments, then globalThis.__LAB_CIRCUIT__ = <json>;
    m = re.search(r"globalThis\.__LAB_CIRCUIT__ = (.+);\s*$", raw, re.MULTILINE)
    assert m, "lab_circuit.js does not match the expected payload format"
    data = json.loads(m.group(1))
    n = sum(len(l) for l in data["layers"])
    print(f"lab circuit: {n:,} neurons, {len(data['edges']):,} edges, "
          f"{len(m.group(1))/1e6:.2f} MB json")

    tpl = TEMPLATE.read_text(encoding="utf-8")
    pat = re.compile(r"/\*__CIRCUIT__\*/.*?/\*__END__\*/", re.DOTALL)
    assert pat.search(tpl), "placeholder not found in template"
    out = pat.sub("globalThis.__LAB_CIRCUIT__;   /* payload split - loaded from data/circuits/lab_circuit.js */",
                  tpl, count=1)

    # ensure the payload <script src> precedes the app script
    if 'src="data/circuits/lab_circuit.js"' not in out:
        out = out.replace("<script>",
                          '<script src="data/circuits/lab_circuit.js"></script>\n<script>', 1)

    OUT.write_text(out, encoding="utf-8")
    size = OUT.stat().st_size
    print(f"wrote fly_demon_lab.html ({size/1e6:.2f} MB)")


if __name__ == "__main__":
    main()
