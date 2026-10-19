"""Serve and open the 3D Maxwell Demon Lab with its local Three.js module.

Robust against a busy port: it never silently shares a port with another
program (a second server on the same port makes the browser hit the WRONG
app, which looks like "the page does not open"). If the default port is
taken it moves to the next free one, and it only opens the browser after
verifying that this server actually answers for the app page.
"""
from __future__ import annotations

import argparse
import email.utils
import functools
import gzip
import http.client
import http.server
import json
import os
import sys
import threading
import time
import zlib
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEFAULT_PORT = 8765
MAX_PORT_TRIES = 21
APP_PATH = "/fly_demon_3d.html"

# Caching policy (P7): code must never be cached (a stale cached
# experiment_worker.js once survived a bug fix), but the big payloads
# (~107 MB of circuits/celltypes/edge-paths) should not be re-downloaded
# on every reload either. Those are served revalidatable instead:
# ETag + Last-Modified + `no-cache`, so a warm reload is a batch of
# tiny 304 responses. Text assets are gzipped when the client asks.
NO_STORE_SUFFIXES = (".html",)             # app entry points
NO_STORE_NAMES = {"experiment_worker.js"}  # worker code: stale guard
GZIP_TYPES = (".js", ".json", ".html", ".svg", ".txt", ".csv")
GZIP_MIN = 1024                            # never bother below 1 KiB

