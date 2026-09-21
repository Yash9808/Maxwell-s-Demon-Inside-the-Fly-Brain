#!/usr/bin/env python3
# embodiment/deps_probe.py — exact dependency report for the embodiment stack.
# Never installs anything; never substitutes mocks for real deps.
import importlib
import json
import sys
from importlib.metadata import PackageNotFoundError, version as _pkg_version

REQUIRED = [
    ("mujoco", "mujoco", "python -m pip install mujoco"),
    ("dm_control", "dm_control", "python -m pip install dm_control"),
    ("flybody", "flybody", 'python -m pip install "flybody @ git+https://github.com/TuragaLab/flybody.git"'),
]


def _mod_version(mod, pkg):
    v = getattr(mod, "__version__", None)
    if v:
        return v
    try:
        return _pkg_version(pkg)
    except PackageNotFoundError:
        return "unknown"


def probe():
    report = {"python": sys.version.split()[0], "deps": [], "ok": False}
    missing = []
    for name, mod, install in REQUIRED:
        try:
            m = importlib.import_module(mod)
            report["deps"].append({"name": name, "present": True,
                                   "version": _mod_version(m, name)})
            report["python"] = report.get("python", sys.version.split()[0])
        except Exception as e:  # noqa: BLE001
            report["deps"].append({"name": name, "present": False,
                                   "error": "%s: %s" % (type(e).__name__, e),
                                   "install": install})
            missing.append(name)
    report["ok"] = not missing
    report["missing"] = missing
    return report


if __name__ == "__main__":
    r = probe()
    print(json.dumps(r, indent=2))
    if not r["ok"]:
        print("\nTo unblock physics embodiment, run:")
        for d in r["deps"]:
            if not d["present"]:
                print("  " + d["install"])
        print("\nNote: flybody is GitHub-only (not on PyPI). Its CI targets "
              "Python 3.10-3.12; this interpreter is " + r["python"] +
              ". If the flybody import fails on 3.14, create a 3.10-3.12 venv "
              "and point clients at it via PYTHON_EMBODIMENT / --python.")
        sys.exit(1)
