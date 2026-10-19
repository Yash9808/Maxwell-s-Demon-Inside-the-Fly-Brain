#!/usr/bin/env python3
"""Verify the popped-out side bar (Fly Demon — side bar window) scrolls.

The copied page CSS sets body{overflow:hidden}; the popup now overrides it.
This drives the real flow: open app -> click Lab dock button -> find the
popup target -> measure scrollability -> scroll to the bottom section ->
screenshot proof. Saves into 'Nature paper/'.
"""
import base64, json, time, urllib.parse, urllib.request
import websocket

BASE = "http://127.0.0.1:9333"
APP = "http://127.0.0.1:8879/fly_demon_3d.html?cdp=1&v=sidebar2"
OUT = "Nature paper/_verify_sidebar_scroll.png"


def http_json(path, method="GET"):
    req = urllib.request.Request(BASE + path, method=method)
    body = urllib.request.urlopen(req, timeout=15).read()
    # /json/close answers "Target is closing" or empty text — tolerate both
    try:
        return json.loads(body)
    except ValueError:
        return {}


def connect(info):
    return websocket.create_connection(info["webSocketDebuggerUrl"], timeout=90,
                                       suppress_origin=True)


def send(ws, _id, method, **params):
    ws.send(json.dumps({"id": _id, "method": method, "params": params}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == _id:
            if "error" in msg:
                print("  CDP error:", msg["error"])
            return msg.get("result", {})


def evaluate(ws, expr, await_promise=False, gesture=False):
    r = send(ws, 7, "Runtime.evaluate", expression=expr,
             returnByValue=True, awaitPromise=await_promise, userGesture=gesture)
    res = r.get("result", {})
    # Chrome >=136 nests the value one level deeper: result.result.value
    inner = res.get("result", res)
    return inner.get("value")


def main():
    # fresh main tab with the app
    for t in http_json("/json/list"):
        if t.get("type") == "page" and "fly_demon_3d" in t.get("url", ""):
            http_json("/json/close/" + t["id"])
    time.sleep(1)
    info = http_json("/json/new?" + urllib.parse.quote(APP, safe=""), method="PUT")
    ws = connect(info)
    send(ws, 1, "Runtime.enable")
    send(ws, 2, "Page.enable")

    # wait for the dock button to be clickable (script IIFE ran)
    ok = False
    for _ in range(40):
        v = evaluate(ws, """(() => {
          const b = document.querySelector('#dockNav button[data-dock="interactiveLab"]');
          return b ? 'ready' : 'no'; })()""")
        if v == "ready":
            ok = True
            break
        time.sleep(1)
    if not ok:
        print("FAIL: dock button never became ready"); return 1
    print("app loaded, dock button ready")

    # click with a CDP user gesture — window.open needs user activation, and
    # Input.dispatchMouseEvent alone did not grant it in headless
    evaluate(ws, """document.querySelector('#dockNav button[data-dock="interactiveLab"]').click()""",
             gesture=True)
    print("clicked Lab — waiting for popup window")

    # find the popup target (title set by barPop)
    pop = None
    for _ in range(30):
        for t in http_json("/json/list"):
            if t.get("type") == "page" and "Fly Demon" in (t.get("title") or ""):
                pop = t
                break
        if pop:
            break
        time.sleep(1)
    if not pop:
        print("FAIL: popup window never appeared"); return 1
    print("popup found:", pop.get("title"), pop.get("url"))

    pw = connect(pop)
    send(pw, 1, "Runtime.enable")
    send(pw, 2, "Page.enable")
    time.sleep(2)  # let the moved section settle

    state = evaluate(pw, """(() => {
      const de = document.documentElement;
      const sec = document.querySelector('details.test-section');
      const gas = [...document.querySelectorAll('summary, b, span')]
        .find(e => /gas & heat jet/i.test(e.textContent) && e.children.length === 0);
      return JSON.stringify({
        scrollHeight: de.scrollHeight,
        clientHeight: de.clientHeight,
        overflowY: getComputedStyle(de).overflowY,
        bodyOverflow: getComputedStyle(document.body).overflow,
        barHeight: sec ? sec.getBoundingClientRect().height : null,
        gasFound: !!gas
      });
    })()""")
    s = json.loads(state)
    print(f"popup doc: scrollHeight={s['scrollHeight']} clientHeight={s['clientHeight']} "
          f"overflowY={s['overflowY']} bodyOverflow={s['bodyOverflow']} "
          f"barHeight={s['barHeight']} gasFound={s['gasFound']}")

    can_scroll = s["scrollHeight"] > s["clientHeight"]
    print("scrollable:", can_scroll)

    if can_scroll:
        bottom = evaluate(pw, """(() => {
          window.scrollTo(0, 1e6);
          const gas = [...document.querySelectorAll('summary, b, span, h3')]
            .find(e => /gas & heat jet/i.test(e.textContent) && e.children.length === 0);
          const r = gas ? gas.getBoundingClientRect() : null;
          return JSON.stringify({ scrollY: Math.round(window.scrollY),
            gasTop: r ? Math.round(r.top) : null,
            gasVisible: r ? (r.top < innerHeight && r.bottom > 0) : false });
        })()""")
        b = json.loads(bottom)
        print(f"after scrollTo bottom: scrollY={b['scrollY']} gasTop={b['gasTop']} gasVisible={b['gasVisible']}")
        shot = send(pw, 8, "Page.captureScreenshot", format="png")
        if shot.get("data"):
            with open(OUT, "wb") as f:
                f.write(base64.b64decode(shot["data"]))
            print("saved", OUT)
        passed = b["gasVisible"] and b["scrollY"] > 0
    else:
        # window happened to fit the whole bar — emulate the user's SHORTER
        # window (their content was clipped): shrink the viewport and retry
        print("bar fits at this window size — emulating a shorter (600px) window")
        send(pw, 9, "Emulation.setDeviceMetricsOverride", width=760, height=600,
             deviceScaleFactor=0, mobile=False)
        time.sleep(1)
        state2 = evaluate(pw, """(() => {
          const de = document.documentElement;
          return JSON.stringify({ scrollHeight: de.scrollHeight,
            clientHeight: de.clientHeight });
        })()""")
        s2 = json.loads(state2)
        print(f"at 600px: scrollHeight={s2['scrollHeight']} clientHeight={s2['clientHeight']} "
              f"scrollable={s2['scrollHeight'] > s2['clientHeight']}")
        bottom = evaluate(pw, """(() => {
          window.scrollTo(0, 1e6);
          const gas = [...document.querySelectorAll('summary, b, span, h3')]
            .find(e => /gas & heat jet/i.test(e.textContent) && e.children.length === 0);
          const r = gas ? gas.getBoundingClientRect() : null;
          return JSON.stringify({ scrollY: Math.round(window.scrollY),
            gasTop: r ? Math.round(r.top) : null,
            gasVisible: r ? (r.top < innerHeight && r.bottom > 0) : false });
        })()""")
        b = json.loads(bottom)
        print(f"after scrollTo bottom: scrollY={b['scrollY']} gasTop={b['gasTop']} gasVisible={b['gasVisible']}")
        shot = send(pw, 8, "Page.captureScreenshot", format="png")
        if shot.get("data"):
            with open(OUT.replace('.png', '_bottom.png'), "wb") as f:
                f.write(base64.b64decode(shot["data"]))
            print("saved", OUT.replace('.png', '_bottom.png'))
        # NOTE: under device-metrics emulation clientHeight can read stale;
        # the user-facing truth is: did scrolling reveal the bottom controls?
        passed = b["gasVisible"] and b["scrollY"] > 0

    print("RESULT:", "PASS" if passed else "FAIL")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
