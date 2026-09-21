"""ONE-SHOT Stage-3 payload split (kept for provenance in archive/).

Extracts the embedded circuit payloads from the two monolithic HTML apps into
data/circuits/*.js and rewrites the HTML to consume them, with:

  * byte-exact extraction (payload bytes == standalone JSON bytes, verified)
  * classic blocking <script src> payloads (spec-guaranteed to run before the
    deferred ES module) so app init order is unchanged
  * unchanged binding names (const FAFB / const MCNS / const CIRCUIT), so the
    single consumer site (makeSim(key==="fafb" ? FAFB : MCNS)) is untouched
  * a visible full-screen error if payloads fail to load (file:// case)

Run once; idempotence NOT guaranteed after the first run (payloads are gone
from the HTML afterwards). Verification lives in tests/run_smoke.js S1/S3.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "circuits"
DATA.mkdir(parents=True, exist_ok=True)


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def split_3d() -> None:
    html = ROOT / "fly_demon_3d.html"
    raw = html.read_bytes()
    lines = raw.split(b"\n")

    fafb_line = mcns_line = None
    for i, l in enumerate(lines):
        if l.startswith(b"const FAFB = {"):
            fafb_line = i
        elif l.startswith(b"const MCNS = {"):
            mcns_line = i
    assert fafb_line is not None and mcns_line is not None, "payload lines not found"

    fafb_body = lines[fafb_line][len(b"const FAFB = "):].rstrip(b";")
    mcns_body = lines[mcns_line][len(b"const MCNS = "):].rstrip(b";")

    # byte-exactness against the standalone JSONs
    assert sha(fafb_body) == sha((ROOT / "fly_brain_circuit.json").read_bytes()), \
        "FAFB payload != fly_brain_circuit.json"
    assert sha(mcns_body) == sha((ROOT / "malecns_circuit_pruned.json").read_bytes()), \
        "MCNS payload != malecns_circuit_pruned.json"
    json.loads(fafb_body)  # still valid JSON
    json.loads(mcns_body)

    (DATA / "fafb_circuit.js").write_bytes(
        b"// FAFB v783 circuit payload (byte-exact embed of fly_brain_circuit.json).\n"
        b"// Loaded as a classic blocking <script src> before the app ES module.\n"
        b"// Regenerate: python tools/inject_circuit_3d.py\n"
        b"globalThis.__FAFB_CIRCUIT__ = " + fafb_body + b";\n")
    (DATA / "mcns_circuit.js").write_bytes(
        b"// MCNS (male CNS) circuit payload (byte-exact embed of malecns_circuit_pruned.json).\n"
        b"// Loaded as a classic blocking <script src> before the app ES module.\n"
        b"globalThis.__MCNS_CIRCUIT__ = " + mcns_body + b";\n")

    # rewrite the module: keep bindings, guard on load failure
    guard = (
        b'// ------------------------------------------------- embedded circuits\n'
        b'// (payload split: circuits load from data/circuits/*.js via blocking\n'
        b'//  <script src> tags before this module evaluates - see\n'
        b'//  PAYLOAD_SEPARATION_PLAN.md; bindings keep their original names)\n'
        b'if (!window.__FAFB_CIRCUIT__ || !window.__MCNS_CIRCUIT__) {\n'
        b'  document.body.innerHTML = \'<div style="position:fixed;inset:0;z-index:99999;\'\n'
        b'    + \'background:#450a0a;color:#fecaca;padding:28px;font:15px/1.6 system-ui,sans-serif">\'\n'
        b'    + \'<h2>Circuit payloads failed to load</h2>\'\n'
        b'    + \'<p>The brain data files data/circuits/fafb_circuit.js and mcns_circuit.js could not be loaded.</p>\'\n'
        b'    + \'<p>Serve this folder over http:// (python launch_fly_demon_3d.py) - file:// blocks the payload scripts.</p></div>\';\n'
        b'  throw new Error("FAFB/MCNS circuit payloads not loaded (data/circuits/*.js)");\n'
        b'}\n'
        b'const FAFB = window.__FAFB_CIRCUIT__;\n'
        b'const MCNS = window.__MCNS_CIRCUIT__;\n'
    )
    assert lines[fafb_line + 1].startswith(b"const MCNS"), "unexpected line after FAFB payload"
    assert lines[fafb_line + 2].startswith(b"const DEVIL_B64"), "unexpected line after MCNS payload"
    # drop BOTH payload lines (FAFB and MCNS) - the guard re-declares the bindings
    new_lines = lines[:fafb_line] + guard.split(b"\n") + lines[fafb_line + 2:]

    # blocking payload scripts before the module
    marker = b'<script type="module">'
    text = b"\n".join(new_lines)
    idx = text.index(marker)
    inject = (b'<script src="data/circuits/fafb_circuit.js"></script>\n'
              b'<script src="data/circuits/mcns_circuit.js"></script>\n')
    text = text[:idx] + inject + text[idx:]
    html.write_bytes(text)
    print(f"fly_demon_3d.html: {len(raw):,} -> {len(text):,} bytes")


def split_lab() -> None:
    html = ROOT / "fly_demon_lab.html"
    raw = html.read_bytes()
    lines = raw.split(b"\n")
    cir_idx = next(i for i, l in enumerate(lines) if l.startswith(b"const CIRCUIT = "))
    line = lines[cir_idx]
    # pattern: const CIRCUIT = /*FAFB v783 circuit*/{...};
    m = re.match(rb"const CIRCUIT = (/\*[^*]*\*/)?(.+);\s*\r?$", line, re.DOTALL)
    assert m, "lab CIRCUIT line pattern mismatch"
    body = m.group(2)
    lab_obj = json.loads(body)
    n_layers = len(lab_obj["layers"])
    n_edges = len(lab_obj["edges"])

    (DATA / "lab_circuit.js").write_bytes(
        b"// 2D lab circuit payload (extracted from fly_demon_lab.html; an EARLIER\n"
        b"// extraction than fly_brain_circuit.json - 4 layers / "
        + str(n_edges).encode() + b" edges).\n"
        b"// Loaded as a classic blocking <script src> before the lab script.\n"
        b"globalThis.__LAB_CIRCUIT__ = " + body + b";\n")

    lines[cir_idx] = (b"const CIRCUIT = globalThis.__LAB_CIRCUIT__;   "
                      b"// payload split - see PAYLOAD_SEPARATION_PLAN.md")
    text = b"\n".join(lines)
    # insert the payload script tag just before the lab's main classic script
    tag = b'<script src="data/circuits/lab_circuit.js"></script>'
    idx = text.index(b"<script>")
    text = text[:idx] + tag + b"\n" + text[idx:]
    html.write_bytes(text)
    print(f"fly_demon_lab.html: {len(raw):,} -> {len(text):,} bytes "
          f"(lab circuit: {n_layers} layers, {n_edges:,} edges)")


if __name__ == "__main__":
    split_3d()
    split_lab()
    print("done")
