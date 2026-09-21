import io
p = "experiment_plots.html"
d = io.open(p, "r", encoding="utf-8", newline="").read()
NL = "\n" if "\r\n" not in d else "\r\n"
def nl(s): return s.replace("\r\n", "\n").replace("\n", NL)
def rep(old, new, n=1):
    global d
    old, new = nl(old), nl(new)
    c = d.count(old)
    assert c == n, "anchor x%d (want %d): %r" % (c, n, old[:90])
    d = d.replace(old, new)

# ---- 1. HTML card after the anatomy-map card ------------------------------
rep('''    <div class="card" style="grid-column: 1 / -1;"><h2>Predictions vs observations</h2>''',
'''    <div class="card" style="grid-column: 1 / -1;"><h2>Brain outcome — 3D CT anatomy (see-through fly, live firing)</h2>
      <div class="sub">The real adult-fruit-fly CT scan with the run's actual per-neuron firing
      rendered <i>inside</i> the head at real FAFB positions — the same signal as the main screen —
      wired by the real connectome, showing firing paths between neurons that actually fired.
      One view per condition; drag to orbit, wheel to zoom.</div>
      <div id="ct3dChips" style="display:flex; flex-wrap:wrap; gap:6px; margin:8px 0 10px"></div>
      <div id="ct3dMount" style="position:relative; width:100%; aspect-ratio:16/8.2; min-height:360px;
           border:1px solid #30363d; border-radius:8px; overflow:hidden; background:#05070d">
        <div id="ct3dLoad" style="position:absolute; inset:0; display:flex; align-items:center;
             justify-content:center; color:#8b98a5; font:13px ui-sans-serif,system-ui">
          loading CT scan (38 MB) — one moment…
        </div>
      </div>
      <div id="ct3dLegend" style="color:#8b98a5; font:11.5px ui-sans-serif,system-ui; margin-top:6px"></div>
    </div>
    <div class="card" style="grid-column: 1 / -1;"><h2>Predictions vs observations</h2>''')

# ---- 2. done hook: feed the 3D panel --------------------------------------
rep('''    const ANAT_FIGS = renderAnatMaps(LAST_ROWS, LABEL);
    if (ANAT_FIGS && ANAT_FIGS.length) renderBrainEmpty();   // anat maps shown; skip block heatmap
    else renderBrain();                                      // no-anatomy fallback''',
'''    const ANAT_FIGS = renderAnatMaps(LAST_ROWS, LABEL);
    if (ANAT_FIGS && ANAT_FIGS.length) renderBrainEmpty();   // anat maps shown; skip block heatmap
    else renderBrain();                                      // no-anatomy fallback
    if (window.__ct3dBrain) window.__ct3dBrain.showRun(LAST_ROWS, LABEL);''')

# ---- 3. export hooks for the module script --------------------------------
rep('''window.__sixTest = handleSixMsg;   // debug handle for in-page verification''',
'''window.__sixTest = handleSixMsg;   // debug handle for in-page verification
window.__ct3dHooks = { fireVecFor, condMeanRates, label: () => LABEL };''')

io.open(p, "w", encoding="utf-8", newline="").write(d)
print("patch A ok")
