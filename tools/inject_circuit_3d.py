"""Regenerate the FAFB circuit payload (data/circuits/fafb_circuit.js) from fly_brain_circuit.json.

Payload-split workflow (see PAYLOAD_SEPARATION_PLAN.md): the 3D app no longer
embeds the circuit inline; this tool rewrites the payload file that the app
loads as a blocking <script src>. The JSON must be compact (single line) and
must carry the optic layer + position channels the 3D app depends on.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CIRCUIT = ROOT / "fly_brain_circuit.json"
PAYLOAD = ROOT / "data" / "circuits" / "fafb_circuit.js"


def main() -> None:
    circuit = json.loads(CIRCUIT.read_text(encoding="utf-8"))
    if circuit.get("optic_layer") != 1:
        raise ValueError("fly_brain_circuit.json has no optic layer at index 1")
    if not circuit.get("optic_channels"):
        raise ValueError("fly_brain_circuit.json has no optic position channels")

    compact = json.dumps(circuit, separators=(",", ":"))
    PAYLOAD.parent.mkdir(parents=True, exist_ok=True)
    # newline="\n" keeps LF line endings on Windows (tests search for ";\n")
    with open(PAYLOAD, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(
            "// FAFB v783 circuit payload (semantic embed of fly_brain_circuit.json).\n"
            "// Loaded as a classic blocking <script src> before the app ES module.\n"
            "// Regenerate: python tools/inject_circuit_3d.py\n"
            "globalThis.__FAFB_CIRCUIT__ = " + compact + ";\n"
        )
    print(
        f"embedded FAFB optic circuit: {len(circuit['layers'])} layers, "
        f"{sum(map(len, circuit['layers'])):,} neurons, "
        f"{len(circuit['edges']):,} edges, "
        f"{len(circuit['optic_channels']):,} position channels "
        f"-> {PAYLOAD.relative_to(ROOT)} ({len(compact)/1e6:.2f} MB)"
    )


if __name__ == "__main__":
    main()
