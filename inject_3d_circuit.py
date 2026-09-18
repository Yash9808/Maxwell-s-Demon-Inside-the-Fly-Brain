"""Embed fly_brain_circuit.json into the FAFB circuit slot in fly_demon_3d.html."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PAGE = ROOT / "fly_demon_3d.html"
CIRCUIT = ROOT / "fly_brain_circuit.json"


def main() -> None:
    page = PAGE.read_text(encoding="utf-8")
    circuit = json.loads(CIRCUIT.read_text(encoding="utf-8"))
    if circuit.get("optic_layer") != 1:
        raise ValueError("fly_brain_circuit.json has no optic layer at index 1")
    if not circuit.get("optic_channels"):
        raise ValueError("fly_brain_circuit.json has no optic position channels")

    start_marker = "const FAFB = "
    end_marker = "\nconst MCNS = "
    start = page.index(start_marker) + len(start_marker)
    end = page.index(end_marker, start)
    compact = json.dumps(circuit, separators=(",", ":"))
    PAGE.write_text(page[:start] + compact + page[end:], encoding="utf-8")
    print(
        f"embedded FAFB optic circuit: {len(circuit['layers'])} layers, "
        f"{sum(map(len, circuit['layers'])):,} neurons, "
        f"{len(circuit['edges']):,} edges, "
        f"{len(circuit['optic_channels']):,} position channels"
    )


if __name__ == "__main__":
    main()
