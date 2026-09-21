# Patch 15: one play button per experiment-list lab header.
# Click = queue the whole lab (one queued background session), open the live
# plots window and animate the session figure panel-by-panel (same pipeline
# as "run all six", scoped to one department). Empty labs (Quantum / Real
# Demons) get the button too and answer with a "coming soon" toast.
import io, sys

P = "fly_demon_3d.html"
src = io.open(P, encoding="utf-8").read()
n0 = len(src)
edits = []


def rep(old, new, count=1):
    n = src.count(old)
    if n != count:
        print("FAIL: expected %d occurrence(s), found %d for:\n%s" % (count, n, ascii(old[:120])))
        sys.exit(1)
    edits.append((old, new))


def rep_end():
    global src
    for old, new in edits:
        src = src.replace(old, new, 1)
    edits.clear()


# ---- 1) CSS: play button style + summary flex gap ---------------------------
rep(
    '''  .exp-lab > summary { list-style: none; cursor: pointer; padding: 6px 10px;
             font-size: 12px; user-select: none; display: flex; align-items: center; }
  .exp-lab > summary::-webkit-details-marker { display: none; }
  .exp-lab > summary::after { content: "\\25BE"; margin-left: auto; color: #8b949e; }''',
    '''  .exp-lab > summary { list-style: none; cursor: pointer; padding: 6px 10px;
             font-size: 12px; user-select: none; display: flex; align-items: center; gap: 8px; }
  .exp-lab > summary::-webkit-details-marker { display: none; }
  .exp-lab > summary::after { content: "\\25BE"; margin-left: 0; color: #8b949e; }
  /* per-lab play button (patch 15): run a whole department in one click */
  .lab-run { background: #238636; color: #fff; border: 0; border-radius: 6px;
             width: 26px; height: 22px; margin-left: auto; cursor: pointer;
             font-size: 11px; line-height: 1; flex: 0 0 auto; }
  .lab-run:hover:not(:disabled) { background: #2ea043; }
  .lab-run:disabled { background: #30363d; color: #8b949e; cursor: default; }''',
)
rep_end()

# ---- 2) HTML: one play button in each lab header -----------------------------
rep(
    '''    <details class="exp-lab" data-lab="demon" open>
      <summary>\U0001F9EA DEMON LAB</summary>''',
    '''    <details class="exp-lab" data-lab="demon" open>
      <summary>\U0001F9EA DEMON LAB<button class="lab-run" title="Run the whole DEMON LAB (E1, E6, E7, E9, E10, E11) in one queued session">\u25B6</button></summary>''',
)
rep(
    '''    <details class="exp-lab" data-lab="information" open>
      <summary>\U0001F9E0 INFORMATION LAB</summary>''',
    '''    <details class="exp-lab" data-lab="information" open>
      <summary>\U0001F9E0 INFORMATION LAB<button class="lab-run" title="Run the whole INFORMATION LAB (E2, E8) in one queued session">\u25B6</button></summary>''',
)
rep(
    '''    <details class="exp-lab" data-lab="flybrain" open>
      <summary>\U0001FAB0 FLY BRAIN</summary>''',
    '''    <details class="exp-lab" data-lab="flybrain" open>
      <summary>\U0001FAB0 FLY BRAIN<button class="lab-run" title="Run the whole FLY BRAIN lab (E3, E4, E5) in one queued session">\u25B6</button></summary>''',
)
rep(
    '''    <details class="exp-lab" data-lab="quantum">
      <summary>\u269B QUANTUM LAB</summary>''',
    '''    <details class="exp-lab" data-lab="quantum">
      <summary>\u269B QUANTUM LAB<button class="lab-run" title="Quantum Lab \u2014 future experiments, coming soon">\u25B6</button></summary>''',
)
rep(
    '''    <details class="exp-lab" data-lab="realdemons">
      <summary>\U0001F52C REAL DEMONS</summary>''',
    '''    <details class="exp-lab" data-lab="realdemons">
      <summary>\U0001F52C REAL DEMONS<button class="lab-run" title="Real Demons \u2014 future real-world setups, coming soon">\u25B6</button></summary>''',
)
rep_end()

# ---- 3) worker.onerror: keep session bookkeeping alive on a crashed worker ---
rep(
    '''    worker.onerror = (e) => {
      setStatus(expId, "error", "worker error: " + (e.message || "unknown"));
      worker = null; current = null; startNext();
    };''',
    '''    worker.onerror = (e) => {
      setStatus(expId, "error", "worker error: " + (e.message || "unknown"));
      worker = null; current = null; startNext();
      sixStep(expId);        // (patch 15) crashed member still counts down a session
    };''',
)
rep_end()

