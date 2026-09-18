"""Serve and open the 3D Maxwell Demon Lab with its local Three.js module."""
from __future__ import annotations

import argparse
import functools
import http.server
import threading
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEFAULT_PORT = 8765


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    """Keep the launcher console focused on lifecycle messages."""

    def log_message(self, format: str, *args: object) -> None:
        if self.path != "/favicon.ico":
            super().log_message(format, *args)


def main() -> None:
    parser = argparse.ArgumentParser(description="Launch the 3D FlyWire Maxwell Demon Lab")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="localhost port (default: 8765)")
    parser.add_argument("--no-browser", action="store_true", help="serve without opening a browser")
    args = parser.parse_args()

    handler = functools.partial(QuietHandler, directory=str(ROOT))
    with http.server.ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
        url = f"http://127.0.0.1:{args.port}/fly_demon_3d.html"
        print(f"Serving FlyWire Maxwell Demon Lab at {url}")
        print("Keep this window open while using the experiment; press Ctrl+C to stop.")
        if not args.no_browser:
            threading.Timer(0.2, webbrowser.open, args=(url,)).start()
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nLauncher stopped.")


if __name__ == "__main__":
    main()
