#!/usr/bin/env bash
#
# deployment/bootstrap.sh — Phase 02 fresh-machine bootstrap.
#
# Takes a machine with git + node + Python 3.11 from zero to a verified
# deployment checkout:
#   1. verify prerequisites (git, node >= 18, python 3.11.x)
#   2. create BOTH pinned python environments from the locked requirement files
#   3. verify manifest integrity (all runtime payload hashes)
#   4. run the minimal smoke test (node tests/run_smoke.js)
#   5. print the exact environment-variable exports the runner requires
#
# No developer-specific paths, no hidden state: everything is relative to the
# repository root this script lives in. Installs ONLY pinned dependencies
# (requirements-embodiment.txt / requirements-flyvis.txt, which pin flybody and
# flyvis to exact audited commits). FlyVis's pretrained checkpoint is a
# documented, explicit, user-invoked download step — never a silent fetch.
#
# Usage:
#   bash deployment/bootstrap.sh              # both environments
#   bash deployment/bootstrap.sh --embodiment # embodiment only
#   bash deployment/bootstrap.sh --flyvis     # flyvis only
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FAIL() { echo "BOOTSTRAP FAIL: $*" >&2; exit 1; }
log()  { echo "[bootstrap] $*"; }

# ---------------------------------------------------------------- 1. prereqs
command -v git >/dev/null 2>&1 || FAIL "git not found on PATH"
command -v node >/dev/null 2>&1 || FAIL "node not found on PATH"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || FAIL "node >= 18 required, found $(node --version)"

# Resolve a Python 3.11 interpreter EXE (venv tracks are pinned to 3.11).
# Order: python3/python on PATH -> Windows py launcher -> fail.
PYEXE=""
for cand in python3 python; do
  if command -v "$cand" >/dev/null 2>&1; then
    V="$("$cand" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
    if [ "$V" = "3.11" ]; then PYEXE="$("$cand" -c 'import sys; print(sys.executable)')"; break; fi
  fi
done
if [ -z "$PYEXE" ] && command -v py >/dev/null 2>&1; then
  V="$(py -3.11 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || true)"
  [ "$V" = "3.11" ] && PYEXE="$(py -3.11 -c 'import sys; print(sys.executable)')"
fi
[ -n "$PYEXE" ] || FAIL "python 3.11.x not found (PATH or py launcher) — embodiment/flyvis tracks are pinned to 3.11"

log "git       : $(git --version)"
log "node      : $(node --version)"
log "python3.11: $("$PYEXE" --version) via $PYEXE"

# ---------------------------------------------------------------- 2. envs
WANT_EMBODIMENT=1; WANT_FLYVIS=1
case "${1:-}" in
  --embodiment) WANT_FLYVIS=0 ;;
  --flyvis)     WANT_EMBODIMENT=0 ;;
  "") ;;
  *) FAIL "usage: bash deployment/bootstrap.sh [--embodiment|--flyvis]" ;;
esac

mkvenv() { # mkvenv <dir> <requirements>
  local dir="$1" req="$2"
  if [ ! -x "$dir/Scripts/python.exe" ] && [ ! -x "$dir/bin/python" ]; then
    log "creating $dir from $req ..."
    "$PYEXE" -m venv "$dir"
  fi
  local PIP
  if [ -x "$dir/Scripts/python.exe" ]; then PIP="$dir/Scripts/python.exe"; else PIP="$dir/bin/python"; fi
  "$PIP" -m pip install --upgrade pip >/dev/null
  "$PIP" -m pip install -r "$req"
  log "installed $req -> $dir"
}

[ "$WANT_EMBODIMENT" = 1 ] && mkvenv .venv-embodiment requirements-embodiment.txt
[ "$WANT_FLYVIS" = 1 ]     && mkvenv .venv-flyvis     requirements-flyvis.txt

# ------------------------------------------------- 3. manifest verification
log "verifying manifest integrity (canonical tool) ..."
if ! python tools/verify_manifest.py > /dev/null 2>&1; then
  # Self-heal for clones made before the byte-faithful attributes policy
  # (*. -text) took effect: line endings may have been smudged at checkout.
  # Rewrite the working tree from the index ONLY when there are no local
  # modifications — this never destroys user changes.
  if [ -z "$(git status --porcelain)" ]; then
    log "re-materializing working tree byte-faithfully (checkout-index) ..."
    git checkout-index -f -a
  fi
  python tools/verify_manifest.py > /dev/null || FAIL "manifest verification failed — payload hashes do not match"
fi

# ------------------------------------------------- 4. minimal smoke test
log "running minimal smoke test ..."
node tests/run_smoke.js > /dev/null || FAIL "smoke test failed"

# ------------------------------------------------- 5. exports
PYEMB=".venv-embodiment/Scripts/python.exe"; [ -x "$PYEMB" ] || PYEMB=".venv-embodiment/bin/python"
PYFV=".venv-flyvis/Scripts/python.exe";      [ -x "$PYFV" ]  || PYFV=".venv-flyvis/bin/python"

cat <<EOF

BOOTSTRAP OK
================== cut here ==================
export PYTHON_EMBODIMENT="$ROOT/$PYEMB"
export FLYVIS_PYTHON="$ROOT/$PYFV"
================== cut here ==================
Then run the canonical deployment runner:
  node deployment/deploy_runner.js verify
  PYTHON_EMBODIMENT="\$PYTHON_EMBODIMENT" node deployment/deploy_runner.js acceptance

Optional (explicit, user-invoked — never silent): FlyVis pretrained checkpoint
  FLYVIS_ROOT_DIR=.flyvis_data "$PYFV" -m flyvis download-pretrained
EOF
