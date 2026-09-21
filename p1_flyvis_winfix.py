"""p1_flyvis_winfix.py — Windows compatibility shim for datamate's HDF5 writer.

Scope: runtime patch of ONE function in a THIRD-PARTY dependency (datamate)
before flyvis is imported. It changes NO scientific content and touches no
P0/P1 project file.

Bug (datamate 1.0.0 io.py, _write_h5): the writer opens the target file
h5.File(path, mode="w"), probes f["data"] (KeyError on a fresh file), and its
except-branch calls path.unlink() while the mode="w" handle is STILL OPEN.
On POSIX unlinking an open file succeeds; on Windows it raises
PermissionError WinError 32 — so every FIRST write of every .h5 fails,
making flyvis unusable out of the box on Windows.

Fix: identical data, correct handle lifecycle — probe exists, close the
handle, unlink, then write. Applied to both import-binding sites
(datamate.io._write_h5 and the `from .io import _write_h5` copy in
datamate.directory). Never raises for unrelated code paths.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any


def _write_h5_win(path: Path, val: Any) -> None:
    """Windows-safe replacement for datamate.io._write_h5 (same semantics).

    Imports h5py/numpy lazily: this module must stay importable in
    environments without them (the sidecar contract tests run on host python).
    """
    import h5py as h5
    import numpy as np

    val = np.asarray(val)
    try:
        f = h5.File(path, libver="latest", mode="w")
        if f["data"].dtype != val.dtype:  # KeyError on fresh file -> below
            raise ValueError()
        f["data"][...] = val
        f.swmr_mode = True
        assert f.swmr_mode
    except Exception:
        # ORIGINAL BUG: unlink while the mode="w" handle is open -> WinError 32.
        # FIX: close first, then unlink, then write.
        try:
            f.close()
        except Exception:
            pass
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.is_dir():
            path.rmdir()
        elif path.exists():
            try:
                path.unlink()
            except FileNotFoundError:
                pass
        f = h5.File(path, libver="latest", mode="w")
        f["data"] = val
        f.swmr_mode = True
        assert f.swmr_mode
    f.close()


def apply_winfix() -> bool:
    """Patch datamate (both binding sites). True if applied, False if the
    datamate/h5py stack is absent (honest no-op, never raises)."""
    try:
        import datamate.io as dm_io  # noqa: F401  (implies h5py present)
    except Exception:
        return False
    try:
        dm_io._write_h5 = _write_h5_win
        import datamate.directory as dm_dir
        if hasattr(dm_dir, "_write_h5"):
            dm_dir._write_h5 = _write_h5_win
        return True
    except Exception:
        return False
