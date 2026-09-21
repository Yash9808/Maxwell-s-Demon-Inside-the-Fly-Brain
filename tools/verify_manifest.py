#!/usr/bin/env python3
"""tools/verify_manifest.py — canonical MANIFEST.json verification (Phase 02).

Recomputes sha256 of every manifest-tracked file (working-tree bytes, binary —
the same method as tools/make_manifest.py) and compares against the recorded
hashes. Fails closed:

  * any hash mismatch  -> stale entry -> exit 1
  * any missing file that is NOT documented in repository.missing_files -> exit 1
  * null sha256 entries are counted as null_by_design (generator policy: >512 MB)

Output: human-readable lines + a JSON summary on stdout (last line prefixed
"JSON: " for machine parsing). Exit 0 iff zero stale and no undocumented
missing files.

Usage: python tools/verify_manifest.py [--json-only]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAX_HASH_BYTES = 512 * 1024 * 1024  # mirrors tools/make_manifest.py policy


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        while True:
            c = f.read(1 << 20)
            if not c:
                break
            h.update(c)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json-only", action="store_true")
    ap.add_argument("--manifest", default="MANIFEST.json",
                    help="manifest to verify (relative to repo root or absolute); "
                         "default: the canonical MANIFEST.json")
    args = ap.parse_args()

    mp = Path(args.manifest)
    manifest_path = mp if mp.is_absolute() else ROOT / mp
    if not manifest_path.exists():
        print("FATAL: MANIFEST.json not found", file=sys.stderr)
        return 1
    m = json.loads(manifest_path.read_text(encoding="utf-8"))

    documented_missing = set(m.get("repository", {}).get("missing_files", []))
    # machine-local provisions: expected absent on a fresh machine (never
    # git-tracked; per-machine documented provisioning) — reported separately.
    local_provisioned = set(m.get("repository", {}).get("local_provisioned_data", []))
    excluded = set(m.get("repository", {}).get("phase_01_excluded", [])) | \
               set(m.get("repository", {}).get("phase_02_excluded", []))

    stale: list[str] = []
    missing: list[str] = []
    missing_documented: list[str] = []
    null_by_design: list[str] = []
    verified = 0
    total = 0

    for group, entries in m.get("files", {}).items():
        for f in entries:
            total += 1
            path_rel = f["path"]
            fp = ROOT / path_rel
            rec = f.get("sha256")
            if rec is None:
                if not fp.exists():
                    # missing file with no hash: documented-missing if listed, else violation
                    if path_rel in documented_missing:
                        missing_documented.append(path_rel)
                    else:
                        missing.append(path_rel)
                else:
                    null_by_design.append(path_rel)
                continue
            if not fp.exists():
                if path_rel in documented_missing or path_rel in local_provisioned:
                    missing_documented.append(path_rel)
                else:
                    missing.append(path_rel)
                continue
            got = sha256_file(fp)
            if got != rec:
                stale.append(path_rel)
            else:
                verified += 1

    result = {
        "artifact": "manifest_verification",
        "manifest_commit_stamp": (m.get("application", {}) or {}).get("git_commit"),
        "total_entries": total,
        "verified": verified,
        "stale": stale,
        "missing_undocumented": missing,
        "missing_documented": missing_documented,
        "local_provisioned_absent": sorted(
            p for p in missing_documented if p in local_provisioned),
        "null_by_design": null_by_design,
        "excluded": sorted(excluded),
        "zero_stale": len(stale) == 0 and len(missing) == 0,
    }

    if not args.json_only:
        print(f"manifest stamp : {result['manifest_commit_stamp']}")
        print(f"entries        : {total}")
        print(f"verified       : {verified}")
        print(f"stale          : {len(stale)}{(' -> ' + ', '.join(stale[:5])) if stale else ''}")
        print(f"missing (undoc): {len(missing)}{(' -> ' + ', '.join(missing[:5])) if missing else ''}")
        print(f"missing (doc)  : {len(missing_documented)}")
        print(f"null_by_design : {len(null_by_design)}")
        print(f"excluded       : {len(excluded)}")

    print("JSON: " + json.dumps(result))
    return 0 if result["zero_stale"] else 1


if __name__ == "__main__":
    sys.exit(main())
