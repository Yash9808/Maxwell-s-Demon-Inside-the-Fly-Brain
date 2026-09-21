#!/usr/bin/env python3
"""Generate MANIFEST.json — machine-readable provenance for this repository.

Usage:
    python tools/make_manifest.py            # regenerate MANIFEST.json at repo root

Records SHA256 for every file that defines or carries scientific content.
Files larger than MAX_HASH_BYTES (the four FlyWire feather tables) are listed
with size + sha256: null — verify those by re-download from the FlyWire codex
export rather than by hash. No DOIs are fabricated: unknown identifiers are
recorded as "DOI: UNKNOWN" with the source URL/reference preserved separately.

This tool does NOT change scientific behavior; it only measures the tree.
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "MANIFEST.json"

# Files > this size are recorded with sha256 null (too expensive / already
# git-ignored); their identity is the FlyWire codex export they came from.
MAX_HASH_BYTES = 512 * 1024 * 1024  # 512 MB

APP_VERSION = "0.9.0"


def sha256(path: Path) -> str | None:
    h = hashlib.sha256()
    try:
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
    except OSError:
        return None
    return h.hexdigest()


def git(*args: str) -> str | None:
    try:
        r = subprocess.run(["git", *args], cwd=ROOT, capture_output=True,
                           text=True, timeout=15)
        out = (r.stdout or "").strip()
        return out or None
    except (OSError, subprocess.TimeoutExpired):
        return None


def file_entry(rel: str) -> dict:
    p = ROOT / rel
    if not p.exists():
        return {"path": rel, "present": False, "sha256": None, "bytes": None}
    size = p.stat().st_size
    digest = sha256(p) if size <= MAX_HASH_BYTES else None
    return {
        "path": rel,
        "present": True,
        "sha256": digest,
        "bytes": size,
        "sha256_note": None if digest else
            "file exceeds MAX_HASH_BYTES; verify against FlyWire codex export instead",
    }


# ---------------------------------------------------------------------------
# File groups (paths relative to repo root)
# ---------------------------------------------------------------------------
SOURCE_FILES = [
    "experiment_core.js", "controllers.js", "experiment_worker.js",
    "benchmark.js", "learning_test.js", "brain_worker.js",
    "fafb783.py", "extract_circuit.py", "inject_circuit.py",
    "inject_3d_circuit.py", "neuropil_matrix.py", "classify_neurons.py",
    "analyze_v783.py", "plot_experiment_figures.py",
    "analysis/plot_research_figures.py", "launch_fly_demon_3d.py",
    "build_nature_paper_docx.py",
    "fly_demon_lab_template.html", "experiment_plots.html",
]

HYBRID_APP_FILES = [
    "fly_demon_3d.html",     # hand-written app + embedded circuit payloads
    "fly_demon_lab.html",
]

VENDORED_LIBS = [
    "three.module.js", "GLTFLoader.module.js", "BufferGeometryUtils.module.js",
]

CIRCUIT_PAYLOADS = [
    # payload-split loader files (Stage 3): the app loads these instead of
    # embedding circuits inline - see PAYLOAD_SEPARATION_PLAN.md
    "data/circuits/fafb_circuit.js",
    "data/circuits/mcns_circuit.js",
    "data/circuits/lab_circuit.js",
    "fly_brain_circuit.json",
    "malecns_circuit_pruned.json",
    "malecns_circuit.json",
    "fly_brain_positions.json", "fly_brain_positions.bin",
    "fly_brain_hulls.json", "fly_brain_hulls.bin",
    "fly_brain_hulls_raw_frame.bin", "fly_brain_meta.json",
    "devil_b64.txt",
]

FLYWIRE_V783_DATA = [
    "proofread_root_ids_783.npy",
    "proofread_connections_783.feather",
    "synapses_connections_783.feather",
    "per_neuron_neuropil_count_pre_783.feather",
    "per_neuron_neuropil_count_post_783.feather",
]

ANALYSIS_OUTPUTS = [
    "neuron_nt_classification.csv", "neuron_nt_summary_by_neuropil.csv",
    "neuron_nt_report.md", "neuropil_matrix.csv", "neuropil_matrix_report.md",
    "report_v783.md", "maxwell_demon_experiment.md",
    "maxwell_demon_figure.pdf",
]

MESH_ASSETS = [
    "drosophila_-_adult_fruit_fly_-_ct_scan.glb",
    "drosophila_larve_brain__axotactin_enhancer_axog.glb",
    "fiji_sample_-_fly_brain_stl-binary_-_tarea_9.glb",
    "fly.glb", "b7c7e51c-2912-4f77-bbdf-a440cfbb3527.glb",
]

EXPERIMENT_CONFIGS = sorted(
    str(p.relative_to(ROOT)) for p in (ROOT / "experiments").glob("*.json")
) if (ROOT / "experiments").exists() else []


def main() -> int:
    manifest: dict = {
        "manifest_version": 1,
        "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "application": {
            "name": "Maxwell's Demon: Inside the Fly Brain",
            "version": APP_VERSION,
            "version_note": "First engineering-manifest release; pre-1.0 research code.",
            "git_commit": git("rev-parse", "HEAD") or "UNKNOWN",
            "git_branch": git("rev-parse", "--abbrev-ref", "HEAD") or "UNKNOWN",
            "git_dirty": bool(git("status", "--porcelain")),
            "git_remote": git("config", "remote.origin.url") or "UNKNOWN",
        },
        "connectome_provenance": {
            "fafb": {
                "source": "FlyWire Full Adult Fly Brain (FAFB) connectome",
                "materialization": "v783",
                "scope": "proofread (both partners proofread)",
                "url": "https://codex.flywire.ai/?dataset=fafb",
                "DOI": "DOI: UNKNOWN",
                "reference": "Dorkenwald et al., Neuronal wiring diagram of an adult brain, bioRxiv 2023 / Nature 2024 (see s41586-024-07939-3.pdf)",
                "caveat": "Root IDs are stable only within materialization v783.",
            },
            "mcns": {
                "source": "FlyWire male CNS (MCNS) connectome",
                "materialization": "payload dataset field: mcns_v1.0; app UI label: v0.9 (discrepancy flagged, unresolved)",
                "url": "https://codex.flywire.ai/?dataset=mcns",
                "DOI": "DOI: UNKNOWN",
            },
            "neurotransmitter_predictions": {
                "source": "Buhmann et al. synapse-type prediction model (two-stage automated NT classification)",
                "note": "Scores are predictions (0-1), not experimental measurements; *_avg > 0.5 is a soft call.",
                "DOI": "DOI: UNKNOWN",
            },
        },
        "random_seed_scheme": {
            "benchmark_and_worker_seeds": "seed = base + seedIdx*101 (base from run cfg, default 1)",
            "connectome_brain_draw": "makeRng(9176 + seedIdx*37)",
            "policy_gradient_readout": "makeRng(424243 + seedIdx*977)",
            "e4_shuffled_connectome": "shuffle: true, seed 7",
            "prng": "mulberry32 (32-bit, experiment_core.js makeRng)",
        },
        "generated_data_provenance": {
            "fly_brain_circuit.json":
                "python extract_circuit.py  (from v783 feather tables; requires synapses table for optic position channels)",
            "malecns_circuit_pruned.json":
                "pruned MCNS export (generator script not retained; see SCRIPT_ARCHIVE_INDEX.md)",
            "fly_brain_positions.json/.bin, fly_brain_hulls*":
                "_rebuild_anatomy.py (anatomy pipeline; see SCRIPT_ARCHIVE_INDEX.md)",
            "neuron_nt_classification.csv": "python classify_neurons.py",
            "neuropil_matrix.csv": "python neuropil_matrix.py",
            "report_v783.md": "python analyze_v783.py",
            "research_data/": "node benchmark.js / experiment batch runners (seeded, per-run provenance inside each summary)",
            "research_figures/": "python analysis/plot_research_figures.py + plot_experiment_figures.py",
            "fly_demon_3d.html FAFB/MCNS slots": "python inject_3d_circuit.py (FAFB slot) / manual embed (MCNS slot)",
        },
        "files": {},
    }

    groups = {
        "source": SOURCE_FILES,
        "hybrid_app": HYBRID_APP_FILES,
        "vendored_libs": VENDORED_LIBS,
        "circuit_payloads": CIRCUIT_PAYLOADS,
        "flywire_v783_data": FLYWIRE_V783_DATA,
        "analysis_outputs": ANALYSIS_OUTPUTS,
        "mesh_assets": MESH_ASSETS,
        "experiment_configs": EXPERIMENT_CONFIGS,
    }
    for group, rels in groups.items():
        manifest["files"][group] = [file_entry(r) for r in rels]

    # Repo totals (tracked files) for context
    tracked = git("ls-files")
    n_tracked = len(tracked.splitlines()) if tracked else 0
    manifest["repository"] = {
        "tracked_file_count": n_tracked,
        "note": "Large DATA (*.feather, malecns_circuit.json, s41586-024-07939-3.pdf) is git-ignored; hashed here when present.",
        "missing_files": [f["path"] for g in manifest["files"].values()
                          for f in g if not f["present"]],
    }

    OUT.write_text(json.dumps(manifest, indent=2, sort_keys=False) + "\n",
                   encoding="utf-8")
    n_hashed = sum(1 for g in manifest["files"].values() for f in g if f["sha256"])
    print(f"wrote {OUT.name}: {n_hashed} files hashed, "
          f"{len(manifest['repository']['missing_files'])} missing, "
          f"commit {manifest['application']['git_commit'][:12]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
