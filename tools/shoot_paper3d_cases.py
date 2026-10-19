#!/usr/bin/env python3
"""CDP element screenshots of the 3D paper-view canvas, one per condition chip.

Verifies the research-paper (Figure A) view end-to-end: white stage, region-
colored pathway bundles, per-case firing differences. Saves PNGs into
'Nature paper/' and prints bundle-lit counts per case from the debug hook.
"""
import base64, json, sys, time, urllib.request
import websocket

BASE = "http://127.0.0.1:9333"          # dedicated headless Chrome (debug port)
URL = "http://127.0.0.1:8879/experiment_plots.html?cdp=1&v=10#view=paper"
OUT = "Nature paper"


def cdp_connect(url):
    # newer Chrome builds require PUT for /json/new
    req = urllib.request.Request(BASE + "/json/new?" + urllib.request.quote(url, safe=""),
                                 method="PUT")
    info = json.loads(urllib.request.urlopen(req).read())
    ws = websocket.create_connection(info["webSocketDebuggerUrl"], timeout=60,
                                     suppress_origin=True)
    return ws, info


def send(ws, _id, method, **params):
    ws.send(json.dumps({"id": _id, "method": method, "params": params}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == _id:
            return msg.get("result", {})


def evaluate(ws, expr, await_promise=False):
    r = send(ws, 7, "Runtime.evaluate", expression=expr,
             returnByValue=True, awaitPromise=await_promise)
    return r.get("result", {}).get("value")


def shoot_canvas(ws, path):
    rect = evaluate(ws, """(() => {
      const c = document.querySelector('#ct3dMount canvas');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height };
    })()""")
    if not rect:
        print("  canvas not found"); return False
    shot = send(ws, 8, "Page.captureScreenshot", format="png",
                clip={"x": rect["x"], "y": rect["y"],
                      "width": rect["w"], "height": rect["h"], "scale": 2})
    if not shot.get("data"):
        print("  no screenshot data"); return False
    with open(path, "wb") as f:
        f.write(base64.b64decode(shot["data"]))
    print("  saved", path, f"{rect['w']:.0f}x{rect['h']:.0f}")
    return True


def close_stale_tabs():
    try:
        tabs = json.loads(urllib.request.urlopen(BASE + "/json/list", timeout=10).read())
        n = 0
        for t in tabs:
            if t.get("type") == "page" and "experiment_plots.html" in t.get("url", ""):
                urllib.request.urlopen(BASE + "/json/close/" + t["id"], timeout=10).read()
                n += 1
        if n:
            print(f"closed {n} stale tab(s)"); time.sleep(1)
    except Exception as e:
        print("tab cleanup skipped:", e)


def close_tab(info):
    """Close the real browser tab — ws.close() alone leaves it alive, and each
    tab holds the 31 MB fallback + a WebGL context, which starves the next one."""
    try:
        urllib.request.urlopen(BASE + "/json/close/" + info["id"], timeout=10).read()
    except Exception:
        pass


def boot_tab(case=None):
    """Fresh tab per case: the 31 MB fallback + point buffers OOM a renderer
    that reuses one tab across all cases, so boot -> set case -> shoot -> close.
    'case' goes in the query string (before the #hash); the page reads it in
    buildChips and pre-selects that chip."""
    if case:
        head, _, frag = URL.partition("#")
        url = head + "&case=" + case + ("#" + frag if frag else "")
    else:
        url = URL
    ws, info = cdp_connect(url)
    send(ws, 1, "Page.enable"); send(ws, 2, "Runtime.enable")
    send(ws, 3, "Emulation.setDeviceMetricsOverride",
         width=1500, height=4400, deviceScaleFactor=1, mobile=False)
    # poll for readiness instead of a fixed sleep — cold-cache parse of the
    # 31 MB fallback can outlast any fixed wait
    want_conds = ("(() => { const D = window.__ct3dDbg; return D && D.getV().rows && "
                  "D.getV().rows.length>0" +
                  (f" && D.getV().cur==={json.dumps(case)}" if case else "") + "; })()")
    for _ in range(40):
        time.sleep(1.5)
        if not (evaluate(ws, "!!window.__ct3dDbg") and
                evaluate(ws, "!!document.querySelector('#ct3dMount canvas')")):
            continue
        if evaluate(ws, want_conds):
            break
    time.sleep(4)                                      # first frames + bundles
    return ws, info


def main():
    close_stale_tabs()
    # tab 1: read the case list (buildChips decides it at runtime)
    ws, info = boot_tab()
    dbg = evaluate(ws, "!!window.__ct3dDbg")
    print("debug hook:", dbg)
    if not dbg:
        print("page did not boot with the new code (cache?)"); return 1
    conds = evaluate(ws, "window.__ct3dDbg.getV().conds")
    print("cases:", conds)
    close_tab(info)
    ws.close()
    if not conds:
        print("no conditions found"); return 1
    ok = True
    for c in conds:
        ws, info = boot_tab(c)
        evaluate(ws, f"""(() => {{
          const b = [...document.querySelectorAll('#ct3dChips button')]
            .find(b => b.dataset.cond === {json.dumps(c)});
          if (b) b.click();
        }})()""")
        time.sleep(5)                                  # bundle recolor + render
        st = evaluate(ws, """(() => { const D = window.__ct3dDbg, PB = D.getPB();
          return PB ? { lit: PB.lit, solid: PB.solid.meta.length, mod: PB.mod.meta.length,
                       mode: D.getV().mode, cur: D.getV().cur } : null; })()""")
        print(c, "->", st)
        lbls = evaluate(ws, "window.__ct3dDbg.labels && window.__ct3dDbg.labels()")
        print("   labels:", lbls)
        if not shoot_canvas(ws, f"{OUT}/_paper3d_case_{c}.png"):
            print("  renderer context lost — aborting")
            ok = False
            close_tab(info); ws.close()
            break
        close_tab(info); ws.close()
        time.sleep(1)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
