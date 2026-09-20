"""Serve and open the 3D Maxwell Demon Lab with its local Three.js module.

Robust against a busy port: it never silently shares a port with another
program (a second server on the same port makes the browser hit the WRONG
app, which looks like "the page does not open"). If the default port is
taken it moves to the next free one, and it only opens the browser after
verifying that this server actually answers for the app page.
"""
from __future__ import annotations

import argparse
import functools
import http.client
import http.server
import sys
import threading
import time
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEFAULT_PORT = 8765
MAX_PORT_TRIES = 21
APP_PATH = "/fly_demon_3d.html"


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    """Keep the launcher console focused on lifecycle messages."""

    def log_message(self, format: str, *args: object) -> None:
        if self.path != "/favicon.ico":
            super().log_message(format, *args)

    def end_headers(self) -> None:
        # Dev/lab server: never let the browser cache app files. A stale
        # cached experiment_worker.js once survived a bug fix and re-broke
        # E9/E10/E11 with an error that was already repaired on disk.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


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
