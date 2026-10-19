#!/usr/bin/env python3
"""Verify the six-panel session figure honors paper style (no dashed 'waiting'
blocks, no dark chrome). Feeds a synthetic session through window.__sixTest,
switches #sixStyleSel, captures the #sixAnim canvas in both styles."""
import base64, json, sys, time, urllib.request
import websocket

BASE = "http://127.0.0.1:9333"
URL = "http://127.0.0.1:8879/experiment_plots.html?v=" + str(int(time.time()))
OUT = "Nature paper"


def cdp_connect(url):
    req = urllib.request.Request(BASE + "/json/new?" + urllib.request.quote(url, safe=""),
                                 method="PUT")
    info = json.loads(urllib.request.urlopen(req, timeout=15).read())
    ws = websocket.create_connection(info["webSocketDebuggerUrl"], timeout=60,
                                     suppress_origin=True)
    return ws, info


def send(ws, _id, method, **params):
    ws.send(json.dumps({"id": _id, "method": method, "params": params}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == _id:
            return msg.get("result", {})


def evaluate(ws, expr):
    r = send(ws, 7, "Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=True)
    return r.get("result", {}).get("value")


def shot_canvas(ws, sel, path):
    # the headless compositor is unreliable for this surface; grab the canvas
    # CONTENT itself via toDataURL — identical to what the download button saves
    data = evaluate(ws, "document.querySelector('" + sel + "').toDataURL('image/png')")
    if not data or not data.startswith("data:image/png;base64,"):
        print("  no canvas data:", sel); return False
    with open(path, "wb") as f:
        f.write(base64.b64decode(data.split(",", 1)[1]))
    print("  saved", path)
    return True


def main():
    ws, info = cdp_connect(URL)
    send(ws, 1, "Page.enable"); send(ws, 2, "Runtime.enable")
    send(ws, 3, "Emulation.setDeviceMetricsOverride", width=1400, height=1000,
         deviceScaleFactor=1, mobile=False)
    time.sleep(6)
    if not evaluate(ws, "!!window.__sixTest"):
        print("page did not boot (cache?)"); return 1
    # scroll the session card into view and check the wrap actually shows
    evaluate(ws, "document.getElementById('sixAnimWrap').scrollIntoView({block:'center'}); 1")
    time.sleep(0.5)
    print("wrap display:", evaluate(ws, "getComputedStyle(document.getElementById('sixAnimWrap')).display"))
    print("canvas size:", evaluate(ws, "(() => { const c = document.getElementById('sixAnim'); return c ? c.width + 'x' + c.height : null; })()"))
    # synthetic session: 6 experiments, 2 done (data URLs from tiny canvases)
    feed = """(async () => {
      const curve = []; for (let i = 0; i < 60; i++) curve.push(-7 + 4*Math.exp(-i/18) + Math.sin(i/5)*0.3);
      window.__sixTest({ type:'session_begin', expIds:['e1','e2','e4','e5','e10','e11'] });
      await new Promise(r => setTimeout(r, 100));
      window.__sixTest({ type:'done', expId:'e1', label:'E1 — classical demon', summary:{ curve } });
      window.__sixTest({ type:'done', expId:'e2', label:'E2 — neural demon', summary:{ curve } });
      await new Promise(r => setTimeout(r, 300));
      return 'fed';
    })()"""
    evaluate(ws, feed)
    time.sleep(1)
    evaluate(ws, "document.getElementById('sixAnimWrap').scrollIntoView({block:'center'}); 1")
    time.sleep(0.5)
    print("after feed — wrap display:", evaluate(ws, "getComputedStyle(document.getElementById('sixAnimWrap')).display"),
          "| canvas rect:", evaluate(ws, "(() => { const r = document.getElementById('sixAnim').getBoundingClientRect(); return [r.x|0, r.y|0, r.width|0, r.height|0]; })()"))
    ok = True
    # live style first (default), then paper
    evaluate(ws, "document.getElementById('sixStyleSel').value = 'paper'; " +
                  "document.getElementById('sixStyleSel').dispatchEvent(new Event('change')); 1")
    time.sleep(1)
    ok &= shot_canvas(ws, "#sixAnim", f"{OUT}/_verify_six_paper.png")
    evaluate(ws, "document.getElementById('sixStyleSel').value = 'live'; " +
                  "document.getElementById('sixStyleSel').dispatchEvent(new Event('change')); 1")
    time.sleep(1)
    ok &= shot_canvas(ws, "#sixAnim", f"{OUT}/_verify_six_live.png")
    urllib.request.urlopen(BASE + "/json/close/" + info["id"], timeout=10).read()
    ws.close()
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
