#!/usr/bin/env python3
"""End-to-end verify the LOG plot time series (user request).

Flow: open the app -> click the LOG button (user-gesture click) -> let the
10 Hz sampler run past the first capture -> inspect chemLogPlotBuf live ->
click LOG again to save -> find the downloaded zip -> assert PlotFlyPath_*/
PlotBrainMap_* entries exist with real JPEG bytes.
"""
import base64, glob, json, os, time, urllib.parse, urllib.request, zipfile
import websocket

BASE = "http://127.0.0.1:9333"
APP = "http://127.0.0.1:8879/fly_demon_3d.html?cdp=1&v=logplot1"
DL = os.path.join(os.environ.get("TEMP", "/tmp"), "logtest_dl")


def http_json(path, method="GET"):
    req = urllib.request.Request(BASE + path, method=method)
    body = urllib.request.urlopen(req, timeout=20).read()
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


def evaluate(ws, expr, gesture=False, await_promise=False):
    r = send(ws, 7, "Runtime.evaluate", expression=expr, returnByValue=True,
             awaitPromise=await_promise, userGesture=gesture)
    inner = r.get("result", {}).get("result", r.get("result", {}))
    return inner.get("value")


def main():
    os.makedirs(DL, exist_ok=True)
    for f in glob.glob(os.path.join(DL, "*.zip")):
        os.remove(f)
    # fresh tab
    for t in http_json("/json/list"):
        if t.get("type") == "page" and "fly_demon_3d" in t.get("url", ""):
            http_json("/json/close/" + t["id"])
    time.sleep(1)
    info = http_json("/json/new?" + urllib.parse.quote(APP, safe=""), method="PUT")
    ws = connect(info)
    send(ws, 1, "Runtime.enable")
    send(ws, 2, "Page.enable")
    send(ws, 30, "Browser.setDownloadBehavior", behavior="allow", downloadPath=DL)

    ok = False
    for _ in range(45):
        v = evaluate(ws, "document.readyState + '|' + "
                         "!!document.getElementById('chemLogBtn')")
        if v and v.startswith("complete") and v.endswith("true"):
            ok = True
            break
        time.sleep(1)
    if not ok:
        print("FAIL: app boot never reached LOG-ready state"); return 1
    print("app booted, LOG button ready")
    time.sleep(3)   # let the boot IIFE + first frames settle

    evaluate(ws, "document.getElementById('chemLogBtn').click()", gesture=True)
    recording = False
    for _ in range(10):
        v = evaluate(ws, "document.getElementById('chemLogBtn').classList.contains('rec')")
        if v is True:
            recording = True
            break
        time.sleep(0.5)
    if not recording:
        print("FAIL: LOG button never entered recording state"); return 1
    print("LOG started — waiting ~7 s for captures (first sample + 5 s tick)")
    time.sleep(7)

    # plot windows must NOT have been force-opened (hidden capture)
    hidden = evaluate(ws, """JSON.stringify({
      ftOpen: !!document.querySelector('#flyTrailWin.open'),
      bmOpen: !!document.querySelector('#brainMapWin.open'),
      ftExists: !!document.querySelector('#flyTrailCv'),
      bmExists: !!document.querySelector('#brainMapCv') })""")
    print("plot windows during capture (open should be false):", hidden)

    evaluate(ws, "document.getElementById('chemLogBtn').click()", gesture=True)
    print("LOG stopped — waiting for the zip download")
    zip_path = None
    for _ in range(20):
        zips = glob.glob(os.path.join(DL, "*.zip"))
        if zips:
            zip_path = max(zips, key=os.path.getmtime)
            break
        time.sleep(1)
    if not zip_path:
        print("FAIL: no zip downloaded (headless may block downloads)"); return 1
    print("zip:", os.path.basename(zip_path),
          f"{os.path.getsize(zip_path)//1024} KB")
    with zipfile.ZipFile(zip_path) as z:
        names = z.namelist()
        pf = [n for n in names if "PlotFlyPath_" in n]
        pb = [n for n in names if "PlotBrainMap_" in n]
        print(f"  zip entries: {len(names)} total | PlotFlyPath: {len(pf)} | "
              f"PlotBrainMap: {len(pb)}")
        for n in (pf[:1] + pb[:1]):
            head = z.read(n)[:3]
            jpeg_magic = (head == b'\xff\xd8\xff')
            print(f"  {n.split('/')[-1]}: {z.getinfo(n).file_size//1024} KB, "
                  f"JPEG magic={jpeg_magic}")
        csv_name = next(n for n in names if n.endswith(".csv") and "fly_log" in n)
        lines = z.read(csv_name).decode("utf-8", "replace").splitlines()
        head = lines[0].split(",")
        print("  csv columns tail:", head[-5:])
        # --- demon gatekeeper state column (user request) ---
        di = head.index("demon") if "demon" in head else -1
        states = {row.split(",")[di] for row in lines[1:] if row.strip() and di >= 0}
        valid = states <= {"WATCH", "ATTEND", "HOLD", "STRIKE", "RECOIL", ""}
        print(f"  demon column: {'present' if di >= 0 else 'MISSING'} at index {di} | "
              f"values seen: {sorted(s for s in states if s)} | valid={valid}")
        demon_ok = di >= 0 and valid and any(s for s in states if s)
        # --- verdict + crossEvent columns (user request) ---
        vi = head.index("verdict") if "verdict" in head else -1
        ci = head.index("crossEvent") if "crossEvent" in head else -1
        verdicts, crosses = set(), set()
        for row in lines[1:]:
            if not row.strip():
                continue
            cells = row.split(",")
            if vi >= 0 and len(cells) > vi:
                verdicts.add(cells[vi])
            if ci >= 0 and len(cells) > ci:
                crosses.add(cells[ci])
        v_ok = vi >= 0 and verdicts <= {"REWARD", "PENALTY", ""} and \
            any(v for v in verdicts if v)
        # crossEvent cells: '' or ';'-joined good/bad
        c_ok = ci >= 0 and all(
            set(tok for tok in c.split(";") if tok) <= {"good", "bad"} for c in crosses)
        n_cross = sum(1 for row in lines[1:]
                      if row.strip() and len(row.split(",")) > ci and row.split(",")[ci])
        print(f"  verdict column: {'present' if vi >= 0 else 'MISSING'} | "
              f"values seen: {sorted(v for v in verdicts if v)} | valid={v_ok}")
        print(f"  crossEvent column: {'present' if ci >= 0 else 'MISSING'} | "
              f"marked rows: {n_cross} | values seen: {sorted(c for c in crosses if c)} | valid={c_ok}")
        demon_ok = demon_ok and v_ok and c_ok
        # --- keeper / gateDriver / selAll / selRecent columns (user request) ---
        ki = head.index("keeper") if "keeper" in head else -1
        gi = head.index("gateDriver") if "gateDriver" in head else -1
        sai = head.index("selAll") if "selAll" in head else -1
        sri = head.index("selRecent") if "selRecent" in head else -1
        keepers, drivers, sel_vals = set(), set(), []
        for row in lines[1:]:
            if not row.strip():
                continue
            cells = row.split(",")
            if ki >= 0 and len(cells) > ki: keepers.add(cells[ki])
            if gi >= 0 and len(cells) > gi: drivers.add(cells[gi])
            for idx in (sai, sri):
                if idx >= 0 and len(cells) > idx and cells[idx]:
                    sel_vals.append(float(cells[idx]))
        keeper_ok = (ki >= 0 and gi >= 0 and sai >= 0 and sri >= 0 and
                     keepers <= {"Demon", "Fly"} and any(keepers) and
                     drivers <= {"Fly brain", "Random", "You (human)"} and any(drivers) and
                     all(0 <= v <= 100 for v in sel_vals))
        print(f"  keeper column: {'present' if ki >= 0 else 'MISSING'} | values: {sorted(keepers)} | "
              f"gateDriver values: {sorted(drivers)} | sel rows: {len(sel_vals)} "
              f"(range {min(sel_vals) if sel_vals else '-'}..{max(sel_vals) if sel_vals else '-'}) | valid={keeper_ok}")
        # --- keeper_performance.csv proof summary ---
        kp_name = next((n for n in names if n.endswith("keeper_performance.csv")), None)
        kp_ok, kp_row, kp_crit = False, None, None
        if kp_name:
            kp_lines = z.read(kp_name).decode("utf-8", "replace").splitlines()
            kp_crit = kp_lines[0].startswith("# keeper performance")
            if len(kp_lines) >= 3:
                kp_cols = kp_lines[1].split(",")
                kp_row = dict(zip(kp_cols, kp_lines[2].split(",")))
                nc = int(kp_row["nCrossings"] or 0)
                kp_ok = (kp_crit and nc >= sum(1 for row in lines[1:] if row.strip()
                                                 and len(row.split(",")) > ci and row.split(",")[ci])
                         and kp_row["learningSuccess"] in ("TRUE", "FALSE", "")
                         and (kp_row["pOneSided"] == "" or 0 <= float(kp_row["pOneSided"]) <= 1))
        print(f"  keeper_performance.csv: {'present' if kp_name else 'MISSING'} | "
              f"criteria header={kp_crit} | summary: " +
              (", ".join(f"{k}={v}" for k, v in (kp_row or {}).items()
                         if k in ('keeper', 'gateDriver', 'nCrossings', 'selAllFinal',
                                  'selRecentFinal', 'pOneSided', 'learningSuccess'))) +
              f" | valid={kp_ok}")
        demon_ok = demon_ok and keeper_ok and kp_ok
        # --- brain_map_rates.csv: numeric per-neuropil time series ---
        np_name = next((n for n in names if n.endswith("brain_map_rates.csv")), None)
        np_csv_ok, np_cols, np_rows_n, sample = False, [], 0, None
        if np_name:
            lines = z.read(np_name).decode("utf-8", "replace").splitlines()
            np_cols = lines[0].split(",")
            data = [l.split(",") for l in lines[1:] if l.strip()]
            np_rows_n = len(data)
            if np_rows_n and len(np_cols) > 5:
                sample = data[-1]
                np_csv_ok = sample[0].replace(".", "").isdigit() and \
                    all(v.replace(".", "").replace("-", "").isdigit() for v in sample[1:])
        print(f"  brain_map_rates.csv: {'present' if np_name else 'MISSING'} | "
              f"columns=1+{len(np_cols) - 1 if np_cols else 0} neuropils | "
              f"rows={np_rows_n} | numeric={np_csv_ok}")
        if np_csv_ok:
            print(f"  last row: t={sample[0]} first-neuropil values: {sample[1:4]}")
        passed = len(pf) >= 1 and len(pb) >= 1 and np_csv_ok and demon_ok
    print("RESULT:", "PASS" if passed else "FAIL")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
