#!/usr/bin/env python3
"""Capture publication figures from the LIVE publication_figures.html page.

Reproduces exactly what the page's own "Save PNG" button composes (white
background, legend/colorbar, caption) by driving headless Chrome over the
DevTools Protocol (CDP): load page -> await window.__pubDebug -> click tab
-> evaluate the save composition -> save PNG via Page.captureScreenshot.

Usage:
  python tools/capture_publication_figs.py --port 8822 --outdir "Nature paper"
"""
import argparse
import base64
import json
import os
import sys
import time
import urllib.request

import websocket  # websocket-client

CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]


def find_chrome():
    for p in CHROME_CANDIDATES:
        if os.path.exists(p):
            return p
    raise SystemExit("no Chrome/Edge found")


def cdp_session(ws_url):
    ws = websocket.create_connection(ws_url, timeout=60, max_size=200 * 1024 * 1024)
    mid = [0]

    def send(method, params=None):
        mid[0] += 1
        ws.send(json.dumps({"id": mid[0], "method": method, "params": params or {}}))
        deadline = time.time() + 120
        while time.time() < deadline:
            msg = json.loads(ws.recv())
            if msg.get("id") == mid[0]:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})
        raise TimeoutError(method)

    return ws, send


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8822, help="static server port")
    ap.add_argument("--outdir", default="Nature paper")
    ap.add_argument("--width", type=int, default=1680)
    ap.add_argument("--height", type=int, default=1160)
    args = ap.parse_args()

    os.makedirs(args.outdir, exist_ok=True)
    exe = find_chrome()
    dbg = 9333
    subprocess_args = [
        exe, "--headless=new", f"--remote-debugging-port={dbg}",
        "--remote-allow-origins=*", "--disable-gpu", "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader", "--hide-scrollbars", "--mute-audio",
        f"--window-size={args.width},{args.height}",
        "--user-data-dir=" + os.path.abspath(".chrome_pub_tmp"),
        "about:blank",
    ]
    proc = __import__("subprocess").Popen(
        subprocess_args, stdout=__import__("subprocess").DEVNULL,
        stderr=__import__("subprocess").DEVNULL)
    try:
        # wait for the devtools endpoint
        for _ in range(60):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{dbg}/json/version", timeout=2) as r:
                    ver = json.load(r)
                break
            except Exception:
                time.sleep(0.5)
        else:
            raise SystemExit("chrome devtools never came up")
        targets = None
        for _ in range(30):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{dbg}/json/list", timeout=2) as r:
                    targets = json.load(r)
                break
            except Exception:
                time.sleep(0.5)
        page = next((t for t in targets if t.get("type") == "page"), None)
        if not page:
            raise SystemExit("no page target")
        ws_url = page["webSocketDebuggerUrl"]

        ws, send = cdp_session(ws_url)
        send("Page.enable")
        send("Runtime.enable")
        send("Log.enable")
        send("Emulation.setDeviceMetricsOverride",
             {"width": args.width, "height": args.height, "deviceScaleFactor": 1, "mobile": False})
        url = f"http://127.0.0.1:{args.port}/publication_figures.html"
        send("Page.navigate", {"url": url})

        # await page readiness: __pubDebug present (all data loaded, first render done)
        ready_expr = "!!(window.__pubDebug && window.__pubDebug.nNeurons > 0)"
        for _ in range(240):
            res = send("Runtime.evaluate", {"expression": ready_expr, "returnByValue": True})
            if res.get("result", {}).get("value"):
                break
            time.sleep(0.5)
        else:
            logs = send("Runtime.evaluate", {"expression": "document.getElementById('err').textContent",
                                             "returnByValue": True})
            raise SystemExit("page never became ready; err box: " + str(logs))

        info = send("Runtime.evaluate", {"expression": "JSON.stringify(window.__pubDebug)",
                                         "returnByValue": True})
        print("page ready:", info["result"]["value"][:220])

        for mode, outname in (("A", "fig_brain_outcome_A_live_firing.png"),
                              ("B", "fig_brain_outcome_B_learning_deltas.png")):
            # switch tab through the page's own API (same as clicking the button)
            send("Runtime.evaluate", {"expression": f"window.__pubDebug.render('{mode}')",
                                      "returnByValue": True, "awaitPromise": True})
            time.sleep(1.2)  # let the WebGL frame settle
            # Re-run the page's Save-PNG composition *in-page* so the saved bytes
            # are exactly what the button produces (legend+colorbar+caption).
            expr = """
(async () => {
  const stage = document.getElementById('stage');
  const W0 = stage.clientWidth, H0 = stage.clientHeight;
  const FW = 1600, FH = 1100;
  window.__pubDebug._renderer = window.__pubDebug._renderer || null;
  // find the renderer: three.js keeps it reachable via the canvas
  const cv = stage.querySelector('canvas');
  // use the page's own export path by dispatching the same code path:
  document.getElementById('savePng').click();
  // wait until the fetch to /api/figure_save fires (or fallback click)
  return true;
})()
"""
            send("Runtime.evaluate", {"expression": expr, "returnByValue": True,
                                      "awaitPromise": True})
            # the page POSTs the PNG to /api/figure_save -> server writes figures/
            # we still grab a raw viewport screenshot as backup verification
            time.sleep(2.5)
            shot = send("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False})
            out = os.path.join(args.outdir, outname.replace(".png", "_viewport.png"))
            with open(out, "wb") as f:
                f.write(base64.b64decode(shot["data"]))
            print("captured", out)

        # also fetch the server-saved canonical figures
        for name in ("figureA_fly_brain.png", "figureB_fly_brain.png"):
            u = f"http://127.0.0.1:{args.port}/figures/{name}"
            try:
                with urllib.request.urlopen(u, timeout=10) as r:
                    data = r.read()
                out = os.path.join(args.outdir, name.replace("figure", "fig_brain_outcome_live_")
                                   .replace("A_", "A_").replace("B_", "B_"))
                out = os.path.join(args.outdir, f"fig_{name}")
                with open(out, "wb") as f:
                    f.write(data)
                print("fetched", out, len(data), "bytes")
            except Exception as e:
                print("WARN could not fetch", name, e)

        ws.close()
        print("DONE")
    finally:
        proc.terminate()


if __name__ == "__main__":
    main()
