
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
      // non-scalar values ({mean,ci,n} CI points from multi-seed curves) are
      // reduced through their mean so the sparkline stays truthful
      const v = (p.agree && typeof p.agree === "object") ? p.agree.mean : p.agree;
      if (v === null || v === undefined || !Number.isFinite(v)) continue;
      if (!byB.has(p.block)) byB.set(p.block, []);
      byB.get(p.block).push(v);
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
  // (patch 16) per-experiment UI pacing + change-detection for progress msgs
  const EXP_UI = { timer: {}, pending: {}, lastSig: {}, lastCurve: {} }
  function startNext() {
    if (worker || !queue.length) return;
    const expId = queue.shift();
    const card = cards[expId];
    current = expId;
    // cache-bust: the dev server sends no cache headers, so a stale
    // pre-fix worker script could survive file updates across page loads
    worker = new Worker("experiment_worker.js?ts=" + Date.now());
    worker.onmessage = (ev) => handleMsg(expId, ev.data);
    worker.onerror = (e) => {
      setStatus(expId, "error", "worker error: " + (e.message || "unknown"));
      worker = null; current = null; startNext();
      sixStep(expId);        // (patch 15) crashed member still counts down a session
    };
    clearVerdicts(expId);
    setStatus(expId, "running", "starting…");
    card.classList.add("running");
    if (expId === "chat" && window.__chatSpec) {
      worker.postMessage({ type: "run_custom", expId,
                           spec: window.__chatSpec,
                           circuit: window.__expCircuit || null, opts: {} });
    } else {
      worker.postMessage({ type: "run", expId,
                           circuit: window.__expCircuit || null, opts: {} });
    }
  }

  function setStatus(expId, cls, text) {
    const el = cards[expId].querySelector(".exp-status");
    el.className = "exp-status " + (cls === "idle" ? "" : cls);
    el.textContent = text;
    const card = cards[expId];
    card.classList.remove("running", "done", "error");
    if (cls && cls !== "idle") card.classList.add(cls);
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
    if (m.type === "app_state") { const am = APPARATUS_META[expId]; if (am) appFeed(am.env, m.state); return; }
    if (m.type === "progress") {
      // (patch 16) full-speed sim made the page jerky: pace the canvas + DOM +
      // broadcast work on a timer instead of per-message, and skip redraws
      // when nothing visible changed. The status line still updates per beat.
      const appMeta = APPARATUS_META[expId];
      if (appMeta) appActivate(appMeta.env);
      window.EXP = window.EXP || {};
      EXP.activeId = expId;
      EXP.activeKind = ({ e2: "learning", e3: "learning", e4: "learning",
                          e5: "learning", e7: "sensory", e8: "gate" })[expId] || null;
      const label = `${m.phase} ${m.trial + 1}/${m.nTrials} · seed ${m.seedIdx + 1}/${m.nSeeds}`;
      const changed = m.curve !== EXP_UI.lastCurve[expId];
      const sig = label + (changed ? "|*" : "|=");
      setStatus(expId, "running", label);
      EXP_UI.pending[expId] = { m, label, sig, changed };
      if (!EXP_UI.timer[expId]) {
        EXP_UI.timer[expId] = setTimeout(() => {
          const p = EXP_UI.pending[expId];
          delete EXP_UI.pending[expId]; delete EXP_UI.timer[expId];
          if (!p) return;
          if (p.sig === EXP_UI.lastSig[p.m.expId]) return;   // nothing new to draw
          EXP_UI.lastSig[p.m.expId] = p.sig;
          drawSpark(cards[p.m.expId].querySelector(".exp-spark"), p.m.curve || []);
          if (APPARATUS_META[p.m.expId]) clearVerdicts(p.m.expId);
          else renderVerdicts(p.m.expId, p.m.curve || []);
          CH.postMessage({ kind: "plots", type: "progress", expId: p.m.expId,
                           label: p.m.label || p.m.expId.toUpperCase(), curve: p.m.curve,
                           phase: p.m.phase, trial: p.m.trial, nTrials: p.m.nTrials,
                           seedIdx: p.m.seedIdx, nSeeds: p.m.nSeeds });
          if (p.changed) EXP_UI.lastCurve[p.m.expId] = p.m.curve;
        }, 300);
      }
    } else if (m.type === "done") {
      const nTrials = APPARATUS_META[expId]
        ? (m.provenance.trainTrials + m.provenance.testTrials) : m.rows.length;
      setStatus(expId, "done",
        `done ✓ ${nTrials} trials · ${(m.provenance.elapsedSeconds || 0).toFixed(0)}s`);
      drawSpark(cards[expId].querySelector(".exp-spark"),
                (m.summary && m.summary.curve) || []);
      renderVerdicts(expId, (m.summary && m.summary.curve) || m.curve || []);
      chatIndexBrain(expId, m.rows || []);
      CH.postMessage({ kind: "plots", type: "done", expId,
                       label: m.provenance.label || expId.toUpperCase(),
                       summary: m.summary, rows: m.rows, provenance: m.provenance });
      if (APPARATUS_META[expId]) appPlay.doneAt = performance.now();
      worker.terminate(); worker = null; current = null; startNext();
      sixStep(expId);
    } else if (m.type === "error") {
      setStatus(expId, "error", String(m.message).split("\n")[0].slice(0, 90));
      CH.postMessage({ kind: "plots", type: "session_error", expId });
      if (APPARATUS_META[expId]) appRestore();
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
  let sixBtn = null;             // (patch 15) button that owns the active session
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
    sixBtn = btnAll;            // (patch 15) this session is owned by btnAll
    btnAll.disabled = true;
    btnAll.textContent = "⏳ session: " + sixLeft + " to go…";
    openPlots();
    // let the plots window open, then announce the session
    setTimeout(() => CH.postMessage({ kind: "plots", type: "session_begin",
                                      expIds: queuedIds }), 350);
    toast("▶▶ session started: six experiments queued — watch the figure build in the plots window", 4000);
    startNext();
  });

  // ---- per-lab play buttons: run one whole department (patch 15) -------------
  // One click queues every experiment of that lab in run order, opens the live-
  // plots window and animates the session figure panel-by-panel — the same
  // pipeline as "run all six", scoped to a single lab.
  const LAB_RUN_TITLES = {
    demon: "Run the whole DEMON LAB (E1, E6, E7, E9, E10, E11) in one queued session",
    information: "Run the whole INFORMATION LAB (E2, E8) in one queued session",
    flybrain: "Run the whole FLY BRAIN lab (E3, E4, E5) in one queued session",
    quantum: "Quantum Lab — future experiments, coming soon",
    realdemons: "Real Demons — future real-world setups, coming soon",
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
        toast(labName + ": no runnable experiments yet — coming soon", 3000);
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
        toast("▶ " + queuedIds.map(e => e.toUpperCase()).join(" → ") +
              " queued — the running session finishes first", 3500);
        startNext();
        return;
      }
      sixSet.clear(); queuedIds.forEach(id => sixSet.add(id));
      sixLeft = queuedIds.length;
      sixBtn = btn;
      btn.disabled = true;
      btn.textContent = "⏳";
      openPlots();
      // let the plots window open, then announce the session
      setTimeout(() => CH.postMessage({ kind: "plots", type: "session_begin",
                                        expIds: queuedIds }), 350);
      toast("▶ " + labName + " session started: " +
            queuedIds.map(e => e.toUpperCase()).join(" → ") +
            " — watch the figure build in the plots window", 4500);
      startNext();
    });
  });
  // ---- Apparatus stages for E9/E10/E11 (patch 14) ---------------------------
  // Experiment-specific 3D environments. Each stage is built ONCE at a remote
  // position (APP_STAGE_Y, far below the default world, beyond the fog) and
  // shown by MOVING the camera to it — no existing object is hidden, moved or
  // restyled, so the default scenario stays bit-identical whenever no
  // apparatus experiment is active. On run end (or ESC) the camera and orbit
  // state are restored to their saved values. All motion is driven by
  // app_state messages from the real worker simulation (sim-time paced,
  // wall-clock playback in the page) — the animation is the experiment.
  const APP_STAGE_Y = -2600;
  const APPARATUS_META = {
    e9:  { env: "pressure", kind: "pressure" },
    e10: { env: "trapdoor", kind: "trapdoor" },
    e11: { env: "ratchet",  kind: "ratchet" },
  };
  const __camSave = { orbit: null, target: null, auto: null, active: null };
  const __A = () => window.__appScene;   // module-scoped scene refs (deferred)
  const appPlay = { buf: [], raf: 0, t0: 0, idx: 0, active: null };
  const appStages = {};
  function mkMat(color, opts) {
    return new THREE.MeshStandardMaterial(Object.assign(
      { color, roughness: 0.55, metalness: 0.25 }, opts || {}));
  }
  function appLights(grp) {
    grp.add(new THREE.AmbientLight(0xbfd4ff, 0.85));
    const key = new THREE.DirectionalLight(0xffffff, 1.25);
    key.position.set(320, 640, 460);
    grp.add(key);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.5);
    fill.position.set(-420, -200, -300);
    grp.add(fill);
  }
  function appGlass(w, h, d, x) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.12,
        roughness: 0.2, metalness: 0, side: THREE.BackSide, depthWrite: false }));
    m.position.x = x || 0;
    return m;
  }
  function appParticles(N, color, size) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    const tex = (() => {          // soft round sprite, same language as the chamber gas
      const c = document.createElement("canvas"); c.width = c.height = 64;
      const g = c.getContext("2d");
      const rg = g.createRadialGradient(32, 32, 4, 32, 32, 30);
      rg.addColorStop(0, "rgba(255,255,255,1)");
      rg.addColorStop(0.5, "rgba(255,255,255,0.55)");
      rg.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    const pts = new THREE.Points(geo, new THREE.PointsMaterial(
      { color, size, map: tex, sizeAttenuation: true, transparent: true,
        opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }));
    pts.frustumCulled = false;
    return pts;
  }
  function appMeter(text, x, y, z, w) {
    w = w || 320;
    const cv = document.createElement("canvas"); cv.width = w; cv.height = 56;
    const g = cv.getContext("2d");
    const tex = new THREE.CanvasTexture(cv);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.scale.set(w * 0.5, 28, 1); sp.position.set(x, y, z);
    function set(t) {
      g.clearRect(0, 0, cv.width, cv.height);
      g.fillStyle = "rgba(8,12,20,0.66)"; g.fillRect(0, 0, cv.width, cv.height);
      g.strokeStyle = "rgba(140,170,210,0.35)"; g.strokeRect(1, 1, cv.width - 2, cv.height - 2);
      g.fillStyle = "#d7e5f7"; g.font = "600 26px Consolas, monospace";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(t, cv.width / 2, cv.height / 2);
      tex.needsUpdate = true;
    }
    set(text);
    return { sp, set };
  }
  function appBar(x, z, hMax) {   // vertical temperature bar (scale.y driven)
    const m = new THREE.Mesh(new THREE.BoxGeometry(14, 1, 14), mkMat(0xff7b54));
    m.position.set(x, 0, z); m.userData.hMax = hMax;
    return m;
  }
  // ---- E9 · pressure engine (true to sim: L=900 H=420 D=420 DH=240 PEXT=160)
  function buildPressureStage() {
    const grp = new THREE.Group(); grp.position.set(0, APP_STAGE_Y, 0);
    appLights(grp);
    const L = 900, H = 420, D = 420, DH = 240, PEXT = 160;
    grp.add(appGlass(L + PEXT, H, D, (L + PEXT) / 2 - L / 2));
    const wallMat = mkMat(0x24303f, { metalness: 0.5, roughness: 0.4 });
    const slotTop = new THREE.Mesh(new THREE.BoxGeometry(6, (H - DH) / 2, D), wallMat);
    slotTop.position.set(0, (DH + H) / 4, 0); grp.add(slotTop);
    const slotBot = slotTop.clone(); slotBot.position.y = -(DH + H) / 4; grp.add(slotBot);
    const valve = new THREE.Mesh(new THREE.BoxGeometry(4, DH, DH),
      mkMat(0xd29922, { transparent: true, opacity: 0.6 }));
    grp.add(valve);
    // piston assembly (moves with the plate): plate | rod | load
    const piston = new THREE.Group();
    piston.add(new THREE.Mesh(new THREE.BoxGeometry(8, H, D), mkMat(0x8b949e, { metalness: 0.7, roughness: 0.3 })));
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 180, 10), mkMat(0xadbac7));
    rod.rotation.z = Math.PI / 2; rod.position.x = 94; piston.add(rod);
    const load = new THREE.Mesh(new THREE.BoxGeometry(80, 140, 170), mkMat(0x6e7681));
    load.position.x = 224; piston.add(load);
    piston.position.set(L / 2 + 8, 0, 0); grp.add(piston);
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(8, H, D), wallMat);
    bracket.position.set(L / 2 + PEXT + 66, 0, 0); grp.add(bracket);
    // spring-compression indicator between load back and bracket (scaled bar)
    const spring = new THREE.Mesh(new THREE.BoxGeometry(1, 80, 160), mkMat(0x58a6ff));
    grp.add(spring);
    const parts = appParticles(260, 0xffb36b, 16); grp.add(parts);
    // temperature bars + pressure arrow + meters
    const bl = appBar(-L / 2 + 60, 0, 160), br = appBar(L / 2 - 60, 0, 160);
    grp.add(bl); grp.add(br);
    const arrow = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(60, 6, 6), mkMat(0xf85149));
    shaft.position.x = -30; arrow.add(shaft);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(14, 30, 10), mkMat(0xf85149));
    tip.rotation.z = Math.PI / 2; tip.position.x = -75; arrow.add(tip);
    arrow.position.set(0, H / 2 + 70, 0); grp.add(arrow);
    const mP = appMeter("P₁ — · P₂ —", 0, H / 2 + 150, 0, 380);
    const mW = appMeter("W — · bits —", 0, -H / 2 - 90, 0, 460);
    grp.add(mP.sp); grp.add(mW.sp);
    function onState(s) {
      const n = s.pos.length / 3;
      const arr = parts.geometry.attributes.position.array;
      for (let i = 0; i < n * 3; i++) arr[i] = s.pos[i];
      parts.geometry.attributes.position.needsUpdate = true;
      parts.geometry.setDrawRange(0, n);
      valve.position.y = (s.valve * DH) / 2;
      valve.scale.y = Math.max(0.02, 1 - s.valve);
      piston.position.x = L / 2 + 8 - s.piston;
      const loadBack = L / 2 + 8 - s.piston + 264;
      const gap = Math.max(2, (L / 2 + PEXT + 62) - loadBack);
      spring.position.x = (loadBack + L / 2 + PEXT + 62) / 2;
      spring.scale.x = gap;
      spring.material.color.setHSL(0.55, 0.8, 0.35 + 0.3 * Math.min(1, gap / 150));
      // bars are RELATIVE (1.0 = thermal equilibrium): raw tl/tr are mean-
      // square speeds (~7500) — scaling by them erupted giant pillars through
      // the scene and froze the renderer
      const TL = s.tl / 7500, TR = s.tr / 7500;
      bl.scale.y = 2 + 70 * Math.min(2, TL);
      bl.position.y = bl.scale.y / 2;
      br.scale.y = 2 + 70 * Math.min(2, TR);
      br.position.y = br.scale.y / 2;
      br.material.color.setHSL(0.55 - 0.55 * Math.min(1, TR), 0.85, 0.5);
      const dP = s.pr - s.pl;
      arrow.rotation.z = dP >= 0 ? 0 : Math.PI;
      arrow.scale.x = Math.max(0.15, Math.min(2.2, Math.abs(dP) * 6));
      mP.set("P₁ " + s.pl.toFixed(2) + " · P₂ " + s.pr.toFixed(2) + " · ΔT " + s.dT.toFixed(0));
      mW.set(s.cond + " · W " + (s.workU * 1e-21).toExponential(2) + " J · bits " + s.bits);
    }
    return { grp, onState, cam: { tx: 430, ty: 0, tz: 0, dist: 1750, pitch: 0.26, yaw: -0.55 } };
  }
  // ---- E10 · Brownian trapdoor (true to sim: L=760 H=300 D=300 DH=120)
  function buildTrapdoorStage() {
    const grp = new THREE.Group(); grp.position.set(0, APP_STAGE_Y, 0);
    appLights(grp);
    const L = 760, H = 300, D = 300, DH = 120;
    grp.add(appGlass(L, H, D, 0));
    const wallMat = mkMat(0x24303f, { metalness: 0.5, roughness: 0.4 });
    const slotTop = new THREE.Mesh(new THREE.BoxGeometry(5, (H - DH) / 2, D), wallMat);
    slotTop.position.set(0, (DH + H) / 4, 0); grp.add(slotTop);
    const slotBot = slotTop.clone(); slotBot.position.y = -(DH + H) / 4; grp.add(slotBot);
    // hinged flap: pivot at the slot top, swings up under impacts
    const doorGrp = new THREE.Group(); doorGrp.position.set(0, DH / 2, 0);
    const flap = new THREE.Mesh(new THREE.BoxGeometry(3, DH - 4, DH - 4),
      mkMat(0xd29922, { transparent: true, opacity: 0.75 }));
    flap.position.y = -(DH - 4) / 2; doorGrp.add(flap);
    const hinge = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, DH - 4, 8), mkMat(0xadbac7));
    hinge.rotation.x = Math.PI / 2; doorGrp.add(hinge);
    grp.add(doorGrp);
    const parts = appParticles(220, 0x79c0ff, 13); grp.add(parts);
    const mL = appMeter("L —", -L / 2 - 130, 40, 0, 200);
    const mR = appMeter("R —", L / 2 + 130, 40, 0, 200);
    const mD = appMeter("door — · xings —", 0, H / 2 + 80, 0, 420);
    grp.add(mL.sp); grp.add(mR.sp); grp.add(mD.sp);
    // crossing pulse cones (flash when a crossing is counted)
    const pulseL = new THREE.Mesh(new THREE.ConeGeometry(12, 26, 10),
      new THREE.MeshBasicMaterial({ color: 0x3fb950, transparent: true, opacity: 0 }));
    pulseL.position.set(-70, 0, 0); pulseL.rotation.z = Math.PI; grp.add(pulseL);
    const pulseR = pulseL.clone(); pulseR.position.x = 70; pulseR.rotation.z = 0; grp.add(pulseR);
    let pL = 0, pR = 0, glowL = 0, glowR = 0;
    function onState(s) {
      const n = s.pos.length / 3;
      const arr = parts.geometry.attributes.position.array;
      for (let i = 0; i < n * 3; i++) arr[i] = s.pos[i];
      parts.geometry.attributes.position.needsUpdate = true;
      parts.geometry.setDrawRange(0, n);
      doorGrp.rotation.x = -s.door * 0.9;
      if (s.crossLR !== pL) { pL = s.crossLR; glowL = 1; }
      if (s.crossRL !== pR) { pR = s.crossRL; glowR = 1; }
      glowL *= 0.92; glowR *= 0.92;
      pulseL.material.opacity = glowL; pulseR.material.opacity = glowR;
      mL.set("L " + s.nl + " · T " + s.tl.toFixed(0));
      mR.set("R " + s.nr + " · T " + s.tr.toFixed(0));
      mD.set(s.cond + " · door " + (s.door * 57.3).toFixed(0) + "° · L→R " + s.crossLR + " · R→L " + s.crossRL);
    }
    return { grp, onState, cam: { tx: 0, ty: 0, tz: 0, dist: 760, pitch: 0.14, yaw: 0.4 } };
  }
  // ---- E11 · ratchet & pawl (true to sim: TEETH=24)
  function buildRatchetStage() {
    const grp = new THREE.Group(); grp.position.set(0, APP_STAGE_Y, 0);
    appLights(grp);
    const TEETH = 24;
    const wheel = new THREE.Group();
    wheel.add(new THREE.Mesh(new THREE.TorusGeometry(90, 13, 12, 48), mkMat(0x8b949e, { metalness: 0.7, roughness: 0.3 })));
    for (let i = 0; i < TEETH; i++) {
      const a = (i / TEETH) * Math.PI * 2;
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(6, 20, 6), mkMat(0xc9d1d9, { metalness: 0.6 }));
      tooth.position.set(Math.cos(a) * 102, Math.sin(a) * 102, 0);
      tooth.rotation.z = a + Math.PI / 2 + 0.45;   // asymmetric sawtooth lean
      wheel.add(tooth);
    }
    grp.add(wheel);
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 180, 12), mkMat(0xadbac7));
    axle.rotation.x = Math.PI / 2; grp.add(axle);
    const fly = new THREE.Mesh(new THREE.CylinderGeometry(150, 150, 8, 40),
      new THREE.MeshStandardMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.14, roughness: 0.3 }));
    fly.rotation.x = Math.PI / 2; grp.add(fly);
    // pawl on a top hinge, engaging the teeth
    const pawlGrp = new THREE.Group(); pawlGrp.position.set(-12, 128, 0);
    const pawl = new THREE.Mesh(new THREE.BoxGeometry(10, 58, 9), mkMat(0xd29922));
    pawl.position.y = -29; pawlGrp.add(pawl);
    const pHinge = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 16, 8), mkMat(0xadbac7));
    pHinge.rotation.x = Math.PI / 2; pawlGrp.add(pHinge);
    grp.add(pawlGrp);
    // thermal reservoirs (glow tracks Th / Tc)
    const hot = new THREE.Mesh(new THREE.BoxGeometry(56, 110, 56),
      new THREE.MeshStandardMaterial({ color: 0x7f1d1d, emissive: 0xff5040, emissiveIntensity: 0.6, roughness: 0.5 }));
    hot.position.set(-220, -20, 0); grp.add(hot);
    const cold = new THREE.Mesh(new THREE.BoxGeometry(56, 110, 56),
      new THREE.MeshStandardMaterial({ color: 0x1d3a7f, emissive: 0x4090ff, emissiveIntensity: 0.6, roughness: 0.5 }));
    cold.position.set(220, -20, 0); grp.add(cold);
    // load: weight on a string off the axle — rises as the ratchet does work
    const string = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 1, 6), mkMat(0xc9d1d9));
    grp.add(string);
    const weight = new THREE.Mesh(new THREE.BoxGeometry(46, 46, 46), mkMat(0x6e7681, { metalness: 0.4 }));
    grp.add(weight);
    const mS = appMeter("ω — · fwd/rev —", 0, 210, 0, 460);
    const mW = appMeter("W — · Qh — · η —", 0, -235, 0, 520);
    grp.add(mS.sp); grp.add(mW.sp);
    let lastSnap = -1, kick = 0;
    function onState(s) {
      wheel.rotation.z = -s.ang;
      if (s.angSnap !== lastSnap) { lastSnap = s.angSnap; kick = 1; }
      kick *= 0.86;
      pawlGrp.rotation.z = -0.16 + kick * 0.3;
      hot.material.emissiveIntensity = 0.25 + 0.9 * (s.th - 1);
      cold.material.emissiveIntensity = 0.25 + 0.9 * (s.tc - 1);
      const lift = Math.min(400, Math.max(0, s.ang)) * 0.5;
      weight.position.y = -170 - lift;
      string.scale.y = 170 + lift + 8;
      string.position.y = -8 - (170 + lift) / 2;
      mS.set("ω " + s.vel.toFixed(1) + " rad/s · fwd " + s.fwd + " · rev " + s.rev + " · τ " + s.load.toFixed(3));
      const wJ = Math.max(0, s.ang) * s.load * 1e-21, eta = s.qh > 0 ? wJ / (s.qh * 1e-21) : 0;
      mW.set(s.cond + " · W " + wJ.toExponential(2) + " J · Qh " + (s.qh * 1e-21).toExponential(2) + " · η " + (eta * 100).toFixed(2) + "%");
    }
    return { grp, onState, cam: { tx: 0, ty: 0, tz: 0, dist: 950, pitch: 0.30, yaw: 0.25 } };
  }
  appStages.pressure = { build: buildPressureStage, built: null };
  appStages.trapdoor = { build: buildTrapdoorStage, built: null };
  appStages.ratchet  = { build: buildRatchetStage,  built: null };
  // ---- activation / restore / playback ---------------------------------------
  function appActivate(which) {
    const st = appStages[which];
    if (!st) return;
    if (!st.built) { st.built = st.build(); __A().scene.add(st.built.grp); }
    for (const k in appStages) if (appStages[k].built) appStages[k].built.grp.visible = (k === which);
    if (__camSave.active === which) return;
    if (!__camSave.active) {
      __camSave.orbit = { yaw: __A().orbit.yaw, pitch: __A().orbit.pitch, dist: __A().orbit.dist };
      __camSave.target = __A().cameraTarget.clone();
      __camSave.auto = __A().orbit.auto;
    }
    __camSave.active = which;
    if (__A().setWorldVisible) __A().setWorldVisible(false);
    appGuestsCast(which, st.built);
    const fog = __A().scene.fog;
    if (fog && __camSave.fog === undefined) { __camSave.fog = { near: fog.near, far: fog.far };
      fog.near = 1e6; fog.far = 2e6; }        // apparatus views are crisp; default restored on exit
    __A().orbit.yaw = st.built.cam.yaw; __A().orbit.pitch = st.built.cam.pitch;
    __A().orbit.dist = st.built.cam.dist; __A().orbit.auto = 0;
    __A().cameraTarget.set(st.built.cam.tx, st.built.cam.ty + APP_STAGE_Y, st.built.cam.tz);
  }
  function appRestore() {
    const h = document.getElementById("appHud");
    if (h) h.remove();
    appGuestsRestore();
    for (const k in appStages) if (appStages[k].built) appStages[k].built.grp.visible = false;
    if (!__camSave.active) return;
    if (__A().setWorldVisible) __A().setWorldVisible(true);
    const o = __camSave.orbit;
    __A().orbit.yaw = o.yaw; __A().orbit.pitch = o.pitch; __A().orbit.dist = o.dist;
    __A().orbit.auto = __camSave.auto;
    __A().cameraTarget.copy(__camSave.target);
    const fog = __A().scene.fog;
    if (fog && __camSave.fog) { fog.near = __camSave.fog.near; fog.far = __camSave.fog.far;
      __camSave.fog = undefined; }
    __camSave.active = null;
    __A().__playing = null;
    if (appPlay.raf) { clearTimeout(appPlay.raf); appPlay.raf = 0; }
    appPlay.buf = []; appPlay.active = null; appPlay.idx = 0; appPlay.lastHud = "";
  }
  const APP_REPLAY = 10;                 // playback speedup (compute >> realtime)
  function appHud() {
    let el = document.getElementById("appHud");
    if (!el) {
      el = document.createElement("div"); el.id = "appHud"; el.className = "app-hud";
      document.body.appendChild(el);
    }
    return el;
  }
  // ---- Phase 3: live MULTI-SEED LEARNING panel ------------------------------
  // The headless sweep (e9_training_sweep.js) rewrites
  // research_data/e9_training_sweep_progress.json after EVERY COMPLETED SEED.
  // This page polls that same-origin file every 2 s and rebroadcasts it on
  // the EXISTING BroadcastChannel("fly-demon-experiments") as
  // {type:"e9_batch_progress", ...} for any other listeners; messages of that
  // type arriving from elsewhere are also accepted. Every displayed CI is the
  // sweep's cross-seed aggregate over COMPLETED seeds only (n_seeds per
  // point); no fake intervals are constructed here.
  const E9_BATCH = { timer: 0, last: null, bc: null };
  function e9BatchEnsure() {
    if (!E9_BATCH.bc) { try { E9_BATCH.bc = new BroadcastChannel("fly-demon-experiments"); } catch (e) {}
      if (E9_BATCH.bc) E9_BATCH.bc.onmessage = (ev) => {
        const m = ev.data;
        if (m && m.type === "e9_batch_progress" && m.payload && m.payload.points &&
            m.payload !== E9_BATCH.last) {
          E9_BATCH.last = m.payload;
          const el = document.getElementById("e9hud");
          e9HudUpdate(el && el.__e9state ? el.__e9state : null);
        }
      };
    }
    if (!E9_BATCH.timer) E9_BATCH.timer = setInterval(e9BatchPoll, 2000);
  }
  function e9BatchPoll() {
    fetch("research_data/e9_training_sweep_progress.json", { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (j && j.kind === "training_sweep_progress") e9BatchApply(j); })
      .catch(() => {});
  }
  function e9BatchApply(j) {
    // (patch 16) broadcast only when the sweep file actually changed; the old
    // code re-posted the full (hundreds-of-KB) sweep JSON every 2s forever,
    // waking every plots-window listener and churning GC for nothing.
    const __changed = !E9_BATCH.last || j.episode !== E9_BATCH.last.episode ||
      j.seedsComplete !== E9_BATCH.last.seedsComplete ||
      j.timestamp !== E9_BATCH.last.timestamp ||
      (j.points || []).length !== (E9_BATCH.last.points || []).length;
    E9_BATCH.last = j;
    if (!__changed) return;
    if (E9_BATCH.bc) {
      try {
        // flat headline fields per the e9_batch_progress contract, plus the
        // full point list as payload for richer consumers
        const pts = (j.points || []).filter(p => p.condition === "demon_neural" && p.reward);
        const lastR = pts.length ? pts[pts.length - 1].reward : null;
        E9_BATCH.bc.postMessage({ type: "e9_batch_progress",
          condition: "demon_neural", episode: j.episode, episodesTotal: j.episodesTotal,
          seedsComplete: j.seedsComplete, seedsTotal: j.seedsTotal,
          rewardMean: lastR ? lastR.mean : null,
          rewardCI95Low: lastR ? lastR.ci95_low : null,
          rewardCI95High: lastR ? lastR.ci95_high : null,
          timestamp: j.timestamp, payload: j });
      } catch (e) {}
    }
    const el = document.getElementById("e9hud");
    e9HudUpdate(el && el.__e9state ? el.__e9state : null);
  }
  // compact accumulating curve: mean line, shaded 95% CI band, zero line,
  // TRAIN/TEST divider, current-episode marker (demon_neural condition)
  function e9BatchHudHtml(B) {   // (patch 16) caching wrapper
    if (B && B.__hudHtml) return B.__hudHtml;
    const __html = e9BatchHudHtmlBuild(B);
    try { if (B && __html) B.__hudHtml = __html; } catch (e) {}
    return __html;
  }
  function e9BatchHudHtmlBuild(B) {
    const f2 = (x, d) => Number.isFinite(x) ? x.toFixed(d) : "—";
    const pts = (B.points || []).filter(p => p.condition === "demon_neural" && p.reward)
      .slice().sort((a, b) => a.episode - b.episode);
    if (!pts.length) return "";
    const W = 168, H = 56, pad = 4;
    const ys = pts.map(p => p.reward.mean);
    const lo = pts.map(p => p.reward.ci95_low), hi = pts.map(p => p.reward.ci95_high);
    let ymin = Math.min(0, ...lo), ymax = Math.max(0, ...hi);
    if (ymax - ymin < 1e-9) { ymax += 0.5; ymin -= 0.5; }
    const X = i => pad + i / Math.max(1, pts.length - 1) * (W - 2 * pad);
    const Y = v => pad + (1 - (v - ymin) / (ymax - ymin)) * (H - 2 * pad);
    const path = ys.map((v, i) => (i ? "L" : "M") + X(i).toFixed(1) + "," + Y(v).toFixed(1)).join(" ");
    const band = "M" + hi.map((v, i) => X(i).toFixed(1) + "," + Y(v).toFixed(1)).join(" L") +
      " L" + lo.slice().reverse().map((v, i) => X(pts.length - 1 - i).toFixed(1) + "," + Y(v).toFixed(1)).join(" L") + " Z";
    const testIdx = pts.findIndex(p => p.phase === "test");
    const divX = testIdx > 0 ? X(testIdx - 0.5) : null;
    const zero = Y(0).toFixed(1);
    const nS = Math.max(...pts.map(p => p.n_seeds || 0));
    const lastR = pts[pts.length - 1].reward;
    const status = lastR.ci95_low > 0
      ? '<span class="agree">REWARD &gt; 0: CI EXCLUDES ZERO</span>'
      : '<span class="disagree">REWARD &gt; 0: NOT YET ESTABLISHED</span>';
    return '<h4>MULTI-SEED LEARNING</h4>' +
      '<svg width="' + W + '" height="' + H + '" style="display:block;background:#0b1017;border:1px solid #21262d;border-radius:4px;margin:2px 0">' +
      (divX !== null ? '<line x1="' + divX.toFixed(1) + '" y1="' + pad + '" x2="' + divX.toFixed(1) + '" y2="' + (H - pad) + '" stroke="#8b949e" stroke-dasharray="3 3" opacity=".75"/>' +
        '<text x="' + (divX + 2).toFixed(1) + '" y="10" font-size="7" fill="#8b949e">TEST</text>' +
        '<text x="' + (divX - 2).toFixed(1) + '" y="10" font-size="7" fill="#8b949e" text-anchor="end">TRAIN</text>' : "") +
      '<path d="' + band + '" fill="#4c72b0" opacity=".22"/>' +
      '<line x1="' + pad + '" y1="' + zero + '" x2="' + (W - pad) + '" y2="' + zero + '" stroke="#6a737d" stroke-dasharray="2 2"/>' +
      '<path d="' + path + '" fill="none" stroke="#58a6ff" stroke-width="1.5"/>' +
      '<circle cx="' + X(pts.length - 1).toFixed(1) + '" cy="' + Y(ys[ys.length - 1]).toFixed(1) + '" r="2.5" fill="#58a6ff"/>' +
      '</svg>' +
      'reward <b>' + f2(lastR.mean, 2) + '</b> · CI95 [' + f2(lastR.ci95_low, 2) + ', ' + f2(lastR.ci95_high, 2) + ']<br>' +
      status + ' · N = <b>' + nS + '</b>/' + B.seedsTotal + ' seeds<br>' +
      'episode <b>' + B.episode + '</b>/' + B.episodesTotal + ' · config <b>' + (B.configId || "—") + '</b>';
  }
  e9BatchEnsure();

  // ---- E9 scientific HUD: live fly-brain / demon-action / engine / ledger /
  // learning readouts, all fed from the WORKER's authoritative state stream.
  // Every number shown here is the same value the simulation computed.
  function e9HudUpdate(s) {
    let el = document.getElementById("e9hud");
    if (!s && !E9_BATCH.last) { if (el) el.remove(); return; }
    if (!el) { const d = document.createElement("div"); d.id = "e9hud";
               d.className = "e9hud"; document.body.appendChild(d); el = d; }
    const f1 = (x, d) => Number.isFinite(x) ? x.toFixed(d) : "—";
    if (!s) { el.innerHTML = e9BatchHudHtml(E9_BATCH.last); return; }  // batch-only view
    const e = f1(s.extractionRate, 3), n = f1(s.netWorkJ, 1);
    const cls = e > 0 ? "agree" : (e < 0 ? "disagree" : "k");
    el.innerHTML =
      '<h4>FLY BRAIN</h4>' +
      'sense [' + (s.sensors || []).map(x => f1(x, 1)).join(" ") + ']<br>' +
      'motor <b>' + f1(s.motorActivity, 2) + '</b> · DA <b>' + f1(s.dopamine, 2) +
      '</b> · rew <b>' + f1(s.reward, 1) + '</b>' +
      '<h4>DEMON ACTION</h4>' +
      'neural <b>' + (s.action ? "OPEN" : "CLOSE") + '</b> · ref <b>' +
      (s.classical ? "OPEN" : "CLOSE") + '</b> · <span class="' + cls + '">' +
      Math.round(100 * (s.demonAgree || 0)) + '% agree</span>' +
      '<h4>PRESSURE ENGINE</h4>' +
      'P_L ' + f1(s.pl, 2) + ' · P_R ' + f1(s.pr, 2) + ' · ΔP <b>' + f1(s.pr - s.pl, 3) + '</b><br>' +
      'piston ' + f1(s.piston, 1) + ' · W ' + ((s.workU || 0) * 1e-21).toExponential(2) + ' J' +
      '<h4>INFORMATION LEDGER</h4>' +
      'bits(proxy) ' + (s.bits || 0) + ' · Landauer min ' + f1((s.landauerJ || 0) * 1e21, 2) + 'e-21 J<br>' +
      'extract rate <span class="' + cls + '">' + e + '</span> · net <b>' + n + '</b> e-21 J' +
      '<h4>LEARNING</h4>' +
      'trial <b>' + ((s.trial || 0) + 1) + '</b>/<span class="' + (s.phase === "test" ? "ph-test" : "ph-train") + '">' +
      (s.phase || "train") + '</span> · reward <b>' + f1(s.reward, 1) + '</b> · agree <b>' +
      Math.round(100 * (s.demonAgree || 0)) + '%</b>' +
      (E9_BATCH.last ? e9BatchHudHtml(E9_BATCH.last) : "");
  }
  function appPump() {
    const st = appStages[appPlay.active];
    if (!st || !st.built) { appPlay.raf = 0; appHud().remove(); return; }
    const el = (performance.now() - appPlay.t0) / 1000 * APP_REPLAY;
    while (appPlay.idx < appPlay.buf.length - 1 && appPlay.buf[appPlay.idx + 1].state.t <= el) appPlay.idx++;
    const cur = appPlay.buf[appPlay.idx];
    if (cur) st.built.onState(cur.state);
    if (APP_GUESTS.active !== appPlay.active) appGuestsCast(appPlay.active, st.built);
    appGuestsIdle(cur ? cur.state : null);
    // (patch 16) one DOM write per change, not per tick
    const hudTxt = "apparatus replay ×" + APP_REPLAY +
      " · <b>" + (cur ? cur.state.cond : "") + "</b> · t=" +
      (cur ? cur.state.t.toFixed(1) : "0") + "s · ESC = exit";
    if (hudTxt !== appPlay.lastHud) { appHud().innerHTML = hudTxt; appPlay.lastHud = hudTxt; }
    if (appPlay.active === "pressure") {
      // (patch 16b) the HUD block is ~5KB of innerHTML; rewriting it every
      // replay tick stalled the main thread. Refresh at ~5Hz instead.
      const nowMs = performance.now();
      if (nowMs - (appPlay.lastHudMs || 0) >= 200) {
        appPlay.lastHudMs = nowMs;
        e9HudUpdate(cur ? cur.state : null);
      }
    }
    const atEnd = appPlay.idx >= appPlay.buf.length - 1;
    if (atEnd && appPlay.doneAt && performance.now() - appPlay.doneAt > 1200) {
      appRestore(); return;
    }
    // (patch 16) timer-paced instead of rAF-paced: the replay updates on its
    // own ~24fps clock and never competes with the 3D fly render loop.
    appPlay.raf = setTimeout(appPump, 42);
  }
  function appFeed(which, state) {
    // (re)start when the stage switches OR when stream time regresses — the
    // multi-seed batch restarts the episode clock at every new seed
    if (appPlay.active !== which ||
        (appPlay.lastT !== undefined && state.t < appPlay.lastT - 1)) {
      appPlay.doneAt = 0;
      appPlay.active = which; appPlay.buf = []; appPlay.idx = 0; appPlay.t0 = performance.now();
      appPlay.lastT = 0;
      __A().__playing = which;
      appActivate(which);
      if (!appPlay.raf) appPlay.raf = requestAnimationFrame(appPump);
    }
    appPlay.lastT = state.t;
    appPlay.buf.push({ state });
    if (appPlay.buf.length > 6000) {          // memory guard: thin the oldest half
      appPlay.buf.splice(0, 3000);
      appPlay.idx = Math.max(0, appPlay.idx - 3000);
    }
  }

  // ---- guest cast: the demon & fly appear in apparatus stages --------------
  // E9-E11 play on a remote stage while the default world is hidden; without
  // this the cast vanishes. They are re-parented into the active stage at a
  // per-stage "observer" spot, idle-animated inside appPump (which runs after
  // the default avatar ticks each frame, so those never fight the placement),
  // and returned home bit-for-bit on exit. No effect on E1-E8.
  const APP_GUESTS = { active: null, idleT: 0, lastIdle: 0,
                       devilHome: null, flyHome: null, devilBase: null, flyBase: null,
                       brainHome: null, brainBase: null };
  // lab-bench observer spots per stage (x, y, z in stage space + facing yaw):
  // the pair stands in front of the glass, 3/4-turned toward the apparatus
  const APP_GUEST_SPOTS = {
    // E9: the fly IS the demon - it stands AT THE VALVE (x=0 wall, slot
    // half-height 120), facing the apparatus. This is the experiment's
    // scientific position, not the old lab-bench observer spot.
    pressure: { devil: { pos: [-150, 55, 330], yaw: 2.7 }, fly: { pos: [0, 30, 330], yaw: 3.14 },
                brain: { pos: [170, 430, 40], scale: 0.55 }, label: [250, 330, 330] },
    trapdoor: { devil: { pos: [-300, 15, 270], yaw: 2.85 }, fly: { pos: [235, 5, 295], yaw: 1.3 },
                brain: { pos: [0, 330, -60], scale: 0.5 }, label: [450, 250, 295] },
    ratchet:  { devil: { pos: [-345, -45, 310], yaw: 2.65 }, fly: { pos: [330, -35, 335], yaw: 1.3 },
                brain: { pos: [0, 350, -120], scale: 0.5 }, label: [550, 210, 335] },
  };
  function appGuestsCast(which, built) {
    const G = APP_GUESTS;
    if (G.active === which) return;
    const gv = __A().guests;          // module-published refs (devil/fly/brain)
    if (!gv) return;                  // module still initializing; appPump retries
    const devil = gv.devil, flyGroup = gv.flyGroup, brainGroup = gv.brainGroup;
    if (!G.active) {
      G.devilHome = { parent: devil.parent, pos: devil.position.clone(),
                      rx: devil.rotation.x, ry: devil.rotation.y, rz: devil.rotation.z };
      G.flyHome = { parent: flyGroup.parent, pos: flyGroup.position.clone(),
                    ry: flyGroup.rotation.y };
    }
    G.active = which; G.idleT = 0; G.lastIdle = performance.now();
    if (gv.swap && gv.swap.phase !== "none") { gv.swap.phase = "none"; gv.swap.armed = false; }  // demon stays visible on stage
    devil.visible = true; flyGroup.visible = true;
    const spots = APP_GUEST_SPOTS[which] || built.guests || {};
    const sd = spots.devil || { pos: [0, 0, 300], yaw: 0 };
    G.devilBase = { x: sd.pos[0], y: sd.pos[1], z: sd.pos[2], yaw: sd.yaw };
    built.grp.add(devil);
    devil.position.set(sd.pos[0], sd.pos[1], sd.pos[2]);
    devil.rotation.set(0, sd.yaw, 0);
    const sf = spots.fly || { pos: [200, 0, 320], yaw: -0.3 };
    G.flyBase = { x: sf.pos[0], y: sf.pos[1], z: sf.pos[2], yaw: sf.yaw };
    built.grp.add(flyGroup);
    flyGroup.position.set(sf.pos[0], sf.pos[1], sf.pos[2]);
    flyGroup.rotation.set(0, sf.yaw, 0);
    thoughtAttach(built.grp);   // label + dotted leader live in stage space
    const sb = spots.brain || { pos: [0, 350, -80], scale: 0.5 };
    G.brainBase = { x: sb.pos[0], y: sb.pos[1], z: sb.pos[2], scale: sb.scale };
    if (!G.brainHome) G.brainHome = { parent: brainGroup.parent, pos: brainGroup.position.clone() };
    built.grp.add(brainGroup);
    brainGroup.position.set(sb.pos[0], sb.pos[1], sb.pos[2]);
    brainGroup.scale.setScalar(sb.scale);
    brainGroup.visible = true;      // spiking brain monitors the apparatus live
  }
  function appGuestsRestore() {
    const G = APP_GUESTS;
    if (!G.active) return;
    G.active = null;
    const gv = __A().guests;
    if (!gv) return;
    const devil = gv.devil, flyGroup = gv.flyGroup, brainGroup = gv.brainGroup;
    G.devilHome.parent.add(devil);
    devil.position.copy(G.devilHome.pos);
    devil.rotation.set(G.devilHome.rx, G.devilHome.ry, G.devilHome.rz);
    devil.scale.setScalar(1);
    G.flyHome.parent.add(flyGroup);
    flyGroup.position.copy(G.flyHome.pos);
    flyGroup.rotation.set(0, G.flyHome.ry, 0);
    flyGroup.scale.setScalar(1.5);
    G.brainHome.parent.add(brainGroup);
    brainGroup.position.copy(G.brainHome.pos);
    brainGroup.scale.setScalar(1);
    brainGroup.rotation.set(0, 0, 0);
    thoughtDetach();
  }
  function appGuestsIdle(st) {
    const G = APP_GUESTS;
    if (!G.active) return;
    const gv = __A().guests;
    if (!gv) return;
    const devil = gv.devil, flyGroup = gv.flyGroup, brainGroup = gv.brainGroup;
    const now = performance.now();
    // apparatus events: valve flips / door bangs / pawl slips excite the fly's
    // real sensory neuropils (the same sim._stimPulse path a chamber crossing
    // uses) and flash the thought bubble
    if (st) {
      THOUGHT.cond = st.cond || THOUGHT.cond;
      // E9: keep the latest live state - the thought bubble renders the REAL
      // worker telemetry (sensors/motor/dopamine/reward) from this object.
      if (st.kind === "pressure") G.e9 = st;
      let evHit = false;
      if (st.kind === "pressure" && G._pv !== undefined && ((G._pv < 0.5) !== (st.valve < 0.5))) evHit = true;
      if (st.kind === "pressure") G._pv = st.valve;
      if (st.kind === "trapdoor" && G._pd !== undefined && Math.abs(st.door - G._pd) > 0.18) evHit = true;
      if (st.kind === "trapdoor") G._pd = st.door;
      if (st.kind === "ratchet" && G._ps !== undefined && st.angSnap !== G._ps) evHit = true;
      if (st.kind === "ratchet") G._ps = st.angSnap;
      if (evHit) {
        G.ev = 1;
        if (gv.sim) gv.sim._stimPulse = Math.min(1, (gv.sim._stimPulse || 0) + 0.85);
      }
    }
    G.idleT += (now - G.lastIdle) / 1000; G.lastIdle = now;
    const t = G.idleT, dv = devil.userData;
    // demon: its familiar hover bob/sway, at the observer spot
    devil.position.set(G.devilBase.x + Math.sin(t*0.5)*10,
                       G.devilBase.y + Math.sin(t*1.3)*7 + Math.sin(t*3.1)*2.2,
                       G.devilBase.z);
    devil.rotation.y = G.devilBase.yaw + Math.sin(t*0.4)*0.18;
    if (dv && dv.trident) {          // trident keeps pointing at the apparatus
      dv.trident.rotation.z = -0.08 + Math.sin(t*1.1)*0.06;
      dv.trident.position.y = -8 + Math.sin(t*1.3+1.2)*2;
    }
    // fly: hover + wing buzz + avatar-brain pulse
    flyGroup.position.set(G.flyBase.x, G.flyBase.y + Math.sin(t*2.1)*6, G.flyBase.z);
    flyGroup.userData.wings.forEach((w,i)=>{ w.rotation.y = Math.sin(t*62 + i)*0.8; });
    if (flyGroup.userData.brain) {
      flyGroup.userData.brain.scale.setScalar(1 + 0.08*Math.sin(t*4));
      if (flyGroup.userData.brainMarker) flyGroup.userData.brainMarker.scale.setScalar(1 + 0.18*Math.sin(t*5));
    }
    if (G.brainBase) {
      brainGroup.rotation.y = Math.sin(t*0.22)*0.35;
      brainGroup.position.y = G.brainBase.y + Math.sin(t*0.8)*10;
    }
    thoughtTick(G.ev || 0);
    G.ev = (G.ev || 0) * 0.9;        // event-flash envelope decays
  }

  // ---- fly thought bubble: live brain regions during apparatus runs ---------
  // A comic thought-bubble sprite anchored above the fly's head. Content is
  // REAL: per-region firing rates are EMA-sampled from the live spiking
  // brain's sim.spikes (grouped by the connectome's layer_names), and the
  // apparatus events pulse that same brain via sim._stimPulse, so the
  // regions shown are the ones genuinely spiking as the machine runs.
  const THOUGHT = { sp: null, cv: null, tex: null, g: null, line: null, grp: null,
                    anchor: null, last: 0, cond: "", drawn: "" };
  function thoughtAttach(grp) {
    const gv = __A().guests; if (!gv || !gv.flyGroup || !grp) return;
    const T = window.THREE;
    if (!THOUGHT.sp) {
      // small fixed label box (one line of text) + ONE dotted leader line
      const cv = document.createElement("canvas"); cv.width = 260; cv.height = 64;
      THOUGHT.cv = cv; THOUGHT.g = cv.getContext("2d");
      THOUGHT.tex = new T.CanvasTexture(cv);
      THOUGHT.sp = new T.Sprite(new T.SpriteMaterial({ map: THOUGHT.tex, transparent: true, depthWrite: false }));
      THOUGHT.sp.scale.set(150, 37, 1); THOUGHT.sp.renderOrder = 20;
      const geom = new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]);
      THOUGHT.line = new T.Line(geom, new T.LineDashedMaterial({
        color: 0xffd166, dashSize: 14, gapSize: 10, transparent: true, opacity: 0.9 }));
      THOUGHT.line.renderOrder = 19;
    }
    if (THOUGHT.sp.parent !== grp) {
      if (THOUGHT.sp.parent) { THOUGHT.sp.parent.remove(THOUGHT.sp); THOUGHT.line.parent.remove(THOUGHT.line); }
      grp.add(THOUGHT.sp); grp.add(THOUGHT.line);
      const spots = APP_GUEST_SPOTS[APP_GUESTS.active] || {};
      THOUGHT.anchor = new T.Vector3(spots.label ? spots.label[0] : 260,
                                     spots.label ? spots.label[1] : 330,
                                     spots.label ? spots.label[2] : 330);
      THOUGHT.sp.position.copy(THOUGHT.anchor);
      THOUGHT.grp = grp;
    }
    THOUGHT.cond = ""; THOUGHT.last = 0; THOUGHT.drawn = "";
  }
  function thoughtDetach() {
    for (const o of [THOUGHT.sp, THOUGHT.line]) if (o && o.parent) o.parent.remove(o);
    THOUGHT.grp = null;
  }
  function thoughtSample() {
    const gv = __A().guests; if (!gv || !gv.sim) return null;
    const now = performance.now();
    if (now - THOUGHT.last < 160) return null;         // ~6 fps refresh
    // ---- E9: the bubble shows the ACTUAL controller telemetry -------------
    // (worker-side fly brain: 8 normalized sensors, motor population rate,
    // dopamine teaching signal). Same numbers the valve decision reads.
    if (APP_GUESTS.active === "pressure" && APP_GUESTS.e9) {
      THOUGHT.last = now;
      const s = APP_GUESTS.e9;
      const sen = s.sensors || [0,0,0,0,0,0,0,0];
      const ema = THOUGHT.ema || (THOUGHT.ema = {});
      const mix = (k, v) => { ema[k] = (ema[k] || 0) * 0.7 + v * 0.3; };
      mix("motor pool", Math.min(1, (s.motorActivity || 0) / 3));
      mix("sensory drive", sen.reduce((a, x) => a + x, 0) / 8);
      mix("fast @ valve (ch0)", sen[0]);
      mix("valve aperture (ch6)", sen[6]);
      mix("dopamine", Math.min(1, Math.max(0, (s.dopamine || 0)) / 2));
      return ema;
    }
    const sim = gv.sim;
    if (!sim || !sim.spikes || !sim.circuit || !sim.circuit.layer_names) return null;
    THOUGHT.last = now;
    const names = sim.circuit.layer_names;
    for (let li = 0; li < sim.layers.length && li < names.length; li++) {
      const a = sim.layerStart[li], b = a + sim.layers[li].length;
      let s = 0; for (let i = a; i < b; i++) if (sim.spikes[i]) s++;
      const rate = s / Math.max(1, b - a);
      const nm = names[li].replace(/\s*\(.*\)\s*/, "").trim();   // "optic lobe (ME/LO/LOP)" -> "optic lobe"
      THOUGHT.ema[nm] = (THOUGHT.ema[nm] || 0) * 0.7 + rate * 0.3;  // smooth
    }
    return THOUGHT.ema;
  }
  function thoughtDraw(cond, ev) {
    const g = THOUGHT.g, W = THOUGHT.cv.width, H = THOUGHT.cv.height;
    g.clearRect(0, 0, W, H);
    // compact dark label, amber outline — one line of text, no bar chart
    g.fillStyle = "rgba(13,18,26,0.86)";
    g.strokeStyle = "rgba(255,209,102,0.95)"; g.lineWidth = 2.5;
    g.beginPath();
    g.roundRect ? g.roundRect(4, 4, W - 8, H - 8, 14) : g.rect(4, 4, W - 8, H - 8);
    g.fill(); g.stroke();
    g.fillStyle = "#ffd166"; g.font = "bold 20px Consolas, monospace"; g.textAlign = "left";
    g.fillText("thinking: " + (cond || "…"), 16, 40);
    if (ev > 0.05) {   // apparatus event flash (valve flips / door bangs)
      g.fillStyle = "rgba(255,180,60," + (0.10 + 0.25 * ev).toFixed(2) + ")";
      g.beginPath(); g.roundRect ? g.roundRect(4, 4, W - 8, H - 8, 14) : g.rect(4, 4, W - 8, H - 8);
      g.fill();
    }
    THOUGHT.tex.needsUpdate = true;
  }
  function thoughtTick(ev) {
    if (!THOUGHT.sp || !THOUGHT.sp.parent || !THOUGHT.grp) return;
    const gv = __A().guests; if (!gv || !gv.flyGroup) return;
    // dotted leader: box stays fixed far from the apparatus, the endpoint
    // rides the fly — when the fly moves only the line extends
    const pos = THOUGHT.line.geometry.attributes.position;
    pos.setXYZ(0, THOUGHT.anchor.x - 80, THOUGHT.anchor.y - 10, THOUGHT.anchor.z);
    pos.setXYZ(1, gv.flyGroup.position.x, gv.flyGroup.position.y + 46, gv.flyGroup.position.z);
    pos.needsUpdate = true;
    THOUGHT.line.computeLineDistances();
    // redraw only on condition change or event pulse (perf: no per-frame canvas)
    if (THOUGHT.cond !== THOUGHT.drawn || ev > 0.05) {
      thoughtDraw(THOUGHT.cond, ev || 0);
      THOUGHT.drawn = THOUGHT.cond;
    }
  }

  function sixStep(expId) {
    if (sixLeft <= 0 || !sixSet.has(expId)) return;   // not a session member
    sixLeft--;
    if (sixLeft > 0) {
      if (sixBtn === btnAll) btnAll.textContent = "⏳ session: " + sixLeft + " to go…";
    } else {
      if (sixBtn && sixBtn !== btnAll) {              // (patch 15) per-lab session
        sixBtn.disabled = false;
        sixBtn.textContent = "▶";
        sixBtn.title = sixBtn.dataset.title || sixBtn.title;
      } else {
        btnAll.disabled = false;
        btnAll.textContent = "▶▶ run all six · animate figure";
      }
      sixBtn = null;
      CH.postMessage({ kind: "plots", type: "session_end" });
    }
  }

  // ---- Chat: design a new experiment with an LLM (patch 12) ------------------
  // Providers: GPT via an OpenAI API key, or a local runtime — Ollama
  // (auto-detected on :11434; models listed and the best one recommended
  // straight from your installed list) or LM Studio (:1234, OpenAI-
  // compatible). A host override covers a Raspberry Pi / another box on LAN.
  const chatEl = (id) => document.getElementById(id);
  const chatProvEl = chatEl("chatProv"), chatConnectBtn = chatEl("chatConnect");
  const chatCfg = chatEl("chatCfg"), chatKeyEl = chatEl("chatKey");
  const chatKeyHint = chatEl("chatKeyHint"), chatHostEl = chatEl("chatHost");
  const chatModelsEl = chatEl("chatModels"), chatModelTxtEl = chatEl("chatModelTxt");
  const chatRec = chatEl("chatRec"), chatSaveBtn = chatEl("chatSave");
  const chatIdeaEl = chatEl("chatIdea"), chatGoBtn = chatEl("chatGo");
  const CHAT_STORE = "flydemon.chat.";
  let chatState = null;                       // { prov, model, key?, host? }
  try { chatState = JSON.parse(localStorage.getItem(CHAT_STORE + "state") || "null"); } catch (e) {}
  const chatFetch = (url, opts, ms) => new Promise((resolve, reject) => {
    const ctl = (typeof AbortController === "function") ? new AbortController() : null;
    const t = setTimeout(() => ctl && ctl.abort(), ms || 4000);
    fetch(url, Object.assign({}, opts || {}, ctl ? { signal: ctl.signal } : {}))
      .then(r => { clearTimeout(t); resolve(r); },
            e => { clearTimeout(t); reject(e); });
  });
  function chatBase() {
    const h = (chatState && chatState.host) || chatHostEl.value.trim();
    const port = chatState && chatState.prov === "ollama" ? 11434 : 1234;
    return "http://" + (h || "127.0.0.1:" + port);
  }
  async function chatDetect() {
    const p = chatProvEl.value;
    chatCfg.classList.add("open");
    chatKeyEl.style.display = p === "openai" ? "block" : "none";
    chatKeyHint.style.display = p === "openai" ? "block" : "none";
    chatModelTxtEl.style.display = p === "openai" ? "block" : "none";
    chatHostEl.style.display = p === "openai" ? "none" : "block";
    chatModelsEl.style.display = p === "openai" ? "none" : "block";
    chatRec.classList.remove("warn");
    if (p === "openai") {
      let st = null;
      try { st = JSON.parse(localStorage.getItem(CHAT_STORE + "openai") || "null"); } catch (e) {}
      chatKeyEl.value = (st && st.key) || "";
      chatModelTxtEl.value = (st && st.model) || "gpt-4.1-mini";
      chatRec.textContent = "Enter your key, check the model id, then Save & connect.";
      return;
    }
    chatRec.textContent = "detecting local models…";
    chatModelsEl.innerHTML = "";
    chatState = { prov: p, model: null, host: chatHostEl.value.trim() || undefined };
    try {
      if (p === "ollama") {
        const r = await chatFetch(chatBase() + "/api/tags", {}, 3500);
        if (!r.ok) throw new Error("http " + r.status);
        const j = await r.json();
        const models = (j.models || []).map(m => ({
          id: m.name,
          ps: (m.details && m.details.parameter_size) || "?",
          q: (m.details && m.details.quantization_level) || ""
        }));
        if (!models.length) {
          chatRec.classList.add("warn");
          chatRec.textContent = "Ollama is reachable but has no models — pull one first (e.g. `ollama pull llama3.1:8b` in PowerShell).";
          return;
        }
        // rank the installed list: mid-size instruct models (7-16B) with
        // clean quants design experiments best for the VRAM they cost
        const score = (m) => {
          const b = parseFloat(m.ps) || 0;
          const s = (b >= 7 && b <= 16) ? 0 : (b >= 4 && b <= 34) ? 1 : 2;
          const qi = ["F16", "BF16", "Q8_0", "Q6_K", "Q5_K_M", "Q4_K_M", "Q4_0"].indexOf(m.q);
          return s + (qi < 0 ? 3 : qi) * 0.01;
        };
        models.sort((a, b) => score(a) - score(b));
        chatModelsEl.innerHTML = models.map(m =>
          `<option value="${m.id}">${m.id} · ${m.ps}${m.q ? " · " + m.q : ""}</option>`).join("");
        const best = models[0];
        chatRec.textContent = models.length + " model" + (models.length > 1 ? "s" : "") +
          " recognised from your Ollama list — recommended: " + best.id +
          " (" + best.ps + (best.q ? " " + best.q : "") + "), the best quality/size balance here for experiment design.";
      } else {
        const r = await chatFetch(chatBase() + "/v1/models", {}, 3500);
        if (!r.ok) throw new Error("http " + r.status);
        const j = await r.json();
        const ids = (j.data || []).map(m => m.id).filter(Boolean);
        if (!ids.length) throw new Error("no models loaded");
        chatModelsEl.innerHTML = ids.map(id => `<option value="${id}">${id}</option>`).join("");
        chatRec.textContent = ids.length + " model" + (ids.length > 1 ? "s" : "") +
          " loaded in LM Studio — pick one (larger designs better, answers slower).";
      }
    } catch (e) {
      chatModelsEl.style.display = "none";
      chatRec.classList.add("warn");
      chatRec.textContent = p === "ollama"
        ? "Ollama not detected on " + chatBase() + " — start it (`ollama serve` in PowerShell), or run it on a Pi / other PC and use the host override."
        : "LM Studio not detected on " + chatBase() + " — start the local server (Developer → Start Server), or use the host override.";
    }
  }
  chatSaveBtn.addEventListener("click", () => {
    const p = chatProvEl.value;
    if (p === "openai") {
      const key = chatKeyEl.value.trim(), model = chatModelTxtEl.value.trim() || "gpt-4.1-mini";
      if (!key || key.indexOf("sk-") !== 0) {
        setStatus("chat", "error", "that key doesn't look right — OpenAI keys start with sk-");
        return;
      }
      chatState = { prov: p, model, key };
      try { localStorage.setItem(CHAT_STORE + "openai", JSON.stringify({ key, model })); } catch (e) {}
    } else {
      const model = chatModelsEl.value;
      if (!model) { setStatus("chat", "error", "no local model selected — is the runtime running?"); return; }
      chatState = { prov: p, model, host: chatHostEl.value.trim() || undefined };
      try { localStorage.setItem(CHAT_STORE + p, JSON.stringify({ model, host: chatState.host })); } catch (e) {}
    }
    try { localStorage.setItem(CHAT_STORE + "state",
      JSON.stringify({ prov: chatState.prov, model: chatState.model, host: chatState.host })); } catch (e) {}
    chatCfg.classList.remove("open");
    chatConnectBtn.textContent = "Connected ✓";
    setStatus("chat", "", "connected · " + chatState.model);
  });
  chatConnectBtn.addEventListener("click", chatDetect);
  chatProvEl.addEventListener("change", () => {
    chatState = null;
    chatConnectBtn.textContent = "Connect";
    chatCfg.classList.remove("open");
    try { localStorage.removeItem(CHAT_STORE + "state"); } catch (e) {}
  });
  // ---- question / answer mode ----------------------------------------------
  // Questions ("where is the most active region during e2, e5, e8?") are
  // answered from the measured layer rates of finished runs — never from the
  // model's imagination. Rows are indexed on every done (chatIndexBrain).
  const chatBrain = window.__chatBrainIndex = { byExp: {} };
  const CHAT_REGION_RULES = [
    [/\boptic\b/i, "optic lobe"],
    [/antennal|\bPN\b/i, "antennal lobe"],
    [/kenyon|hidden/i, "mushroom body"],
    [/MB output|motor/i, "motor output"],
  ];
  function chatIndexBrain(expId, rows) {
    const acc = {};
    let nRows = 0;
    for (const r of rows) {
      if (!r || !r.layerRates) continue;
      nRows++;
      const ph = r.phase === "test" ? "test" : "train";
      for (const [layer, v] of Object.entries(r.layerRates)) {
        let reg = null;
        for (const [re, name] of CHAT_REGION_RULES) if (re.test(layer)) { reg = name; break; }
        if (!reg || !Number.isFinite(v)) continue;
        const a = acc[reg] = acc[reg] || { sum: 0, n: 0, tSum: 0, tN: 0 };
        a.sum += v; a.n++;
        if (ph === "test") { a.tSum += v; a.tN++; }
      }
    }
    const regions = {};
    for (const [k, a] of Object.entries(acc)) regions[k] = a.n ? a.sum / a.n : 0;
    const top = Object.entries(regions).sort((x, y) => y[1] - x[1]).map(e => e[0]);
    const head = cards[expId] && cards[expId].querySelector(".exp-head b");
    chatBrain.byExp[expId] = {
      label: head ? head.textContent : expId,
      regions, top,
      testRegions: Object.fromEntries(Object.entries(acc).map(([k, a]) => [k, a.tN ? a.tSum / a.tN : 0])),
      conds: [...new Set(rows.map(r => r.condition))].length,
      rows: nRows,
    };
  }
  window.__chatIndexBrain = chatIndexBrain;   // debug/test hook (page convention)
  async function chatAnswer(q) {
    if ((!chatState || !chatState.model) && chatModelsEl.value) {
      chatState = { prov: chatProvEl.value, model: chatModelsEl.value,
                    host: chatHostEl.value.trim() || undefined };
      chatConnectBtn.textContent = "Connected \u2713";
    }
    if (!chatState || !chatState.model) {
      setStatus("chat", "error", "connect a model first");
      chatDetect();
      return;
    }
    const have = Object.keys(chatBrain.byExp);
    if (!have.length) {
      setStatus("chat", "error", "no finished runs yet — run an experiment (or run all six), then ask again");
      return;
    }
    const digest = have.map(id => {
      const b = chatBrain.byExp[id];
      const regs = Object.entries(b.regions).sort((x, y) => y[1] - x[1])
        .map(e => e[0] + " " + e[1].toFixed(3)).join(", ");
      const tRegs = Object.entries(b.testRegions).sort((x, y) => y[1] - x[1])
        .map(e => e[0] + " " + e[1].toFixed(3)).join(", ");
      return id + " [" + b.label + ", " + b.conds + " conditions, " + b.rows + " brain rows]" +
             "\n  mean activity by region: " + regs +
             "\n  test-phase only: " + tRegs +
             "\n  most active overall: " + (b.top[0] || "n/a");
    }).join("\n");
    const ans = document.getElementById("chatAnswer");
    ans.style.display = "block";
    ans.textContent = "asking " + chatState.model + "\u2026";
    setStatus("chat", "running", "analysing\u2026 (" + chatState.model + ")");
    chatGoBtn.disabled = true;
    try {
      const url = chatState.prov === "openai" ? "https://api.openai.com/v1/chat/completions"
                                              : chatBase() + "/v1/chat/completions";
      const headers = { "Content-Type": "application/json" };
      if (chatState.key) headers.Authorization = "Bearer " + chatState.key;
      const r = await chatFetch(url, {
        method: "POST", headers,
        body: JSON.stringify({ model: chatState.model, temperature: 0.2,
          messages: [
            { role: "system", content: "You answer questions about finished experiments in a fly-brain Maxwell-demon lab. Use ONLY the measured data digest provided; name the regions and experiments explicitly; 2-5 plain sentences; no markdown headers; if the data does not cover something, say so." },
            { role: "user", content: "Question: " + q +
              "\n\nMeasured mean layer/region activity per finished experiment (mean spikes/step, 0-1 scale):\n" + digest }
          ] })
      }, 120000);
      if (!r.ok) throw new Error("model API http " + r.status);
      const j = await r.json();
      const msg0 = (j.choices && j.choices[0] && j.choices[0].message) || {};
      const txt = ((msg0.content || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim()) ||
                  (msg0.reasoning || "").trim();
      if (!txt) throw new Error("empty reply from model");
      ans.textContent = "\uD83D\uDCAC " + txt;
      setStatus("chat", "", "answered \u00b7 " + chatState.model);
    } catch (e) {
      ans.textContent = "\u26A0 " + String(e.message || e);
      setStatus("chat", "error", "answer failed: " + String(e.message || e).slice(0, 80));
    } finally {
      chatGoBtn.disabled = false;
    }
  }
  function chatGo() {
    const q = chatIdeaEl.value.trim();
    if (!q) { setStatus("chat", "error", "type a question or a study idea first"); return; }
    // questions get answered from measured data; anything else designs a run
    const isQuestion = /^(where|which|what|how|why|when|who|is|are|does|do|can)\b/i.test(q) || /\?\s*$/.test(q);
    if (isQuestion) chatAnswer(q);
    else chatDesign();
  }

  const CHAT_ALIASES = {
    classical_demon: "classical_demon", classical: "classical_demon", demon: "classical_demon",
    classic: "classical_demon", physical: "classical_demon", adaptive: "classical_demon",
    ann: "ann", mlp: "ann", neural: "ann", network: "ann",
    drosophila: "drosophila", fly: "drosophila", fly_brain: "drosophila", mb: "drosophila",
    mushroom: "drosophila", mushroom_body: "drosophila",
    never_gate: "never_gate", nevergate: "never_gate", never: "never_gate",
    random: "random", control: "random", baseline: "random",
  };
  const CHAT_SYSTEM = "You design experiments for a 2D Maxwell-demon sorting lab used in a fly-brain AI research demo. Available controllers: classical_demon (adaptive-threshold physical gate), ann (small reward-trained MLP), drosophila (PN-KC-MB dopamine network), never_gate (never opens the door; control), random. Physics knobs: nParticles 40-640, noise 0-0.4. Reply with ONLY minified JSON, no markdown: {\"name\":string <=60 chars,\"hypothesis\":string <=200 chars,\"conditions\":[2-4 distinct controller ids],\"nParticles\":int,\"noise\":number,\"trainTrials\":int 8-60,\"testTrials\":int 4-12}";
  async function chatDesign() {
    if ((!chatState || !chatState.model) && chatModelsEl.value) {
      chatState = { prov: chatProvEl.value, model: chatModelsEl.value,
                    host: chatHostEl.value.trim() || undefined };
      chatConnectBtn.textContent = "Connected \u2713";
    }
    if (!chatState || !chatState.model) {
      setStatus("chat", "error", "connect a model first");
      chatDetect();
      return;
    }
    const idea = chatIdeaEl.value.trim();
    if (!idea) { setStatus("chat", "error", "describe the study first"); return; }
    if (current === "chat" || queue.includes("chat")) { setStatus("chat", "error", "already queued/running"); return; }
    setStatus("chat", "running", "designing… (" + chatState.model + ")");
    chatGoBtn.disabled = true;
    try {
      const url = chatState.prov === "openai" ? "https://api.openai.com/v1/chat/completions"
                                              : chatBase() + "/v1/chat/completions";
      const headers = { "Content-Type": "application/json" };
      if (chatState.key) headers.Authorization = "Bearer " + chatState.key;
      const r = await chatFetch(url, {
        method: "POST", headers,
        body: JSON.stringify({ model: chatState.model, temperature: 0.4,
          messages: [
            { role: "system", content: CHAT_SYSTEM },
            { role: "user", content: "Study idea from the scientist: " + idea +
                                     "\nDesign the experiment: pick the 2-4 conditions that best test it and set the physics." }
          ] })
      }, 120000);
      if (!r.ok) throw new Error("model API http " + r.status);
      const j = await r.json();
      const msg0 = (j.choices && j.choices[0] && j.choices[0].message) || {};
      const raw = msg0.content || "";
      const txt = raw.replace(/<think>[\s\S]*?<\/think>/gi, "");
      // scan for complete top-level JSON objects (string-aware); thinking
      // models may put the final design only inside their reasoning stream
      const objs = (s) => {
        const out = []; let depth = 0, start = -1, inStr = false, esc = false;
        for (let i = 0; i < s.length; i++) {
          const ch = s[i];
          if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
          if (ch === '"') { inStr = true; continue; }
          if (ch === "{") { if (!depth) start = i; depth++; }
          else if (ch === "}") { if (depth) { depth--; if (!depth && start >= 0) { out.push(s.slice(start, i + 1)); start = -1; } } }
        }
        return out;
      };
      const cands = objs(txt).concat(objs(msg0.reasoning || ""));
      let spec = null;
      for (let i = cands.length - 1; i >= 0 && !spec; i--) {
        try { const o = JSON.parse(cands[i]); if (o && (o.conditions || o.name)) spec = o; } catch (e) {}
      }
      if (!spec)
        throw new Error("model did not return a design — replied: " +
                        (raw || msg0.reasoning || "").replace(/\s+/g, " ").slice(0, 70));
      const ids = [];
      for (const c of (Array.isArray(spec.conditions) ? spec.conditions : [])) {
        const k = CHAT_ALIASES[String(c).toLowerCase().trim()];
        if (k && !ids.includes(k)) ids.push(k);
      }
      if (!ids.length) throw new Error("no usable conditions in the design");
      window.__chatSpec = {
        name: String(spec.name || idea.slice(0, 48)).slice(0, 60),
        hypothesis: String(spec.hypothesis || "").slice(0, 200),
        conditions: ids,
        nParticles: Math.max(40, Math.min(640, Math.round(Number(spec.nParticles) || 320))),
        noise: Math.max(0, Math.min(0.4, Number(spec.noise) || 0.12)),
        trainTrials: Math.max(8, Math.min(60, Math.round(Number(spec.trainTrials) || 40))),
        testTrials: Math.max(4, Math.min(12, Math.round(Number(spec.testTrials) || 8)))
      };
      queue.push("chat");
      openPlots();
      const toast = (typeof msg === "function") ? msg : (window.__labMsg || (() => {}));
      toast("💬 " + chatState.model + " designed: " + window.__chatSpec.name + " — queued", 4000);
      setStatus("chat", "running", "queued… " + ids.join(" vs "));
      startNext();
    } catch (e) {
      setStatus("chat", "error", "design failed: " + String(e.message || e).slice(0, 90));
    } finally {
      chatGoBtn.disabled = false;
    }
  }
  chatGoBtn.addEventListener("click", chatGo);
  if (chatState && chatState.prov) {
    chatProvEl.value = chatState.prov;
    chatConnectBtn.textContent = "Connected ✓";
    setStatus("chat", "", "connected · " + chatState.model);
  }
  // ESC leaves an apparatus stage and restores the default scene + camera.
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && __camSave.active) {
      appRestore();
      (typeof msg === "function" ? msg : window.__labMsg || (() => {}))(
        "apparatus closed — default scene restored", 2400);
    }
  });
})();