# Lazily-initialized (index, file handle) for the all-neuron skeleton set;
# guarded because ThreadingHTTPServer serves requests concurrently.
_ALL_ARBORS = None
_ALL_ARBORS_LOCK = threading.Lock()


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    """Keep the launcher console focused on lifecycle messages."""

    # ---- P7: caching-split helpers ----------------------------------------
    def _asset_key(self, fs_path: str) -> str:
        p = fs_path.replace("\\", "/").lower()
        name = p.rsplit("/", 1)[-1]
        if name in NO_STORE_NAMES or p.endswith(NO_STORE_SUFFIXES):
            return "no-store"
        return "no-cache"

    def _file_etag(self, fs_path: str, st) -> str:
        return 'W/"%x-%x"' % (st.st_mtime_ns, st.st_size)

    def _accepts_gzip(self) -> bool:
        return "gzip" in self.headers.get("Accept-Encoding", "").lower()

    def _validators_match(self, etag: str) -> bool:
        inm = self.headers.get("If-None-Match")
        if inm:
            cands = [c.strip() for c in inm.split(",")]
            weak = [c[2:] if c.startswith("W/") else c for c in cands]
            return etag[2:] in weak or "*" in cands
        ims = self.headers.get("If-Modified-Since")
        if ims:
            try:
                import datetime as _dt
                since = email.utils.parsedate_to_datetime(ims)
                if since.tzinfo is None:
                    since = since.replace(tzinfo=_dt.timezone.utc)
                return int(self._ims_mtime) <= int(since.timestamp())
            except Exception:
                pass
        return False

    def _p7_headers(self, fs_path: str, st) -> None:
        """Stage validator/policy headers for the next end_headers()."""
        self._p7 = {"etag": self._file_etag(fs_path, st),
                    "lastmod": email.utils.formatdate(
                        st.st_mtime, usegmt=True),
                    "policy": self._asset_key(fs_path),
                    "gzip": False}

    def log_message(self, format: str, *args: object) -> None:
        if self.path.startswith("/api/poll") or self.path == "/favicon.ico":
            return
        super().log_message(format, *args)

    # ---- on-demand arbor-family streaming (S arbors view) ----------------
    # GET /api/arbor_families -> directory of cell-type / neuropil families
    #                          (neuron counts, node totals, availability)
    # GET /api/arbor_family?axis=type&name=Tm3[&cap=N]
    #                       -> arbors-v1 records for every typed member,
    #                          node-budget capped (default 1.5M nodes)
    # Both read the prebuilt skeletons_all.bin written by
    # tools/build_neuron_skeletons.py --build-all; responses are byte-range
    # concatenations, never a re-scan of the 5.4 GB source parquet.

    def do_POST(self):
        """POST endpoints: /api/sidecar (ensure the CL sidecar is up) and
/api/figure_save (write a rendered publication figure PNG to figures/,
used by publication_figures.html for reproducible artifacts; the PNG
bytes come from the page's own composed canvas)."""
        from urllib.parse import urlparse
        path = urlparse(self.path).path
        if path == "/api/sidecar":
            return self._sidecar_ensure()
        if path != "/api/figure_save":
            self.send_error(404)
            return
        try:
            n = int(self.headers.get("Content-Length", "0"))
            if n <= 0 or n > 64 * 1024 * 1024:
                raise ValueError("bad payload size")
            body = self.rfile.read(n)
            if not body.startswith(b"\x89PNG"):
                raise ValueError("payload is not a PNG")
            figs = ROOT / "figures"
            figs.mkdir(exist_ok=True)
            stamp = time.strftime("%Y%m%d-%H%M%S")
            name = f"figure_{stamp}.png"
            # optional label from the query (?name=figureA) for stable names
            from urllib.parse import urlparse as _up, parse_qs as _pq
            q = _pq(_up(self.path).query)
            label = (q.get("name") or [""])[0].strip()
            if label and all(c.isalnum() or c in "-_" for c in label) \
                    and 1 <= len(label) <= 40:
                name = f"{label}.png"
            (figs / name).write_bytes(body)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True,
                "path": str((figs / name).relative_to(ROOT))}).encode())
        except Exception as e:                                   # noqa: BLE001
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": False,
                "error": str(e)}).encode())

    def do_GET(self):
        from urllib.parse import urlparse, parse_qs
        u = urlparse(self.path)
        if not u.path.startswith("/api/") and self._maybe_304():
            return                     # warm reload: 304, nothing to read
        if u.path == "/api/arbor_families":
            return self._arbor_families()
        if u.path == "/api/arbor_family":
            q = parse_qs(u.query)
            return self._arbor_family(
                (q.get("axis") or ["type"])[0],
                (q.get("name") or [""])[0],
                int((q.get("cap") or ["1500000"])[0]))
        # P7: regular files get gzip + validators; directories and
        # unknown paths fall back to the stock behavior inside.
        self.send_head_p7()

    def _load_all_arbors(self):
        """Cache (index, open bin handle) for the all-neuron skeleton set."""
        global _ALL_ARBORS
        with _ALL_ARBORS_LOCK:
            if _ALL_ARBORS is None:
                idx_path = ROOT / "data/skeletons/skeletons_all_index.json"
                bin_path = ROOT / "data/skeletons/skeletons_all.bin"
                if not idx_path.exists() or not bin_path.exists():
                    return None
                with open(idx_path, encoding="utf-8") as f:
                    idx = json.load(f)
                f = open(bin_path, "rb")
                _ALL_ARBORS = (idx, f)
            return _ALL_ARBORS

    def _maybe_304(self) -> bool:
        """304 when If-None-Match/If-Modified-Since match the file."""
        if self.command != "GET":
            return False
        if not (self.headers.get("If-None-Match")
                or self.headers.get("If-Modified-Since")):
            return False
        path = self.translate_path(self.path)
        if not os.path.isfile(path):
            return False
        try:
            st = os.stat(path)
        except OSError:
            return False
        if self._asset_key(path) == "no-store":
            return False                   # code files always 200 (stale guard)
        etag = self._file_etag(path, st)
        self._ims_mtime = st.st_mtime
        if not self._validators_match(etag):
            return False
        self._p7_headers(path, st)
        try:
            self.send_response(304)
            self.end_headers()
        finally:
            self._p7 = None
        return True

    def _arbor_families(self):
        try:
            loaded = self._load_all_arbors()
            if loaded is None:
                return self._json_response({"error":
                    "skeletons_all.bin missing — run tools/"
                    "build_neuron_skeletons.py --build-all"}, 503)
            idx, _f = loaded
            ct_path = ROOT / "fly_brain_celltypes.json"
            ct = json.loads(ct_path.read_text(encoding="utf-8"))
            fams = {"type": {}, "np": {}}
            for n in ct["neurons"]:
                rid = int(n["root_id"])
                rec = idx["by_root"].get(str(rid))
                if not rec:
                    continue
                nm = n.get("cell_type") or "unknown"
                e = fams["type"].setdefault(nm, {"count": 0, "nodes": 0})
                e["count"] += 1; e["nodes"] += rec["nodes"]
                nm = n.get("pre_neuropil") or "unknown"
                e = fams["np"].setdefault(nm, {"count": 0, "nodes": 0})
                e["count"] += 1; e["nodes"] += rec["nodes"]
            out = {"schema": "arbor_families v1", "n_arbors": len(idx["by_root"]),
                   "axes": {
                       "type": sorted(
                           ({"name": k, **v} for k, v in fams["type"].items()),
                           key=lambda d: -d["count"]),
                       "np": sorted(
                           ({"name": k, **v} for k, v in fams["np"].items()),
                           key=lambda d: -d["count"]),
                   },
                   "provenance": idx.get("provenance", {})}
            return self._json_response(out)
        except Exception as exc:                       # pragma: no cover
            return self._json_response({"error": str(exc)}, 500)

    def _arbor_family(self, axis, name, cap):
        try:
            loaded = self._load_all_arbors()
            if loaded is None:
                return self._json_response({"error":
                    "skeletons_all.bin missing — run tools/"
                    "build_neuron_skeletons.py --build-all"}, 503)
            idx, f = loaded
            ct_path = ROOT / "fly_brain_celltypes.json"
            ct = json.loads(ct_path.read_text(encoding="utf-8"))
            members = []
            for n in ct["neurons"]:
                nm = (n.get("cell_type") if axis == "type"
                      else n.get("pre_neuropil")) or "unknown"
                if nm == name:
                    members.append(int(n["root_id"]))
            if not members:
                return self._json_response(
                    {"error": f"unknown family '{name}' on axis '{axis}'"}, 404)
            by_root = idx["by_root"]
            members.sort(key=lambda r: int(by_root[str(r)]["off"]) if str(r) in by_root else 2**62)
            total = sum(by_root[str(r)]["nodes"] for r in members if str(r) in by_root)
            capped = total > cap
            if capped:
                # deterministic priority: keep the densest arbors (they carry
                # the family's morphological signature), ties by root id
                members.sort(key=lambda r: (-by_root[str(r)]["nodes"]
                                            if str(r) in by_root else -1, r))
                kept, budget = [], 0
                for r in members:
                    nd = by_root[str(r)]["nodes"] if str(r) in by_root else 0
                    if budget + nd > cap and kept:
                        break
                    kept.append(r); budget += nd
                members = sorted(kept)
            parts, served, nodes, roots = [], 0, 0, []
            for r in members:
                rec = by_root.get(str(r))
                if not rec:
                    continue
                n_nodes = rec["nodes"]
                rec_len = 8 + n_nodes * 8
                f.seek(rec["off"])
                parts.append(f.read(rec_len))
                roots.append(str(r))
                served += 1; nodes += n_nodes
            body = b"".join(parts)
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("X-Arbor-Family", f"{axis}:{name}")
            self.send_header("X-Arbor-Members", str(served))
            self.send_header("X-Arbor-Nodes", str(nodes))
            self.send_header("X-Arbor-Capped", "1" if capped else "0")
            # record order == this root-id order; lets the renderer color each
            # arbor by its published cell type without a second lookup roundtrip
            self.send_header("X-Arbor-Roots", ",".join(roots))
            self.send_header("Access-Control-Expose-Headers",
                             "X-Arbor-Family, X-Arbor-Members, X-Arbor-Nodes, "
                             "X-Arbor-Capped, X-Arbor-Roots")
            self.end_headers()
            self.wfile.write(body)
        except Exception as exc:                       # pragma: no cover
            try:
                return self._json_response({"error": str(exc)}, 500)
            except Exception:
                pass

    # ---- on-demand sidecar spawn (CL panel auto-start) --------------------
    # The closed-loop card needs `sidecar.py --ws --port 8795`. The browser
    # cannot spawn processes, so the panel asks the launcher (the only
    # long-lived process here) to ensure the sidecar is listening. Idempotent:
    # if anything already answers on the port we leave it alone. If the spawn
    # dies (e.g. missing deps) we fail fast with the log tail instead of
    # leaving the panel to time out.
    SIDECAR_PORT = 8795
    _SIDECAR_PROC = None            # set when we spawned it
    _SIDECAR_LOCK = threading.Lock()

    def _sidecar_listening(self) -> bool:
        """True when the sidecar port answers a TCP connect (probe, not data)."""
        import socket
        try:
            with socket.create_connection(("127.0.0.1", self.SIDECAR_PORT),
                                          timeout=0.5):
                return True
        except OSError:
            return False

    def _sidecar_ensure(self):
        import subprocess
        if self._sidecar_listening():
            return self._json_response({"ok": True, "action": "already-running"})
        with self._SIDECAR_LOCK:
            if self._sidecar_listening():        # lost a benign race
                return self._json_response({"ok": True, "action": "already-running"})
            venv = ROOT / ".venv-embodiment" / "Scripts" / "python.exe"
            py = str(venv) if venv.exists() else sys.executable
            log = ROOT / "embodiment" / "logs" / "sidecar_8795.log"
            err = ROOT / "embodiment" / "logs" / "sidecar_8795.err.log"
            log.parent.mkdir(parents=True, exist_ok=True)
            with open(log, "w") as lf, open(err, "w") as ef:
                try:
                    proc = subprocess.Popen(
                        [py, str(ROOT / "embodiment" / "sidecar.py"),
                         "--ws", "--port", str(self.SIDECAR_PORT)],
                        cwd=str(ROOT), stdout=lf, stderr=ef,
                        creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0))
                except OSError as exc:
                    return self._json_response(
                        {"ok": False, "action": "spawn-failed",
                         "error": f"cannot launch {py}: {exc}"}, 502)
            type(self)._SIDECAR_PROC = proc
            # Wait for the listener OR a fast death: a hard socket bind
            # succeeds in well under a second; dep failures die in <2 s.
            deadline = time.time() + 15.0
            while time.time() < deadline:
                if proc.poll() is not None:      # died before listening
                    tail = ""
                    try:
                        tail = (err.read_text(encoding="utf-8",
                                               errors="replace")[-800:] or
                                log.read_text(encoding="utf-8",
                                              errors="replace")[-800:])
                    except OSError:
                        pass
                    return self._json_response(
                        {"ok": False, "action": "spawn-died", "log_tail": tail}, 502)
                if self._sidecar_listening():
                    return self._json_response(
                        {"ok": True, "action": "spawned", "pid": proc.pid})
                time.sleep(0.1)
            try:
                proc.terminate()                 # never listen-block without serving
            except OSError:
                pass
            return self._json_response(
                {"ok": False, "action": "timeout",
                 "error": f"sidecar did not listen on {self.SIDECAR_PORT} within 15 s"},
                502)

    def _json_response(self, obj, code=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # ---- P7: single end_headers — validators, policy, gzip ----------------
    def end_headers(self) -> None:
        req = getattr(self, "_p7", None)
        if req is not None:
            self.send_header("ETag", req["etag"])
            self.send_header("Last-Modified", req["lastmod"])
            self.send_header("Cache-Control", req["policy"])
            if req["gzip"]:
                self.send_header("Content-Encoding", "gzip")
        else:
            # API responses and dynamic endpoints: never cached
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_p7_file(self, fs_path: str, st, body: bytes,
                     ctype: str) -> None:
        gz = (fs_path.lower().endswith(GZIP_TYPES)
              and len(body) >= GZIP_MIN and self._accepts_gzip())
        self._p7_headers(fs_path, st)
        self._p7["gzip"] = gz
        try:
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            if gz:
                # big payloads: fast level (loopback latency beats ratio)
                # NOTE: gzip format (RFC 1952), NOT zlib — the browser asks
                # for `Content-Encoding: gzip` and zlib.compress() bytes
                # make it fail with ERR_CONTENT_DECODING_FAILED.
                body = gzip.compress(body,
                                     compresslevel=1 if len(body) >= 8 << 20
                                     else 6)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        finally:
            self._p7 = None

    def send_head_p7(self) -> None:
        """Serve regular files with gzip + validators; directories and
        unknown paths fall back to the stock send_head (its file object
        is copied here, exactly as base do_GET would)."""
        path = self.translate_path(self.path)
        if os.path.isfile(path):
            ctype = self.guess_type(path)
            try:
                st = os.stat(path)
                with open(path, "rb") as f:
                    body = f.read()
            except OSError:
                body = None
            if body is not None:
                self.send_p7_file(path, st, body, ctype)
                return
        f = super().send_head()
        if f:
            try:
                self.copyfile(f, self.wfile)
            finally:
                f.close()

    # (blanket no-store end_headers removed by the P7 caching split;
    #  the single P7 version below keeps the stale-worker guard for code)


class LabServer(http.server.ThreadingHTTPServer):
    # Do NOT set SO_REUSEADDR on Windows: it would let a second server bind a
    # busy port and silently steal (or lose) the browser's requests.
    allow_reuse_address = False


def bind_server(port: int, explicit: bool) -> tuple[http.server.ThreadingHTTPServer, int]:
    """Bind `port`, walking upward unless the user chose it explicitly."""
    for attempt in range(MAX_PORT_TRIES):
        try:
            return LabServer(("127.0.0.1", port),
                             functools.partial(QuietHandler, directory=str(ROOT))), port
        except OSError as exc:
            if explicit:
                raise SystemExit(
                    f"Port {port} is busy ({exc}). Free that port or pass another --port."
                ) from exc
            if attempt == 0:
                print(f"Port {port} is busy (another program is using it) — "
                      f"trying the next free port…")
            port += 1
    raise SystemExit(f"No free port found after {MAX_PORT_TRIES} tries.")


def self_check(port: int) -> bool:
    """True when OUR server answers HTTP 200 for the app page."""
    try:
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
        conn.request("GET", APP_PATH)
        ok = conn.getresponse().status == 200
        conn.close()
        return ok
    except OSError:
        return False


def main() -> None:
    parser = argparse.ArgumentParser(description="Launch the 3D FlyWire Maxwell Demon Lab")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT,
                        help="localhost port (default: 8765)")
    parser.add_argument("--no-browser", action="store_true",
                        help="serve without opening a browser")
    args = parser.parse_args()

    explicit = "--port" in sys.argv
    server, port = bind_server(args.port, explicit)
    url = f"http://127.0.0.1:{port}{APP_PATH}"
    print(f"Serving FlyWire Maxwell Demon Lab at {url}")
    print("Keep this window open while using the experiment; press Ctrl+C to stop.")

    def open_when_ready() -> None:
        for _ in range(20):                      # up to ~2 s
            if self_check(port):
                webbrowser.open(url)
                return
            time.sleep(0.1)
        print("WARNING: the page did not answer — open it manually:", url)

    if not args.no_browser:
        threading.Thread(target=open_when_ready, daemon=True).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nLauncher stopped.")


if __name__ == "__main__":
    main()