# ---- 4) generalize the session bookkeeping to a per-lab owning button --------
rep(
    '''  let sixLeft = 0;
  const sixSet = new Set();''',
    '''  let sixLeft = 0;
  let sixBtn = null;             // (patch 15) button that owns the active session
  const sixSet = new Set();''',
)
rep(
    '''    sixSet.clear(); queuedIds.forEach(id => sixSet.add(id));
    sixLeft = queuedIds.length;
    btnAll.disabled = true;''',
    '''    sixSet.clear(); queuedIds.forEach(id => sixSet.add(id));
    sixLeft = queuedIds.length;
    sixBtn = btnAll;            // (patch 15) this session is owned by btnAll
    btnAll.disabled = true;''',
)
rep(
    '''  function sixStep(expId) {
    if (sixLeft <= 0 || !sixSet.has(expId)) return;   // not a session member
    sixLeft--;
    if (sixLeft > 0) {
      btnAll.textContent = "\u23F3 session: " + sixLeft + " to go\u2026";
    } else {
      btnAll.disabled = false;
      btnAll.textContent = "\u25B6\u25B6 run all six \u00B7 animate figure";
      CH.postMessage({ kind: "plots", type: "session_end" });
    }
  }''',
    '''  function sixStep(expId) {
    if (sixLeft <= 0 || !sixSet.has(expId)) return;   // not a session member
    sixLeft--;
    if (sixLeft > 0) {
      if (sixBtn === btnAll) btnAll.textContent = "\u23F3 session: " + sixLeft + " to go\u2026";
    } else {
      if (sixBtn && sixBtn !== btnAll) {              // (patch 15) per-lab session
        sixBtn.disabled = false;
        sixBtn.textContent = "\u25B6";
        sixBtn.title = sixBtn.dataset.title || sixBtn.title;
      } else {
        btnAll.disabled = false;
        btnAll.textContent = "\u25B6\u25B6 run all six \u00B7 animate figure";
      }
      sixBtn = null;
      CH.postMessage({ kind: "plots", type: "session_end" });
    }
  }''',
)
rep_end()

# ---- 5) per-lab play-button wiring (after the run-all-six block) -------------
rep(
    '''    toast("\u25B6\u25B6 session started: six experiments queued \u2014 watch the figure build in the plots window", 4000);
    startNext();
  });
  // ---- Apparatus stages for E9/E10/E11 (patch 14) ---------------------------''',
    '''    toast("\u25B6\u25B6 session started: six experiments queued \u2014 watch the figure build in the plots window", 4000);
    startNext();
  });

  // ---- per-lab play buttons: run one whole department (patch 15) -------------
  // One click queues every experiment of that lab in run order, opens the live-
  // plots window and animates the session figure panel-by-panel \u2014 the same
  // pipeline as "run all six", scoped to a single lab.
  const LAB_RUN_TITLES = {
    demon: "Run the whole DEMON LAB (E1, E6, E7, E9, E10, E11) in one queued session",
    information: "Run the whole INFORMATION LAB (E2, E8) in one queued session",
    flybrain: "Run the whole FLY BRAIN lab (E3, E4, E5) in one queued session",
    quantum: "Quantum Lab \u2014 future experiments, coming soon",
    realdemons: "Real Demons \u2014 future real-world setups, coming soon",
  };
  document.querySelectorAll("details.exp-lab").forEach(lab => {
    const btn = lab.querySelector("summary .lab-run");
    if (!btn) return;
    btn.dataset.title = LAB_RUN_TITLES[lab.dataset.lab] || btn.title;
    btn.title = btn.dataset.title;
    btn.addEventListener("click", (ev) => {
      ev.preventDefault(); ev.stopPropagation();  // don't fold the lab panel
      const toast = (typeof msg === "function") ? msg : (window.__labMsg || (() => {}));
      const labName = (lab.querySelector("summary").firstChild.textContent || "").trim();
      const ids = [...lab.querySelectorAll(".exp-card[data-exp]")]
        .map(c => c.dataset.exp).filter(id => cards[id]);
      if (!ids.length) {                       // future labs: nothing to run yet
        toast(labName + ": no runnable experiments yet \u2014 coming soon", 3000);
        return;
      }
      const queuedIds = [];
      for (const id of ids) {
        if (current === id || queue.includes(id)) continue;
        queue.push(id); queuedIds.push(id);
      }
      if (!queuedIds.length) {
        toast(labName + ": all experiments already queued/running", 2500);
        return;
      }
      if (sixLeft > 0) {       // a session is already animating; queue after it
        openPlots();
        toast("\u25B6 " + queuedIds.map(e => e.toUpperCase()).join(" \u2192 ") +
              " queued \u2014 the running session finishes first", 3500);
        startNext();
        return;
      }
      sixSet.clear(); queuedIds.forEach(id => sixSet.add(id));
      sixLeft = queuedIds.length;
      sixBtn = btn;
      btn.disabled = true;
      btn.textContent = "\u23F3";
      openPlots();
      // let the plots window open, then announce the session
      setTimeout(() => CH.postMessage({ kind: "plots", type: "session_begin",
                                        expIds: queuedIds }), 350);
      toast("\u25B6 " + labName + " session started: " +
            queuedIds.map(e => e.toUpperCase()).join(" \u2192 ") +
            " \u2014 watch the figure build in the plots window", 4500);
      startNext();
    });
  });
  // ---- Apparatus stages for E9/E10/E11 (patch 14) ---------------------------''',
)
rep_end()

io.open(P, "w", encoding="utf-8", newline="").write(src)
print("patched OK: %d -> %d chars (%+d)" % (n0, len(src), len(src) - n0))
