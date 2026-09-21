// ===== Experiment List wiring (additive; classic script, no imports) =====
"use strict";
(function () {
  const CH = new BroadcastChannel("fly-demon-experiments");
  const cards = {};
  document.querySelectorAll(".exp-card").forEach(c => cards[c.dataset.exp] = c);

  let plotsWin = null;
  function openPlots() {
    if (plotsWin && !plotsWin.closed) { plotsWin.focus(); return; }
    plotsWin = window.open("experiment_plots.html", "fly_demon_plots",
                           "width=980,height=760,menubar=no,toolbar=no");
  }
  document.getElementById("btnOpenPlots").addEventListener("click", openPlots);

  function drawSpark(canvas, curve) {
    const g = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height, pad = 4;
    g.clearRect(0, 0, W, H);
    if (!curve || !curve.length) return;
    // aggregate: mean agreement per block across conditions
    const byB = new Map();
    for (const p of curve) {
      if (p.agree === null || p.agree === undefined) continue;
      if (!byB.has(p.block)) byB.set(p.block, []);
      byB.get(p.block).push(p.agree);
    }
    const xs = [...byB.keys()].sort((a, b) => a - b);
    if (!xs.length) return;
    const pts = xs.map(b => [b, byB.get(b).reduce((a, c) => a + c, 0) / byB.get(b).length]);
    let ymin = Infinity, ymax = -Infinity;
    for (const [, y] of pts) { ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); }
    if (ymax - ymin < 0.05) { const m = (ymax + ymin) / 2; ymin = m - 0.05; ymax = m + 0.05; }
    const xw = Math.max(xs[xs.length - 1] - xs[0], 1);
    g.strokeStyle = "#30363d"; g.lineWidth = 1;
    g.beginPath(); g.moveTo(pad, H / 2); g.lineTo(W - pad, H / 2); g.stroke();
    g.strokeStyle = "#d29922"; g.lineWidth = 1.6; g.beginPath();
    let hx = pad, hy = H / 2;
    pts.forEach(([x, y], i) => {
      const px = pad + (x - xs[0]) / xw * (W - 2 * pad);
      const py = pad + (1 - (y - ymin) / (ymax - ymin)) * (H - 2 * pad);
      if (i) g.lineTo(px, py); else g.moveTo(px, py);
      hx = px; hy = py;
    });
    g.stroke();
    g.fillStyle = "#3fb950"; g.beginPath(); g.arc(hx, hy, 2.5, 0, 7); g.fill();
  }

  // One worker, one experiment at a time (keeps CPU sane); queue the rest.
  let worker = null, current = null;
  const queue = [];
  function startNext() {
    if (worker || !queue.length) return;
    const expId = queue.shift();
    const card = cards[expId];
    current = expId;
    worker = new Worker("experiment_worker.js");
    worker.onmessage = (ev) => handleMsg(expId, ev.data);
    worker.onerror = (e) => {
      setStatus(expId, "error", "worker error: " + (e.message || "unknown"));
      worker = null; current = null; startNext();
    };
    clearVerdicts(expId);
    setStatus(expId, "running", "starting…");
    card.classList.add("running");
    worker.postMessage({ type: "run", expId,
                         circuit: window.__expCircuit || null, opts: {} });
  }

  function setStatus(expId, cls, text) {
    const el = cards[expId].querySelector(".exp-status");
    el.className = "exp-status " + (cls === "idle" ? "" : cls);
    el.textContent = text;
    const card = cards[expId];
    card.classList.remove("running", "done", "error");
    if (cls !== "idle") card.classList.add(cls);
  }

  // ---- live verdict chips (compact predictions-vs-observations) -------------
  // Four signals from the streaming block curve; full CI-aware checklist lives
  // in the plots window. Verdicts appear once >=3 blocks are recorded.
  function blockMeans(curve, field) {
    const byB = new Map();
    for (const pt of curve) {
      const v = pt[field];
      if (v === null || v === undefined || !Number.isFinite(v)) continue;
      if (!byB.has(pt.block)) byB.set(pt.block, []);
      byB.get(pt.block).push(v);
    }
    const bs = [...byB.keys()].sort((a, b) => a - b);
    return bs.map(b => byB.get(b).reduce((x, y) => x + y, 0) / byB.get(b).length);
  }
  function evaluateLiveVerdicts(curve) {
    if (!curve || curve.length < 3) return null;   // not enough blocks yet
    const chips = [];
    // 1) learning trend: late-half vs early-half mean agreement per condition
    const conds = [...new Set(curve.map(pt => pt.cond))];
    let up = 0, tot = 0;
    for (const c of conds) {
      const a = blockMeans(curve.filter(pt => pt.cond === c), "agree");
      if (a.length < 3) continue;
      const h = Math.floor(a.length / 2);
      const early = a.slice(0, h).reduce((x, y) => x + y, 0) / h;
      const late = a.slice(-h).reduce((x, y) => x + y, 0) / h;
      if (late > early) up++;
      tot++;
    }
    if (tot) chips.push({ txt: (up > tot / 2 ? "▲" : up < tot / 2 ? "▼" : "→") + ` learning ${up}/${tot}`,
                          cls: up > tot / 2 ? "ok" : up < tot / 2 ? "bad" : "amb" });
    // 2) sort selectivity: latest good:bad (null when no bad crossings yet)
    const gb = blockMeans(curve, "goodBadRatio").slice(-1)[0];
    if (gb !== undefined) chips.push({ txt: "⤢ sel " + gb.toFixed(2),
                                       cls: gb > 1.5 ? "ok" : gb > 0.9 ? "amb" : "bad" });
    // 3) temperature gradient: latest ΔT
    const dts = blockMeans(curve, "dT");
    if (dts.length) {
      const dT = dts[dts.length - 1];
      chips.push({ txt: "ΔT " + dT.toFixed(1), cls: dT > 0.5 ? "ok" : dT < -0.5 ? "bad" : "amb" });
    }
    // 4) gate economy: latest open fraction (selective < 50%)
    const ofs = blockMeans(curve, "openFraction");
    if (ofs.length) {
      const of = ofs[ofs.length - 1];
      chips.push({ txt: "gate " + Math.round(of * 100) + "%",
                   cls: of < 0.5 ? "ok" : of < 0.8 ? "amb" : "bad" });
    }
    return chips;
  }
  function renderVerdicts(expId, curve) {
    const wrap = cards[expId].querySelector(".exp-verdicts");
    if (!wrap) return;
    const chips = evaluateLiveVerdicts(curve);
    if (!chips) { wrap.innerHTML = '<span class="chip">collecting blocks…</span>'; return; }
    wrap.innerHTML = chips.map(c => `<span class="chip ${c.cls}">${c.txt}</span>`).join("");
  }
  function clearVerdicts(expId) {
    const wrap = cards[expId] && cards[expId].querySelector(".exp-verdicts");
    if (wrap) wrap.innerHTML = "";
  }

  function handleMsg(expId, m) {
    if (m.type === "progress") {
      window.EXP = window.EXP || {};
      EXP.activeId = expId;
      EXP.activeKind = ({ e2: "learning", e3: "learning", e4: "learning",
                          e5: "learning", e7: "sensory", e8: "gate" })[expId] || null;
      setStatus(expId, "running",
        `${m.phase} ${m.trial + 1}/${m.nTrials} · seed ${m.seedIdx + 1}/${m.nSeeds}`);
      drawSpark(cards[expId].querySelector(".exp-spark"), m.curve || []);
      renderVerdicts(expId, m.curve || []);
      CH.postMessage({ kind: "plots", type: "progress", expId,
                       label: m.label || expId.toUpperCase(), curve: m.curve,
                       phase: m.phase, trial: m.trial, nTrials: m.nTrials,
                       seedIdx: m.seedIdx, nSeeds: m.nSeeds });
    } else if (m.type === "done") {
      setStatus(expId, "done",
        `done ✓ ${m.rows.length} trials · ${(m.provenance.elapsedSeconds || 0).toFixed(0)}s`);
      drawSpark(cards[expId].querySelector(".exp-spark"),
                (m.summary && m.summary.curve) || []);
      renderVerdicts(expId, (m.summary && m.summary.curve) || m.curve || []);
      CH.postMessage({ kind: "plots", type: "done", expId,
                       label: m.provenance.label || expId.toUpperCase(),
                       summary: m.summary, rows: m.rows, provenance: m.provenance });
      worker.terminate(); worker = null; current = null; startNext();
      sixStep(expId);
    } else if (m.type === "error") {
      setStatus(expId, "error", String(m.message).split("\n")[0].slice(0, 90));
      CH.postMessage({ kind: "plots", type: "session_error", expId });
      worker.terminate(); worker = null; current = null; startNext();
      sixStep(expId);
    }
  }

  document.querySelectorAll(".exp-card .exp-run").forEach(btn => {
    btn.addEventListener("click", () => {
      const expId = btn.closest(".exp-card").dataset.exp;
      if (current === expId || queue.includes(expId)) return;  // already going
      queue.push(expId);
      openPlots();                       // pop the plots window so it's ready
      setStatus(expId, "running", "queued…");
      startNext();
    });
  });

  // ---- run-all-six session: queue E2,E3,E4,E5,E7,E8 and animate the figure --
  const SIX_IDS = ["e2", "e3", "e4", "e5", "e7", "e8"];
  const btnAll = document.getElementById("btnRunAllSix");
  let sixLeft = 0;
  const sixSet = new Set();
  btnAll.addEventListener("click", () => {
    if (sixLeft > 0) return;                    // session already running
    const queuedIds = [];
    for (const id of SIX_IDS) {
      if (current === id || queue.includes(id)) continue;
      queue.push(id); queuedIds.push(id);
    }
    const toast = (typeof msg === "function") ? msg : (window.__labMsg || (() => {}));
    if (!queuedIds.length) { toast("all six experiments already queued/running", 2500); return; }
    sixSet.clear(); queuedIds.forEach(id => sixSet.add(id));
    sixLeft = queuedIds.length;
    btnAll.disabled = true;
    btnAll.textContent = "⏳ session: " + sixLeft + " to go…";
    openPlots();
    // let the plots window open, then announce the session
    setTimeout(() => CH.postMessage({ kind: "plots", type: "session_begin",
                                      expIds: queuedIds }), 350);
    toast("▶▶ session started: six experiments queued — watch the figure build in the plots window", 4000);
    startNext();
  });
  function sixStep(expId) {
    if (sixLeft <= 0 || !sixSet.has(expId)) return;   // not a session member
    sixLeft--;
    if (sixLeft > 0) {
      btnAll.textContent = "⏳ session: " + sixLeft + " to go…";
    } else {
      btnAll.disabled = false;
      btnAll.textContent = "▶▶ run all six · animate figure";
      CH.postMessage({ kind: "plots", type: "session_end" });
    }
  }
})();
