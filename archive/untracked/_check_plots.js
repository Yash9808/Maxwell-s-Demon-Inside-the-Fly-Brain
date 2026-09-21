"use strict";
// ---- seaborn-style state ---------------------------------------------------
const PALETTES = {
  deep:       ["#4c72b0", "#dd8452", "#55a868", "#c44e52", "#8172b3", "#937860", "#da8bc3", "#8c8c8c"],
  muted:      ["#4878d0", "#ee854a", "#6acc64", "#d65f5f", "#956cb4", "#8c613c", "#dc7ec0", "#797979"],
  bright:     ["#023eff", "#ff7c00", "#1ac938", "#e8000b", "#8b2be2", "#9f4800", "#f14cc1", "#a3a3a3"],
  pastel:     ["#a1c9f4", "#ffb482", "#8de5a1", "#ff9f9b", "#d0bbff", "#fffea3", "#b9f2f0", "#d9d9d9"],
  colorblind: ["#0173b2", "#de8f05", "#029e73", "#d55e00", "#cc78bc", "#ca9161", "#fbafe4", "#949494"],
  tab10:      ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f"],
};
const THEMES = {
  darkgrid:  { bg: "#0d1117", fg: "#c9d1d9", grid: "#21262d", gridOn: true,  spines: false, ticks: false, lw: 1.6, fs: 10 },
  whitegrid: { bg: "#f0f1f4", fg: "#26303c", grid: "#cbd2da", gridOn: true,  spines: false, ticks: false, lw: 1.6, fs: 10 },
  dark:      { bg: "#101418", fg: "#dfe5ec", grid: "#1c2127", gridOn: false, spines: true,  ticks: false, lw: 1.6, fs: 10 },
  white:     { bg: "#ffffff", fg: "#26303c", grid: "#e6e8eb", gridOn: false, spines: true,  ticks: false, lw: 1.8, fs: 10 },
  ticks:     { bg: "#ffffff", fg: "#26303c", grid: "#e6e8eb", gridOn: false, spines: true,  ticks: true,  lw: 1.6, fs: 10 },
  poster:    { bg: "#f0f1f4", fg: "#26303c", grid: "#cbd2da", gridOn: true,  spines: false, ticks: false, lw: 3.0, fs: 13 },
};
let STYLE = { theme: "darkgrid", pal: "deep", kind: "line" };
function palette() {
  const pal = PALETTES[STYLE.pal] || PALETTES.deep;
  return (k, i) => pal[i % pal.length];
}

const FALLBACK = ["#58a6ff", "#3fb950", "#f0883e", "#bc8cff", "#f778ba", "#79c0ff"];  // unused fallback
let CURVE = [];            // latest progress curve
let DONE = null;           // { summary, rows, provenance }
let LABEL = "—";

function byCond(curve) {
  const map = new Map();
  for (const p of curve) {
    if (!map.has(p.cond)) map.set(p.cond, []);
    map.get(p.cond).push(p);
  }
  return map;
}
function condColor(map) {
  const keys = [...map.keys()];
  return new Map(keys.map((k, i) => [k, COLORS[i % COLORS.length]]));
}

// ---- minimal canvas line plot (seaborn-themed) ---------------------------
function plot(canvasId, legendId, series, yLabel, opts = {}) {
  const cv = document.getElementById(canvasId);
  const lg = document.getElementById(legendId);
  lg.innerHTML = "";
  const th = THEMES[STYLE.theme] || THEMES.darkgrid;
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = th.bg; g.fillRect(0, 0, W, H);
  if (!series.length || !series.some(s => s.pts.length)) {
    g.fillStyle = "#8b949e"; g.font = "12px system-ui";
    g.fillText("waiting for data…", 12, H / 2); return;
  }
  const padL = 46, padR = 10, padT = 10, padB = 20;
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const s of series) for (const [x, y] of s.pts) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    xmin = Math.min(xmin, x); xmax = Math.max(xmax, x);
    ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
  }
  if (!Number.isFinite(xmin)) return;
  if (xmax === xmin) xmax = xmin + 1;
  if (ymax === ymin) { ymax = ymin + 1; ymin -= 0.5; }
  if (opts.logY) { ymin = Math.max(ymin, 1e-22); ymax = Math.max(ymax, ymin * 10); }
  const X = x => padL + (x - xmin) / (xmax - xmin) * (W - padL - padR);
  const Y = y => opts.logY
    ? padT + (1 - (Math.log10(Math.max(y, ymin)) - Math.log10(ymin)) /
              (Math.log10(ymax) - Math.log10(ymin))) * (H - padT - padB)
    : padT + (1 - (y - ymin) / (ymax - ymin)) * (H - padT - padB);
  // grid (darkgrid/whitegrid/poster)
  if (th.gridOn) {
    g.strokeStyle = th.grid; g.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      const gy = padT + i / 4 * (H - padT - padB);
      g.beginPath(); g.moveTo(padL, gy); g.lineTo(W - padR, gy); g.stroke();
    }
  }
  // TRAIN|TEST divider: dashed vertical line where the test phase begins
  // (first block tagged phase "test"); only drawn when a phase split exists.
  const testStart = (() => {
    let first = Infinity, lastTrain = -1;
    for (const s of series) for (const [x, p] of (s.meta || [])) {
      if (p === "test") first = Math.min(first, x);
    }
    return first;
  })();
  if (Number.isFinite(testStart) && series.some(s => (s.meta || []).some(m => m[1] === "train"))) {
    g.save();
    g.strokeStyle = th.fg || "#8b949e"; g.globalAlpha = 0.55; g.setLineDash([4, 4]);
    g.beginPath(); g.moveTo(X(testStart), padT); g.lineTo(X(testStart), H - padB); g.stroke();
    g.setLineDash([]); g.globalAlpha = 1;
    g.font = "10px system-ui"; g.fillStyle = th.fg || "#8b949e";
    g.fillText("TEST (weights frozen)", Math.min(X(testStart) + 5, W - 110), padT + 10);
    g.textAlign = "right";
    g.fillText("TRAIN", Math.max(padL + 2, X(testStart) - 5), padT + 10);
    g.textAlign = "left";
    g.restore();
  }
  // series (theme line width; kind-switchable)
  const lw = th.lw, kind = STYLE.kind;
  for (const s of series) {
    const seg = [];
    for (const [x, y] of s.pts) {
      if (!Number.isFinite(y)) { flush(); seg.length = 0; continue; }
      seg.push([X(x), Y(y)]);
    }
    function flush() {
      if (!seg.length) return;
      if (kind === "area") {
        g.fillStyle = s.color + "33";
        g.beginPath(); g.moveTo(seg[0][0], H - padB);
        for (const [px, py] of seg) g.lineTo(px, py);
        g.lineTo(seg[seg.length - 1][0], H - padB); g.closePath(); g.fill();
      }
      if (kind === "point") {
        g.fillStyle = s.color;
        for (const [px, py] of seg) { g.beginPath(); g.arc(px, py, lw, 0, 7); g.fill(); }
      } else {
        g.strokeStyle = s.color; g.lineWidth = lw;
        g.lineJoin = "round"; g.beginPath();
        if (kind === "step") {
          g.moveTo(seg[0][0], seg[0][1]);
          for (let i = 1; i < seg.length; i++) {
            g.lineTo(seg[i][0], seg[i - 1][1]); g.lineTo(seg[i][0], seg[i][1]);
          }
        } else {
          g.moveTo(seg[0][0], seg[0][1]);
          for (let i = 1; i < seg.length; i++) g.lineTo(seg[i][0], seg[i][1]);
        }
        g.stroke();
      }
    }
    flush();
  }
  // spines / ticks
  if (th.spines) {
    g.strokeStyle = th.fg; g.lineWidth = 1;
    g.strokeRect(padL, padT, W - padL - padR, H - padT - padB);
  }
  if (th.ticks) {
    g.strokeStyle = th.fg;
    for (let i = 0; i <= 4; i++) {
      const gx = padL + i / 4 * (W - padL - padR);
      g.beginPath(); g.moveTo(gx, H - padB); g.lineTo(gx, H - padB + 4); g.stroke();
      const gy = padT + i / 4 * (H - padT - padB);
      g.beginPath(); g.moveTo(padL - 4, gy); g.lineTo(padL, gy); g.stroke();
    }
  }
  // labels
  g.fillStyle = th.fg; g.font = `${th.fs}px system-ui`;
  g.fillText(fmt(ymin), 4, H - padB + 2);
  g.fillText(fmt(ymax), 4, padT + 8);
  g.fillText(String(Math.round(xmin)), padL, H - 6);
  g.fillText(String(Math.round(xmax)), W - padR - 18, H - 6);
  g.fillText(opts.xLabel || "block", W / 2 - 14, H - 6);
  // live head dot
  if (STYLE.kind !== "point") {
    for (const s of series) {
      for (let i = s.pts.length - 1; i >= 0; i--) {
        if (Number.isFinite(s.pts[i][1])) {
          g.fillStyle = s.color; g.beginPath();
          g.arc(X(s.pts[i][0]), Y(s.pts[i][1]), 2.4 + th.lw * 0.5, 0, 7); g.fill(); break;
        }
      }
    }
  }
  // legend swatches
  for (const s of series) {
    const d = document.createElement("span");
    d.innerHTML = `<span class="sw" style="background:${s.color}"></span>${s.name}`;
    lg.appendChild(d);
  }
}
function fmt(v) {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e4)) return v.toExponential(1);
  return String(+v.toFixed(3));
}
function seriesFrom(map, colors, field, xField = "block") {
  const out = [];
  let i = 0;
  for (const [k, pts] of map) {
    out.push({ name: k, color: colors(k, i++),
      pts: pts.map(p => [p[xField], p[field]]),
      meta: pts.map(p => [p[xField], p.phase]) });   // phase per point (TRAIN/TEST divider)
  }
  return out;
}

// ---- expected-behaviour scripts (per experiment) --------------------------
const BEHAVIOR_SPECS = {
  e1: {
    demon: [
      "<b>Gate policy:</b> opens only for a fast particle leaving the hot side or a slow one trying to re-enter it (two-direction Maxwell rule, adaptive threshold).",
      "<b>Rhythm:</b> gate mostly <b>closed</b> (open fraction well under 50%) — long stillness, brief deliberate openings.",
      "<b>Memory:</b> writes a bit per crossing evaluation and per gate flip — the ledger's bit count should stay tiny.",
      "<b>Outcome to watch:</b> ΔT grows slowly but monotonically; good:bad crossings well above 1; sorting entropy falls.",
    ],
    fly: [
      "No fly in E1 — this is the physical reference chamber. Watch the <b>demon</b> alone.",
      "Compare its openings against the speed of the particle at the door: every opening should look <b>justified</b>.",
    ],
  },
  e2: {
    demon: [
      "The programmed demon is <b>absent</b> — the ANN replaces it and receives the same observations.",
      "<b>Early training:</b> erratic gate — near-random open/close (exploratory noise), many bad crossings, agreement with the demon rule low.",
      "<b>Late training:</b> gate rhythm converges toward the demon's — agreement rises, open fraction drops toward selective use.",
      "The ANN has no internal demon threshold: convergence is statistical, never exact.",
    ],
    fly: [
      "Watch for a <b>transition from restless to deliberate</b> gate behaviour as reward accumulates.",
      "Error rate should fall before selectivity tightens — accuracy first, efficiency second.",
    ],
  },
  e3: {
    demon: [
      "No demon — the <b>fly's brain</b> is the gate controller (PN → KC → MB output → dopamine → motor).",
      "<b>Early:</b> spontaneous low open rate; dopamine nearly silent; crossings mostly luck.",
      "<b>On good crossings</b> dopamine pulses → KC→MBON synapses strengthen → the door opens more readily on fast-approach episodes.",
      "Learning is slower and noisier than the ANN (biological gain, sparse KC coding) — judge on trend, not trial-to-trial.",
    ],
    fly: [
      "Watch the DA pulse in the brain panel coincide with good crossings, then <b>behaviour</b> follow — plasticity precedes policy.",
      "Expected signature: fewer crossings than E1/E2, but an improving good:bad ratio; the fly is conservative, not industrious.",
    ],
  },
  e4: {
    demon: [
      "Three bodies, three wirings, one task — <b>4A full plasticity</b>, <b>4B sensory-pathway-only plasticity</b>, <b>4C shuffled connectome</b>.",
      "All receive identical sensory streams and rewards; only topology (and where plasticity is allowed) differs.",
      "<b>4A</b> should show the strongest learning; <b>4B</b> partial (only the sensory pathway adapts); <b>4C</b> the causal control — wiring that cannot support the policy.",
      "This is the experiment's core claim: <b>if 4A and 4C diverge, real connectome topology causally shapes the gate policy</b>.",
    ],
    fly: [
      "Watch the three gate rhythms drift apart over training despite identical inputs.",
      "In the 3D lab you can load the same circuit and watch its anatomical brain while E4 runs in the background.",
    ],
  },
  e6: {
    demon: [
      "Three worlds, one physics: <b>never-gate</b> (door welded shut), the <b>classical demon</b>, and a <b>random</b> gate — identical jets and gas.",
      "<b>The paradox to watch:</b> never-gate accumulates the <b>most</b> ΔH — the jet injects fast particles into the hot side and the closed door traps them. Sorting without any policy.",
      "The demon's advantage appears in <b>good:bad selectivity</b>, not raw ΔH: its gate spends the environment's subsidy deliberately, using information about each particle.",
      "<b>Causal decomposition:</b> ΔH = environment subsidy (jet + closure) + information (gate selectivity). This experiment separates the two terms — the app's central thermodynamic lesson, made measurable.",
    ],
    fly: [
      "Compare the three rows: highest ΔH ≠ best demon. Ask which controller <b>earned</b> its gradient.",
      "Thermodynamically: never-gate is a pure subsidy with zero information cost; the demon pays measurement bits — the ledger shows both sides.",
    ],
  },
  e7: {
    demon: [
      "One demon policy, three worlds: <b>sparse/clean</b> (120 particles, no noise), <b>default</b> (320, 0.12), <b>dense/noisy</b> (640, 0.30).",
      "<b>Expected:</b> sorting survives all three — a physical speed-gate policy does not depend on particle count or mild noise.",
      "Sparse worlds sort slowly (fewer crossing opportunities); dense worlds sort fast but with more mis-sorts per event.",
      "If performance collapsed in any regime, the policy would be memorizing statistics, not implementing a rule — that is what this sweep tests.",
    ],
    fly: [
      "Compare ΔT and selectivity <b>across regimes</b>, not across trials.",
      "The demon's adaptive threshold should recalibrate itself in each world — watch the open fraction stabilize at a similar value everywhere.",
    ],
  },
  e8: {
    demon: [
      "Three demons, different information budgets: <b>adaptive</b> (measures the corridor, updates its threshold), <b>fixed</b> (same rule, no adaptation), <b>mem4</b> (4-decision memory).",
      "<b>Expected:</b> adaptive ≥ fixed ≫ mem4 — measurement and memory both carry information, and removing them should cost sorting.",
      "mem4 still implements the same rule; only its history is truncated — isolating <b>memory</b> as the variable.",
      "Landauer connection: fewer decisions and less memory = fewer bits = smaller erasure bill — the ledger shows whether the cheaper demon pays less for worse sorting.",
    ],
    fly: [
      "Read the three rows as an information dose-response curve: bits available vs sorting achieved.",
      "If fixed ≈ adaptive, the corridor statistics are stationary — adaptation buys little here; that itself is a finding about the environment, not the demon.",
    ],
  },
  e5: {
    demon: [
      "All controllers side-by-side in one seeded study — the comparative reference.",
      "<b>Expected selectivity ordering:</b> classical demon ≥ connectome 4A > drosophila ≈ ANN > shuffled > random.",
      "The classical demon opens on speed; the learners approximate the same policy through very different mechanisms.",
      "Connectome vs shuffled is the headline pair — behaviour may converge while internal information (MI) differs.",
    ],
    fly: [
      "Compare rows, not trials: per-condition open fraction, good:bad, and ΔT side by side.",
      "Thermodynamically, expect every controller to be jet-subsidized (efficiency ≪ 1) — the ledger shows who is least subsidized.",
    ],
  },
  e9: {
    demon: [
      "Five valve policies on one pressure engine: <b>demon_neural</b> (the fly's connectome decides from 8 local sensors), <b>demon_frozen</b> (same brain, weights frozen from trial 0), <b>demon_speed</b> (classical speed rule, reference), <b>demon_random</b>, <b>never_open</b>.",
      "<b>Neural conditions:</b> the valve command originates in motor-layer population activity (fast EMA vs its own baseline); the classical rule is only a reference for the agreement metric — it never drives the neural valve.",
      "<b>Learning:</b> reward = work + selection − wrong-action penalty, delivered to the same dopamine-gated eligibility-trace plasticity as E4. Weights persist across trials; episode 13+ runs with frozen weights (TEST region).",
      "Thermodynamic ledger: spring work vs the <b>theoretical Landauer minimum</b> kT·ln2·bits. The bit count here is a <b>decision-bit proxy</b> (one decision per measurement), not a measured memory-erasure cost.",
    ],
    fly: [
      "The fly IS the demon: it stands at the valve in the 3D pressure stage, its brain receives the 8-channel sensory vector, and its motor population opens/closes the valve.",
      "<b>Watch:</b> demon_neural's reward and accuracy climb over training while frozen stays flat; weight drift (Σ|Δw|) grows only in the learning condition.",
      "demon_speed shows what an optimal rule extracts; the gap to demon_neural is the learning deficit — the quantity E9 Phase 1 exists to measure.",
    ],
  },
  e10: {
    demon: [
      "No demon at all: a spring-loaded trapdoor flips open only when molecules bang into it from the left.",
      "<b>Watch:</b> a light door gets kicked open often and passes more molecules; a heavy door rarely opens — mass gates flow, not intelligence.",
      "Either way the gas <b>relaxes to equilibrium</b>: while the door is open, molecules pass both directions — a Smoluchowski flap rectifies nothing alone.",
      "This is the null model behind E1: without measurement and decision, door mechanics alone cannot sort.",
    ],
    fly: [
      "No fly here — this is the passive trapdoor that fooled Smoluchowski (1912).",
      "In the 3D lab the microscopic trapdoor stage opens while E10 runs (ESC restores the default scene).",
    ],
  },
  e11: {
    demon: [
      "A ratchet-and-pawl wheel between a hot vanes bath (Th) and a cold pawl bath (Tc), with an exact detailed-balance event model.",
      "<b>Watch:</b> with Th &gt; Tc forward slips outweigh reversals and the wheel lifts the load; at Th = Tc the pawl lifts as often as it slips — net rotation ≈ 0.",
      "Equilibrium doing nothing <b>is the result</b> (Feynman's rectification theorem): you cannot sieve work from a single bath.",
      "A heavier load turns the gradient wheel slower — torque trades against speed exactly as in a real engine.",
    ],
    fly: [
      "No fly here — the ratchet is the molecular-machine analogue of the demon's gate.",
      "In the 3D lab the ratchet-engine stage opens while E11 runs (ESC restores the default scene).",
    ],
  },
};
// ---- apparatus experiments (E9/E10/E11) ------------------------------------
// These runs report apparatus metrics instead of demon/fly behavioral fields,
// so the predictions/ledger paths get an apparatus-specific metric table and
// the generic evaluators get null-guards (below).
const APP_SPEC = {
  e9: { title: "Pressure engine — brain → valve → ΔP → piston → mechanical work", panels: [
      { f: "reward", label: "reward / episode", fmt: v => v.toFixed(2) },
      { f: "decisionAccuracy", label: "decision accuracy", fmt: v => (v * 100).toFixed(0) + "%" },
      { f: "demonAgree", label: "demon agreement", fmt: v => (v * 100).toFixed(0) + "%" },
      { f: "dPfinal", label: "ΔP (relative)", fmt: v => v.toFixed(4) },
      { f: "pistonX", label: "piston position", fmt: v => v.toFixed(1) },
      { f: "workJ", label: "spring work (J)", fmt: v => v.toExponential(2) },
      { f: "openFraction", label: "valve open", fmt: v => (v * 100).toFixed(0) + "%" },
      { f: "crossings", label: "crossings / episode", fmt: v => v.toFixed(0) },
      { f: "goodCrossings", label: "good crossings", fmt: v => v.toFixed(1) },
      { f: "badCrossings", label: "bad crossings", fmt: v => v.toFixed(1) },
      { f: "spikeRate", label: "motor spikes / decision", fmt: v => v.toFixed(2) },
      { f: "dopamineMean", label: "dopamine (mean)", fmt: v => v.toFixed(3) },
      { f: "weightDrift", label: "Σ|Δw| from baseline", fmt: v => v.toExponential(2) },
      { f: "sensorDecisionBits", label: "decision bits (proxy)", fmt: v => v.toFixed(0) },
      { f: "netWorkJ", label: "net work − Landauer min (J)", fmt: v => v.toExponential(2) },
    ] },
  e10: { title: "Smoluchowski trapdoor — populations & door mechanics", panels: [
      { f: "leftCount", label: "left count", fmt: v => v.toFixed(0) },
      { f: "rightCount", label: "right count", fmt: v => v.toFixed(0) },
      { f: "densityDiff", label: "density diff (nL−nR)/n", fmt: v => v.toFixed(3) },
      { f: "trapdoorAngle", label: "final door angle", fmt: v => v.toFixed(2) },
      { f: "trapdoorFluctuation", label: "door angle RMS", fmt: v => v.toFixed(2) },
      { f: "crossingRate", label: "crossings / s", fmt: v => v.toFixed(2) },
      { f: "directionalBias", label: "directional bias", fmt: v => v.toFixed(3) },
      { f: "dTfinal", label: "ΔT between sides", fmt: v => v.toFixed(1) },
    ] },
  e11: { title: "Feynman ratchet — rotation & thermodynamic accounting", panels: [
      { f: "netPerEpisode", label: "net rotation / episode (rad)", fmt: v => v.toFixed(2) },
      { f: "angularVelocity", label: "final ω (rad/s)", fmt: v => v.toFixed(2) },
      { f: "torque", label: "load torque", fmt: v => v.toFixed(3) },
      { f: "forwardSteps", label: "forward slips", fmt: v => v.toFixed(0) },
      { f: "reverseSteps", label: "reverse slips", fmt: v => v.toFixed(0) },
      { f: "thermalFluctuation", label: "|thermal wobble|", fmt: v => v.toFixed(2) },
      { f: "workJ", label: "work extracted (J)", fmt: v => v.toExponential(2) },
      { f: "heatJ", label: "heat drawn (J)", fmt: v => v.toExponential(2) },
      { f: "entropyProduction", label: "entropy Qh/Th − Qc/Tc", fmt: v => v.toFixed(2) },
      { f: "efficiency", label: "η = W/Qh", fmt: v => (v * 100).toFixed(2) + "%" },
    ] },
};
const appNum = (c, k) => (c && c[k] && Number.isFinite(c[k].mean)) ? c[k] : { mean: 0, ci: 0 };
function appStatsFromRows(rows) {   // apparatus: summary.conditions carries no apparatus fields — derive from rows
  const by = {};
  for (const r of rows || []) (by[r.condition] = by[r.condition] || []).push(r);
  const out = {};
  for (const [k, list] of Object.entries(by)) {
    const acc = {};
    for (const r of list) for (const [f, v] of Object.entries(r)) {
      if (typeof v !== "number" || !Number.isFinite(v) || f === "trial" || f === "seed" || f === "steps") continue;
      (acc[f] = acc[f] || []).push(v);
    }
    const stats = {};
    for (const [f, arr] of Object.entries(acc)) {
      const m = arr.reduce((a, x) => a + x, 0) / arr.length;
      const sd = arr.length > 1 ? Math.sqrt(arr.reduce((a, x) => a + (x - m) ** 2, 0) / (arr.length - 1)) : 0;
      stats[f] = { mean: m, ci: sd / Math.sqrt(arr.length), n: arr.length };
    }
    out[k] = stats;
  }
  return out;
}
function renderApparatus(expId, conds, wrap) {
  const spec = APP_SPEC[expId];
  if (!spec) return false;
  const colors = palette();
  let html = `<div class="sub" style="margin:2px 0 8px">${spec.title} — per-condition episode means (seeded, deterministic)</div>`;
  html += `<table class="ledger"><tr><th>condition</th>` +
          spec.panels.map(pp => `<th>${pp.label}</th>`).join("") + `</tr>`;
  Object.entries(conds).forEach(([k, c], i) => {
    html += `<tr><td style="color:${colors(k, i)}"><b>${k}</b></td>` +
            spec.panels.map(pp => `<td>${pp.fmt(appNum(c, pp.f).mean)}</td>`).join("") + `</tr>`;
  });
  wrap.innerHTML = html + `</table>`;
  return true;
}
function renderBehavior(expId, label) {
  const spec = BEHAVIOR_SPECS[expId] || BEHAVIOR_SPECS.e5;
  document.getElementById("behSub").textContent =
    (label || "experiment") + " — the behavioural script each run should follow";
  document.getElementById("behRoles").innerHTML =
    `<div class="role"><h3>👁 Demon / controller — gate actions</h3><ul>${spec.demon.map(x=>`<li>${x}</li>`).join("")}</ul></div>` +
    `<div class="role"><h3>🪰 Fly — body & brain actions</h3><ul>${spec.fly.map(x=>`<li>${x}</li>`).join("")}</ul></div>`;
}

// ---- predictions vs observations -------------------------------------------
function evaluatePredictions(conds) {
  const out = [];
  const add = (text, verdict, val) => out.push({ text, verdict, val });
  const sig = (a, b) => {                       // significance of a-b given CIs
    const e = Math.sqrt((a.ci||0)**2 + (b.ci||0)**2);
    return { gain: a.mean - b.mean, e };
  };
  for (const [k, c] of Object.entries(conds)) {
    const { gain, e } = sig(c.lateAgreement || {mean:0,ci:0}, c.earlyAgreement || {mean:0,ci:0});
    add(`<b>${k}</b> — learning: agreement rises with training (ΔAgreement > 0)`,
        gain > 2*e ? "ok" : (gain < -2*e ? "bad" : (e === 0 ? "amb" : "amb")),
        `early ${(c.earlyAgreement||{mean:0}).mean.toFixed(2)} → late ${(c.lateAgreement||{mean:0}).mean.toFixed(2)}`);
    const gbL = c.lateGoodBadRatio, gbE = c.earlyGoodBadRatio;
    if (gbL && gbL.mean) {
      const g2 = gbL.mean - (gbE ? gbE.mean : 0);
      add(`<b>${k}</b> — sorting selectivity: good:bad ratio improves with training`,
          g2 > 0.25 ? "ok" : (g2 < -0.25 ? "bad" : "amb"),
          `${gbE ? gbE.mean.toFixed(2) : "—"} → ${gbL.mean.toFixed(2)}`);
    } else {
      add(`<b>${k}</b> — sorting selectivity: good:bad ratio improves with training`, "amb", "no bad crossings recorded (ratio undefined)");
    }
    const se = c.testSortEntropy || { mean: 0, ci: 0 };
    add(`<b>${k}</b> — velocity distribution sorted (ΔH > 0)`,
        se.mean > 2*(se.ci||0) ? "ok" : (se.mean < -2*(se.ci||0) ? "bad" : "amb"),
        `ΔH = ${se.mean.toExponential(2)}`);
    const dt = c.testDT || { mean: 0, ci: 0 };
    add(`<b>${k}</b> — temperature gradient established (ΔT > 0, hot side wins)`,
        dt.mean > 2*(dt.ci||0) ? "ok" : (dt.mean < -2*(dt.ci||0) ? "bad" : "amb"),
        `ΔT = ${dt.mean.toFixed(1)}`);
    const of_ = c.testOpenFraction;
    if (of_) add(`<b>${k}</b> — gate used selectively (open fraction < 0.5)`,
        of_.mean < 0.5 ? "ok" : "bad",
        `open ${(of_.mean*100).toFixed(0)}%`);
    const mi = c.testMiNeural;
    if (mi) add(`<b>${k}</b> — neural policy carries task information (MI > 0.002 bits)`,
        mi.mean > 0.002 ? "ok" : "amb",
        `MI = ${mi.mean > 0 ? mi.mean.toFixed(4) : "n/a"} bits`);
    if (c.testWorkInJ && c.testExtractableJ && c.testWorkInJ.mean > 0) {
      const eff = c.testExtractableJ.mean / c.testWorkInJ.mean;
      add(`<b>${k}</b> — jet-subsidized regime (extractable ≪ work-in, efficiency < 1%)`,
          eff < 0.01 ? "ok" : "bad",
          `η = ${(eff*100).toExponential(1)}%`);
    }
  }
  return out;
}
function renderPredictions() {
  if (!DONE) return;
  const conds = DONE.summary.conditions || {};
  const appExp = DONE.provenance && APP_SPEC[DONE.provenance.experiment] ? DONE.provenance.experiment : null;
  const preds = appExp ? evaluateApparatusPredictions(appExp, appStatsFromRows(DONE.rows)) : evaluatePredictions(conds);
  const wrap = document.getElementById("predWrap");
  if (!preds.length) { wrap.innerHTML = '<div class="empty">no conditions</div>'; return; }
  const singleSeed = (DONE.provenance.seeds || 1) < 3;
  wrap.innerHTML = preds.map(pr => {
    const cls = pr.verdict === "ok" ? "ok" : pr.verdict === "bad" ? "bad" : "amb";
    const mark = pr.verdict === "ok" ? "✓ observed" : pr.verdict === "bad" ? "✗ not observed" : "≈ within noise";
    return `<div class="pred"><span class="badge ${cls}">${mark}</span>` +
           `<span class="ptext">${pr.text}</span><span class="pval">${pr.val}</span></div>`;
  }).join("") +
  (singleSeed ? `<div class="reading">⚠ single-seed run — treat ≈ verdicts as low statistical power, not as falsified predictions.</div>` : "");
}

function evaluateApparatusPredictions(expId, conds) {
  const out = [];
  const add = (text, verdict, val) => out.push({ text, verdict, val });
  const g = (c, f) => (c && c[f] && Number.isFinite(c[f].mean)) ? c[f] : { mean: 0, ci: 0 };
  const pick = (re) => Object.keys(conds).find(n => re.test(n));
  if (expId === "e9") {
    const n = conds[pick(/neural/)], fz = conds[pick(/frozen/)];
    if (n) {
      const wd = g(n, "weightDrift");
      add(`<b>demon_neural</b> — training changed the brain (Σ|Δw| > 0; frozen control must stay ≈ 0)`,
          wd.mean > 0 && (!fz || g(fz, "weightDrift").mean < wd.mean * 0.05) ? "ok" :
          (wd.mean > 0 ? "amb" : "bad"),
          `neural ${wd.mean.toExponential(2)}` + (fz ? ` vs frozen ${g(fz, "weightDrift").mean.toExponential(2)}` : ""));
      const acc = g(n, "decisionAccuracy");
      add(`<b>demon_neural</b> — decisions better than chance (accuracy > 50%)`,
          acc.mean > 0.5 ? "ok" : (acc.mean > 0.35 ? "amb" : "bad"),
          `accuracy ${(acc.mean * 100).toFixed(0)}%`);
      const rw = g(n, "reward");
      add(`<b>demon_neural</b> — reward ≫ penalty floor (net teaching signal positive)`,
          rw.mean > -0.5 ? "ok" : (rw.mean > -2 ? "amb" : "bad"), `reward ${rw.mean.toFixed(2)}/episode`);
    }
    if (n && fz) {
      const rwN = g(n, "reward"), rwF = g(fz, "reward");
      add(`<b>learning vs frozen</b> — learned policy earns more reward than the frozen brain`,
          rwN.mean > rwF.mean ? "ok" : (rwN.mean < rwF.mean - 1 ? "bad" : "amb"),
          `${rwN.mean.toFixed(2)} vs ${rwF.mean.toFixed(2)} reward/episode`);
    }
    const d = conds[pick(/demon_speed|_speed/)];
    if (d) {
      const acc = g(d, "decisionAccuracy");
      add(`<b>demon_speed (reference)</b> — the classical rule scores ~100% on its own metric`,
          acc.mean > 0.9 ? "ok" : "amb", `accuracy ${(acc.mean * 100).toFixed(0)}%`);
    }
    const f = conds[pick(/never/)];
    if (d && f) {
      // volume-aware relative pressure difference: the quantity that drives
      // the piston (raw ΔT is fluctuation-dominated at n=260 particles)
      const dP = g(d, "dPfinal"), fP = g(f, "dPfinal");
      const sig = Math.sqrt((dP.ci||0)**2 + (fP.ci||0)**2);
      add(`<b>demon_speed</b> — real pressure head: |ΔP| ≫ never-open noise floor`,
          Math.abs(dP.mean) > Math.abs(fP.mean) + 2*sig ? "ok" : (Math.abs(dP.mean) > Math.abs(fP.mean) ? "amb" : "bad"),
          `|ΔP| ${Math.abs(dP.mean).toFixed(3)} vs floor ${Math.abs(fP.mean).toFixed(3)}`);
      const net = g(d, "netWorkJ");
      add(`<b>demon_speed</b> — thermodynamic budget: spring work vs theoretical Landauer minimum`,
          net.mean > 0 ? "ok" : "bad", `W − kT·ln2·bits = ${net.mean.toExponential(2)} J (bit count is a decision proxy)`);
      const px = g(d, "pistonX");
      add(`<b>demon_speed</b> — ΔP drives the piston against the spring`,
          px.mean > 2 ? "ok" : (px.mean > 0 ? "amb" : "bad"), `piston x = ${px.mean.toFixed(1)}`);
    }
  } else if (expId === "e10") {
    const li = conds[pick(/light/)], he = conds[pick(/heavy/)];
    if (li && he) {
      add(`<b>light vs heavy door</b> — lighter door passes more molecules (mass gates flow, not intelligence)`,
          g(li, "crossingRate").mean > g(he, "crossingRate").mean ? "ok" : "bad",
          `${g(li, "crossingRate").mean.toFixed(2)} vs ${g(he, "crossingRate").mean.toFixed(2)} crossings/s`);
    }
    const db = Math.max(...Object.values(conds).map(c => Math.abs(g(c, "directionalBias").mean)));
    add(`<b>all doors</b> — trapdoor rectifies nothing: directional bias ≈ 0 (Smoluchowski 1912)`,
        db < 0.2 ? "ok" : "bad", `max |bias| = ${db.toFixed(3)}`);
    const dd = g(Object.values(conds)[0], "densityDiff");
    add(`<b>gas</b> — relaxes toward equal densities, no demon here`,
        Math.abs(dd.mean) < 0.25 ? "ok" : "amb", `final density diff = ${dd.mean.toFixed(3)}`);
  } else if (expId === "e11") {
    const grad = conds[pick(/gradient/)], eq = conds[pick(/equilib/)];
    if (grad) add(`<b>gradient</b> — Th > Tc drives net rotation (forward slips ≫ reversals)`,
        g(grad, "netPerEpisode").mean > 0 ? "ok" : "bad",
        `net ${g(grad, "netPerEpisode").mean.toFixed(2)} rad/ep · fwd ${Math.round(g(grad, "forwardSteps").mean)} / rev ${Math.round(g(grad, "reverseSteps").mean)}`);
    if (eq) { const net = g(eq, "netPerEpisode");
      add(`<b>equilibrium</b> — Th = Tc: net rotation ≈ 0 (Feynman's rectification theorem)`,
          Math.abs(net.mean) < Math.max(1, 2*(net.ci||0)) ? "ok" : "bad",
          `net = ${net.mean.toFixed(2)} rad/ep`); }
    const eff = g(Object.values(conds)[0], "efficiency");
    add(`<b>engine</b> — η far below Carnot: a real engine, not a perpetuum mobile`,
        eff.mean < 0.5 ? "ok" : "amb", `η = ${(eff.mean*100).toFixed(2)}%`);
  }
  return out;
}

// ---- crossing ledger ---------------------------------------------------------
function behaviouralReading(c, rows) {
  const bits = [];
  const of_ = c.testOpenFraction.mean;
  if (of_ > 0.65) bits.push("gate saturates open — sorting is passive, not selective");
  else if (of_ < 0.15) bits.push("gate nearly always closed — crossing-starved policy");
  else bits.push(`gate opens selectively (${Math.round(of_*100)}% of steps)`);
  const gb = c.testGoodBadRatio;
  if (gb && gb.mean) bits.push(gb.mean > 2 ? "crossings strongly speed-selected (good:bad > 2)"
                       : gb.mean > 1.2 ? "crossings moderately selected (good:bad > 1)"
                       : "crossings barely selected (good:bad ≈ 1)");
  else bits.push("no bad crossings — either perfect selection or too few events to judge");
  const dt = c.testDT.mean;
  bits.push(dt > 2*(c.testDT.ci||0) ? "hot side accumulates (classical demon outcome)"
          : dt < -2*(c.testDT.ci||0) ? "cold side accumulates (anti-demon outcome)"
          : "no significant temperature gradient");
  const learn = (c.lateAgreement && c.earlyAgreement) ? c.lateAgreement.mean - c.earlyAgreement.mean : 0;
  if (learn > 0.1) bits.push(`policy learned during training (+${learn.toFixed(2)} agreement)`);
  else if (learn < -0.1) bits.push(`policy drifted away from the demon rule (${learn.toFixed(2)})`);
  else bits.push("policy stable across training");
  return bits;
}
function renderLedger() {
  if (!DONE) return;
  const conds = DONE.summary.conditions || {};
  const rows = DONE.rows || [];
  const wrap = document.getElementById("ledgerWrap");
  const appExpL = DONE.provenance && APP_SPEC[DONE.provenance.experiment] ? DONE.provenance.experiment : null;
  if (appExpL && renderApparatus(appExpL, appStatsFromRows(rows), wrap)) return;
  const keys = Object.keys(conds);
  if (!keys.length) { wrap.innerHTML = '<div class="empty">no conditions</div>'; return; }
  let html = '<table class="ledger"><tr><th>condition</th><th>crossings</th><th>good</th><th>bad</th>' +
             '<th>good:bad</th><th>open</th><th>ΔT</th><th>bits</th><th>work in (J)</th></tr>';
  const readings = [];
  for (const k of keys) {
    const c = conds[k];
    const trows = rows.filter(r => r.condition === k && r.phase === "test");
    const cr = trows.reduce((a,r)=>a+r.crossings,0), gd = trows.reduce((a,r)=>a+r.goodCrossings,0),
          bd = trows.reduce((a,r)=>a+r.badCrossings,0);
    const gb = c.testGoodBadRatio && c.testGoodBadRatio.mean ? c.testGoodBadRatio.mean.toFixed(2) : "—";
    html += `<tr><td>${k}</td><td>${cr}</td><td>${gd}</td><td>${bd}</td><td>${gb}</td>` +
            `<td>${Math.round(c.testOpenFraction.mean*100)}%</td>` +
            `<td>${c.testDT.mean.toFixed(1)}</td>` +
            `<td>${Math.round(c.testMeasuredBits.mean)}</td>` +
            `<td>${c.testWorkInJ.mean.toExponential(2)}</td></tr>`;
    readings.push(`<div class="reading"><b>${k}</b> — ${behaviouralReading(c, trows).join("; ")}.</div>`);
  }
  html += "</table>" + readings.join("");
  wrap.innerHTML = html;
}

// ---- render all panels ---------------------------------------------------
function render() {
  const map = byCond(CURVE);
  const colors = palette();
  plot("cAgree", "lAgree", seriesFrom(map, colors, "agree"), "agreement");
  plot("cGood", "lGood", seriesFrom(map, colors, "goodBadRatio"), "good:bad");
  plot("cDT", "lDT", seriesFrom(map, colors, "dT"), "ΔT");
  plot("cSort", "lSort", seriesFrom(map, colors, "sortEntropy"), "ΔH");
  plot("cMI", "lMI", seriesFrom(map, colors, "miNeural"), "bits");
  // thermo: two series per condition (extractable vs erasure), log Y
  const thermo = [];
  let ti = 0;
  for (const [k, pts] of map) {
    thermo.push({ name: k + " extractable", color: palette()(k, ti++),
      pts: pts.map(p => [p.block, p.energyJ >= 0 ? Math.max(p.energyJ, 1e-22) : NaN]) });
  }
  plot("cThermo", "lThermo", thermo, "J", { logY: true, xLabel: "block" });
  if (DONE) renderSummary();
}

// ---- style bar wiring ------------------------------------------------------
document.getElementById("selStyle").addEventListener("change", e => {
  STYLE.theme = e.target.value; render();
});
document.getElementById("selPal").addEventListener("change", e => {
  STYLE.pal = e.target.value; render();
});
document.getElementById("selKind").addEventListener("change", e => {
  STYLE.kind = e.target.value; render();
});

function renderSummary() {
  const { summary, rows, provenance } = DONE;
  const conds = summary.conditions || {};
  const keys = Object.keys(conds);
  if (!keys.length) return;
  document.getElementById("sumSub").textContent =
    `${rows.length} trial rows · ${keys.length} conditions · elapsed ${provenance.elapsedSeconds.toFixed(0)} s`;
  const appExp = provenance && APP_SPEC[provenance.experiment] ? provenance.experiment : null;
  let html;
  if (appExp) {
    // apparatus runs: show the headline apparatus metrics instead of demon fields
    const cols = APP_SPEC[appExp].panels.slice(0, 6);
    const rc = appStatsFromRows(rows);
    html = "<table><tr><th>condition</th>" + cols.map(pp => `<th>${pp.label}</th>`).join("") + "</tr>";
    for (const k of keys) {
      const c = rc[k] || {};
      html += `<tr><td>${k}</td>` +
        cols.map(pp => `<td>${pp.fmt(appNum(c, pp.f).mean)}</td>`).join("") + `</tr>`;
    }
  } else {
  html = "<table><tr><th>condition</th><th>test agreement</th><th>good:bad</th>" +
    "<th>ΔT</th><th>sort ΔH</th><th>MI (bits)</th><th>work in (J)</th>" +
    "<th>erasure (J)</th><th>bits</th></tr>";
  for (const k of keys) {
    const c = conds[k];
    const gb = c.testGoodBadRatio ? c.testGoodBadRatio.mean : null;
    const mi = c.testMiNeural && c.testMiNeural.mean ? c.testMiNeural.mean : null;
    const num = (f, d) => (c[f] && Number.isFinite(c[f].mean)) ? c[f].mean.toFixed(d) : "n/a";
    html += `<tr><td>${k}</td><td>${num("testAgreement", 3)}</td>` +
      `<td>${gb === null ? "n/a" : gb.toFixed(2)}</td>` +
      `<td>${num("testDT", 1)}</td><td>${c.testSortEntropy ? c.testSortEntropy.mean.toExponential(2) : "n/a"}</td>` +
      `<td>${mi === null ? "n/a" : mi.toFixed(4)}</td>` +
      `<td>${c.testWorkInJ ? c.testWorkInJ.mean.toExponential(2) : "n/a"}</td>` +
      `<td>${c.testErasureCostJ ? c.testErasureCostJ.mean.toExponential(2) : "n/a"}</td>` +
      `<td>${c.testMeasuredBits ? Math.round(c.testMeasuredBits.mean) : "n/a"}</td></tr>`;
  }
  }
  html += "</table>";
  document.getElementById("sumWrap").innerHTML = html;
  document.getElementById("provNote").textContent =
    `seed ${provenance.seeds ? provenance.seedBase || 1 : 1}+ · ${provenance.seeds} seed(s) · ` +
    `${provenance.trainTrials}+${provenance.testTrials} trials · ${provenance.episodeSeconds}s episodes · ` +
    `${provenance.nParticles} particles · started ${provenance.startedISO}`;
}

// ---- downloads -----------------------------------------------------------
function download(name, text, mime) {
  const blob = new Blob([text], { type: mime || "application/octet-stream" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
document.getElementById("dlRows").onclick = () => {
  if (!DONE) return;
  const lines = DONE.rows.map(r => JSON.stringify(r));
  download(`experiment_rows_${DONE.provenance.experiment}.jsonl`, lines.join("\n"),
           "application/x-ndjson");
};
document.getElementById("dlSummary").onclick = () => {
  if (!DONE) return;
  download(`experiment_summary_${DONE.provenance.experiment}.json`,
           JSON.stringify({ provenance: DONE.provenance, ...DONE.summary }, null, 2),
           "application/json");
};
document.getElementById("dlPNG").onclick = () => {
  const ids = ["cAgree", "cGood", "cDT", "cSort", "cMI", "cThermo"];
  const condKeys = [...byCond(CURVE).keys()];
  const pal = palette();
  const th = THEMES[STYLE.theme] || THEMES.darkgrid;
  const legendH = condKeys.length ? 30 : 0;
  let i = 0;
  for (const id of ids) {
    setTimeout(() => {
      const cv = document.getElementById(id);
      const srcDpr = window.devicePixelRatio || 1;
      const W = cv.width / srcDpr, H = cv.height / srcDpr;
      const out = document.createElement("canvas");
      const dpr = Math.max(srcDpr, 2);
      out.width = W * dpr; out.height = (H + legendH) * dpr;
      const g = out.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = th.bg; g.fillRect(0, 0, W, H + legendH);
      g.drawImage(cv, 0, 0, W, H);
      if (condKeys.length) {          // legend strip below the plot
        g.font = "11px system-ui";
        let lx = 8, ly = H + 19;
        for (let ci = 0; ci < condKeys.length; ci++) {
          const name = condKeys[ci];
          const entryW = 17 + g.measureText(name).width + 16;
          if (lx + entryW > W - 8) { lx = 8; ly += 15; }
          g.fillStyle = pal(name, ci);
          g.fillRect(lx, ly - 8, 12, 9);
          g.fillStyle = th.fg;
          g.fillText(name, lx + 17, ly);
          lx += entryW;
        }
      }
      const a = document.createElement("a");
      a.href = out.toDataURL("image/png");
      a.download = `${id}_${DONE ? DONE.provenance.experiment : "live"}.png`;
      a.click();
    }, 300 * i++);
  }
};
// ---- combined multi-panel export -------------------------------------------
// Composites the six panels (A-F) + a suptitle block onto one offscreen canvas.
const PANELS = [
  ["cAgree",  "A · Learning curve — demon agreement"],
  ["cGood",   "B · Good : bad crossing ratio"],
  ["cDT",     "C · Temperature differential ΔT"],
  ["cSort",   "D · Sorting entropy reduction"],
  ["cMI",     "E · Neural mutual information"],
  ["cThermo", "F · Thermodynamic budget"],
];
document.getElementById("dlCombo").onclick = () => {
  const th = THEMES[STYLE.theme] || THEMES.darkgrid;
  const dpr = Math.max(window.devicePixelRatio || 1, 2);   // >=2 for print
  const panelW = 640, panelH = 360, pad = 18;
  const cols = 2, rows = 3;
  const titleH = 116;
  const W = cols * panelW + (cols + 1) * pad;
  const H = titleH + rows * panelH + (rows + 1) * pad;
  const out = document.createElement("canvas");
  out.width = W * dpr; out.height = H * dpr;
  const g = out.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = th.bg; g.fillRect(0, 0, W, H);

  // --- suptitle block ---
  const expName = DONE ? (DONE.provenance.label || DONE.provenance.experiment) : "live run";
  g.fillStyle = th.fg;
  g.font = "700 22px system-ui";
  g.fillText("Fly–Demon Lab — live experiment panels", pad + 2, 34);
  g.font = "13px system-ui";
  g.fillStyle = th.fg; g.globalAlpha = 0.85;
  const prov = DONE ? DONE.provenance : null;
  const line2 = expName + (prov
    ? ` — ${prov.seeds} seed(s) · ${prov.trainTrials}+${prov.testTrials} trials · ${prov.episodeSeconds}s episodes · ${prov.nParticles} particles`
    : " — snapshot of the currently streaming run");
  g.fillText(line2, pad + 2, 56);
  g.globalAlpha = 0.6;
  g.fillText(`style: seaborn-${STYLE.theme} · palette: ${STYLE.pal} · kind: ${STYLE.kind} · exported ${new Date().toISOString()}`,
             pad + 2, 74);
  g.globalAlpha = 1;

  // --- shared legend row (figlegend style): one entry per condition ---------
  const condKeys = [...byCond(CURVE).keys()];
  if (condKeys.length) {
    const pal = palette();
    let lx = pad + 2;
    let ly = 100;                      // legend baseline inside the title block
    g.font = "12px system-ui";
    for (let ci = 0; ci < condKeys.length; ci++) {
      const name = condKeys[ci];
      const color = pal(name, ci);
      const nameW = g.measureText(name).width;
      const entryW = 20 + nameW + 22;  // swatch + gap + text + inter-entry gap
      if (lx + entryW > W - pad) {     // wrap to the next legend row
        lx = pad + 2; ly += 17;
      }
      g.fillStyle = color;
      g.fillRect(lx, ly - 9, 14, 10);  // swatch
      g.strokeStyle = th.spines ? th.fg : th.grid; g.lineWidth = 1;
      g.strokeRect(lx, ly - 9, 14, 10);
      g.fillStyle = th.fg;
      g.fillText(name, lx + 20, ly);
      lx += entryW;
    }
  }

  // --- panels ---
  PANELS.forEach(([id, label], i) => {
    const src = document.getElementById(id);
    if (!src) return;
    const cx = pad + (i % cols) * (panelW + pad);
    const cy = titleH + Math.floor(i / cols) * (panelH + pad);
    // panel frame + lettering
    g.strokeStyle = th.spines ? th.fg : th.grid;
    g.lineWidth = 1;
    g.strokeRect(cx, cy, panelW, panelH);
    g.fillStyle = th.fg;
    g.font = "600 13px system-ui";
    g.fillText(label, cx + 8, cy + 18);
    // source canvas scaled into the panel (aspect-preserving, top-aligned)
    const iw = src.width / (window.devicePixelRatio || 1), ih = src.height / (window.devicePixelRatio || 1);
    const scale = Math.min((panelW - 12) / iw, (panelH - 30) / ih);
    const dw = iw * scale, dh = ih * scale;
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    g.drawImage(src, cx + (panelW - dw) / 2, cy + 26, dw, dh);
  });

  // --- footer note ---
  g.globalAlpha = 0.55;
  g.fillStyle = th.fg;
  g.font = "11px system-ui";
  g.fillText("All quantities are computational measures of the simulated chamber (1 sim energy unit = 1e-21 J), not biological measurements.",
             pad + 2, H - 8);
  g.globalAlpha = 1;

  const a = document.createElement("a");
  a.href = out.toDataURL("image/png");
  a.download = `combined_figure_${DONE ? DONE.provenance.experiment : "live"}_${STYLE.theme}.png`;
  a.click();
};

document.getElementById("dlTable").onclick = () => {
  if (!DONE) return;
  const conds = DONE.summary.conditions;
  const cols = ["condition", "testAgreement", "testGoodBadRatio", "testDT",
                "testSortEntropy", "testMiNeural", "testWorkInJ", "testExtractableJ",
                "testErasureCostJ", "testMeasuredBits"];
  let csv = cols.join(",") + "\n";
  for (const [k, c] of Object.entries(conds)) {
    csv += cols.map(col => {
      const v = c[col];
      if (v && typeof v === "object" && "mean" in v) return v.mean;
      return typeof v === "number" ? v : "";
    }).join(",") + "\n";
  }
  download(`results_table_${DONE.provenance.experiment}.csv`, csv, "text/csv");
};

// ---- brain-outcome heatmap (per-experiment neuron firing) ------------------
// Rows: brain layers/regions reported by the controller's layerSpikeRates().
// Cols: trial blocks (train then test, split into NB bins of trials).
// Cell: mean firing rate. Rendered with a magma-like scientific colormap.
const MAGMA = [
  [0,0,4],[28,16,68],[79,18,123],[129,37,129],[181,54,122],[229,80,100],
  [251,135,97],[254,194,135],[252,253,191]   // dark purple -> orange -> light yellow
];
// jet ramp (thermal camera look) for all brain-activity views
function jetColor(t){
  t = Math.min(1, Math.max(0, t));
  const r = Math.min(1, Math.max(0, 1.5 - Math.abs(4*t - 3)));
  const g = Math.min(1, Math.max(0, 1.5 - Math.abs(4*t - 2)));
  const b = Math.min(1, Math.max(0, 1.5 - Math.abs(4*t - 1)));
  return `rgb(${(r*255)|0},${(g*255)|0},${(b*255)|0})`;
}
function magmaColor(t){
  t = Math.max(0, Math.min(1, t));
  const x = t * (MAGMA.length - 1), i = Math.min(MAGMA.length - 2, Math.floor(x));
  const f = x - i;
  const c = MAGMA[i].map((v, k) => Math.round(v + f * (MAGMA[i+1][k] - v)));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
let BRAIN_DATA = null;
let LAST_ROWS = [];   // { label, layers:[names], blocks:[[colIndex->labels]], matrix:{layer:[means]} , prov }

function collectBrainData(summary, rows, label){
  if (!rows || !rows.length) return null;
  const withRates = rows.filter(r => r.layerRates);
  if (!withRates.length) return null;                 // E1/E6: no fly brain
  const layerNames = Object.keys(withRates[0].layerRates);
  if (!layerNames.length) return null;
  const NB = 8;
  const blocks = new Map();                           // phase -> [ {sums, n} x NB ]
  for (const r of withRates){
    const ph = r.phase === "test" ? "test" : "train";
    if (!blocks.has(ph)) blocks.set(ph, Array.from({length: NB}, () => ({ sums: new Float64Array(layerNames.length), n: 0 })));
    const arr = blocks.get(ph);
    const bi = Math.min(NB - 1, Math.floor(r.trial * NB / Math.max(1, NB)));
    const b = arr[bi];
    layerNames.forEach((ln, k) => b.sums[k] += r.layerRates[ln] || 0);
    b.n++;
  }
  const cols = [], matrix = layerNames.map(() => []);
  const pushCols = (ph, tag) => {
    const arr = blocks.get(ph); if (!arr) return;
    arr.forEach((b, bi) => {
      if (!b.n) return;
      cols.push(tag + " " + (bi + 1));
      layerNames.forEach((ln, k) => matrix[layerNames.indexOf(ln)].push(b.sums[k] / b.n));
    });
  };
  pushCols("train", "train");
  pushCols("test", "test");
  if (!cols.length) return null;
  return { label, layers: layerNames, cols, matrix };
}

function drawBrainHeatmap(canvas, data){
  const g = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  g.clearRect(0, 0, W, H);
  if (!data) return;
  const padL = 265, padT = 56, padR = 24, padB = 44;
  const nR = data.layers.length, nC = data.cols.length;
  const cw = (W - padL - padR) / nC, chh = (H - padT - padB) / nR;
  // global max for normalization (per-row would hide magnitude differences)
  let vmax = 0;
  for (const row of data.matrix) for (const v of row) vmax = Math.max(vmax, v);
  if (vmax <= 0) vmax = 1;
  for (let r = 0; r < nR; r++)
    for (let c = 0; c < nC; c++){
      g.fillStyle = jetColor(data.matrix[r][c] / vmax);
      g.fillRect(padL + c * cw, padT + r * chh, Math.max(1, cw - 2), Math.max(1, chh - 2));
    }
  // labels
  g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--fg") || "#e6edf3";
  g.font = "12px ui-sans-serif,system-ui";
  g.textAlign = "right";
  data.layers.forEach((ln, r) => g.fillText(ln.length > 34 ? ln.slice(0, 33) + "…" : ln, padL - 8, padT + r * chh + chh / 2 + 4));
  g.textAlign = "center";
  g.save();
  g.translate(0, 0);
  data.cols.forEach((cl, c) => {
    g.save();
    g.translate(padL + c * cw + cw / 2, padT - 8);
    g.rotate(-Math.PI / 4);
    g.textAlign = "right";
    g.fillText(cl, 0, 0);
    g.restore();
  });
  g.restore();
  // colorbar
  const cbX = W - 14, cbY = padT, cbH = H - padT - padB;
  for (let y = 0; y < cbH; y++){
    g.fillStyle = jetColor(1 - y / cbH);
    g.fillRect(cbX, cbY + y, 8, 1);
  }
  g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--fg") || "#e6edf3";
  g.font = "10px ui-sans-serif,system-ui"; g.textAlign = "left";
  g.fillText(vmax.toPrecision(3), cbX - 2, padT + 8);
  g.fillText("0", cbX - 2, cbY + cbH);
  // caption
  g.textAlign = "left";
  g.fillText(data.label + " — mean spikes/step per region", padL, H - 10);
}

function renderBrain(){
  const wrap = document.getElementById("brainWrap");
  if (!BRAIN_DATA){ wrap.innerHTML = '<div class="empty">waiting for a run with a fly brain…</div>'; return; }
  wrap.innerHTML = "";
  const cv = document.createElement("canvas");
  cv.width = 1000; cv.height = 64 + BRAIN_DATA.layers.length * 44 + 40;
  drawBrainHeatmap(cv, BRAIN_DATA);
  wrap.appendChild(cv);
}
// keep the real-anatomy maps in #brainWrap (the block heatmap went to the
// gallery fallback); the anat figures were already appended by renderAnatMaps.
function renderBrainEmpty(){ /* real-anatomy maps are showing */ }

// ---- per-experiment brain-outcome gallery ----------------------------------
// one mini heatmap snapshot per finished run, keyed by experiment id; the most
// recent run per experiment is kept. Every snapshot downloads on click.
const GALLERY = new Map();      // expId -> { dataURL, label, layers, when }
const GALLERY_ORDER = ["e2","e3","e4","e5","e7","e8"];
const GALLERY_TINT = { e2:"#3a7d8c", e3:"#3a7d5c", e4:"#7d3a6c", e5:"#7d5a3a",
                       e7:"#3a5a8c", e8:"#6c6a3a" };

function drawMiniBrainHeatmap(canvas, data, title){
  const g = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  g.clearRect(0, 0, W, H);
  const fg = getComputedStyle(document.documentElement).getPropertyValue("--fg") || "#e6edf3";
  g.fillStyle = fg; g.font = "bold 13px ui-sans-serif,system-ui"; g.textAlign = "left";
  g.fillText(title, 8, 15);
  if (!data || !data.layers) return;
  const padL = 118, padT = 30, padR = 30, padB = 14;
  const nR = data.layers.length, nC = data.cols.length;
  const cw = (W - padL - padR) / nC, chh = (H - padT - padB) / nR;
  let vmax = 0;
  for (const row of data.matrix) for (const v of row) vmax = Math.max(vmax, v);
  if (vmax <= 0) vmax = 1;
  for (let r = 0; r < nR; r++)
    for (let c = 0; c < nC; c++){
      g.fillStyle = jetColor(data.matrix[r][c] / vmax);
      g.fillRect(padL + c * cw, padT + r * chh, Math.max(1, cw - 1), Math.max(1, chh - 1));
    }
  g.fillStyle = fg; g.font = "9px ui-sans-serif,system-ui"; g.textAlign = "right";
  data.layers.forEach((ln, r) =>
    g.fillText(ln.length > 16 ? ln.slice(0, 15) + "…" : ln, padL - 5, padT + r * chh + chh / 2 + 3));
  const cbX = W - 13, cbY = padT, cbH = H - padT - padB;
  for (let y = 0; y < cbH; y++){ g.fillStyle = jetColor(1 - y / cbH); g.fillRect(cbX, cbY + y, 5, 1); }
}

function galleryKeys(){
  return GALLERY_ORDER.filter(k => GALLERY.has(k))
    .concat([...GALLERY.keys()].filter(k => !GALLERY_ORDER.includes(k)));
}
function renderBrainGallery(){
  const wrap = document.getElementById("brainGallery");
  if (!wrap) return;
  const keys = galleryKeys();
  if (!keys.length){
    wrap.innerHTML = '<div class="empty">no snapshots yet — finish an experiment with a fly brain (E2–E5, E7, E8)</div>';
    return;
  }
  wrap.innerHTML = "";
  wrap.style.display = "flex"; wrap.style.flexWrap = "wrap"; wrap.style.gap = "10px";
  for (const k of keys){
    const snap = GALLERY.get(k);
    const img = document.createElement("img");
    img.src = snap.dataURL; img.width = 460; img.style.borderRadius = "6px";
    img.style.border = "1px solid " + (GALLERY_TINT[k] || "#456");
    img.title = snap.label + " — click to download";
    img.style.cursor = "pointer";
    img.onclick = () => {
      const a = document.createElement("a");
      a.download = "brain_heatmap_" + k + ".png"; a.href = snap.dataURL; a.click();
    };
    wrap.appendChild(img);
  }
  renderDeltaGallery();
}
function renderDeltaGallery(){
  const wrap = document.getElementById("deltaGallery");
  if (!wrap) return;
  const keys = galleryKeys().filter(k => GALLERY.get(k).deltaURL);
  if (!keys.length){
    wrap.innerHTML = '<div class="empty">no delta snapshots yet — finish an experiment with a fly brain (E2–E5, E7, E8)</div>';
    return;
  }
  wrap.innerHTML = "";
  wrap.style.display = "flex"; wrap.style.flexWrap = "wrap"; wrap.style.gap = "10px";
  for (const k of keys){
    const snap = GALLERY.get(k);
    const img = document.createElement("img");
    img.src = snap.anatDeltaURL || snap.deltaURL; img.width = 460; img.style.borderRadius = "6px";
    img.style.border = "1px solid " + (GALLERY_TINT[k] || "#456");
    img.title = snap.label + " — Δ firing (late − early) — click to download";
    img.style.cursor = "pointer";
    img.onclick = () => {
      const a = document.createElement("a");
      a.download = "brain_deltas_" + k + ".png"; a.href = snap.deltaURL; a.click();
    };
    wrap.appendChild(img);
  }
}

// ---- learning-delta 3D brain figure -----------------------------------------
// WHERE did learning change firing? Aggregate the controllers' layer rates
// into six functional brain regions, then render the real FAFB v783 anatomy
// in 3D (axon view): translucent region hulls, neurons tinted by their
// late−early change, the most-changed region ringed, and ONE curved arrow
// from sensory input to motor output through the learning structure.
const REGION_STYLE = {
  optic:   { hue: 205, color: "dodgerblue"  },
  antennal:{ hue: 150, color: "seagreen"    },
  mb:      { hue: 50,  color: "gold"        },
  lh:      { hue: 25,  color: "orange"      },
  cx:      { hue: 280, color: "orchid"      },
  motor:   { hue: 0,   color: "tomato"      },
  central: { hue: 210, color: "lightslategray" }
};
const REGION_TITLE = { optic: "optic lobe", antennal: "antennal lobe", mb: "mushroom body",
                       lh: "lateral horn", cx: "central complex", motor: "motor (GNG)",
                       central: "central brain" };
const REGION_ORDER = ["optic", "antennal", "mb", "lh", "cx", "motor", "central"];
// 3D axon view of the fly brain: rotate each neuron's (x, z) about the
// brain's centre (depth-ordered painter's sort, screen y = world y).
function drawDeltaBrainFigure(canvas, data, title){
  const g = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const fg = getComputedStyle(document.documentElement).getPropertyValue("--fg") || "#e6edf3";
  g.fillStyle = "#0d1117"; g.fillRect(0, 0, W, H);
  g.fillStyle = fg; g.font = "bold 13px ui-sans-serif,system-ui"; g.textAlign = "left";
  g.fillText(title, 8, 16);
  const B = anatBounds();
  if (!B || !ANAT.ready){
    g.fillStyle = "#8b98a5"; g.fillText("anatomy positions loading…", 8, H / 2); return;
  }
  const conds = data.conds, n = ANAT.meta.n;
  // per-condition region deltas: aggregate layer deltas through regionForRateName
  const condReg = conds.map((c, ci) => {
    const acc = {};
    data.layers.forEach((ln, k) => {
      const rk = regionForRateName(ln);
      acc[rk] = (acc[rk] || 0) + data.matrix[ci][k];
    });
    return acc;
  });
  // shared color scale across the figure's panels
  let gmax = 1e-12;
  for (const acc of condReg) for (const rk in acc) gmax = Math.max(gmax, Math.abs(acc[rk]));
  const cols = Math.max(1, Math.min(conds.length, 3));
  const pw = Math.floor((W - 40) / cols) - 14, ph = H - 96;
  const cxw = (B.x0 + B.x1) / 2, cyw = (B.y0 + B.y1) / 2;
  // depth-cache: z-rotate once; per-condition only the tint changes
  const cached = {};
  const projFor = (yawDeg) => {
    const key = yawDeg.toFixed(0);
    if (cached[key]) return cached[key];
    const yaw = yawDeg * Math.PI / 180, cy = Math.cos(yaw), sy = Math.sin(yaw);
    const pts = new Float32Array(n * 3);   // sx, sy, depth
    const bsz = Math.max(B.x1 - B.x0, 1);
    for (let i = 0; i < n; i++){
      const x = ANAT.pos[i*3] - cxw, y = ANAT.pos[i*3+1], z = ANAT.pos[i*3+2];
      const rx = x * cy - z * sy, rz = x * sy + z * cy;
      const s = Math.min(pw / bsz, ph / Math.max(1, B.y1 - B.y0)) * 0.98;
      pts[i*3] = pw / 2 + rx * s;
      pts[i*3+1] = ph / 2 - (y - cyw) * s;
      pts[i*3+2] = rz;
    }
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => pts[a*3+2] - pts[b*3+2]);
    const out = { pts, order, key };
    cached[key] = out;
    return out;
  };
  const pairs = conds.map((c, ci) => ({ c, ci, acc: condReg[ci] }));
  pairs.sort((a, b) => {
    const top = (o) => { let mk = "central", mv = -1e9;
      for (const rk in o){ const v = Math.abs(o[rk]); if (v > mv){ mv = v; mk = rk; } } return mk; };
    return REGION_ORDER.indexOf(top(a.acc)) - REGION_ORDER.indexOf(top(b.acc));
  });
  const YAW = { optic: 0, antennal: 10, mb: 35, lh: 50, cx: 65, motor: 80, central: 25 };
  const PATH = { optic:   ["optic", "central", "motor"],
                 antennal:["antennal", "lh", "mb", "motor"],
                 mb:      ["antennal", "mb", "motor"],
                 lh:      ["antennal", "lh", "motor"],
                 cx:      ["optic", "cx", "motor"],
                 motor:   ["central", "motor"],
                 central: ["antennal", "central", "motor"] };
  const regionPoints = {};
  for (let i = 0; i < n; i++){
    const rk = ANAT.npRegion.get(ANAT.meta.np_names[ANAT.prim[i]]);
    if (!rk) continue;
    (regionPoints[rk] = regionPoints[rk] || { x: 0, y: 0, z: 0, n: 0 });
    regionPoints[rk].x += ANAT.pos[i*3]; regionPoints[rk].y += ANAT.pos[i*3+1];
    regionPoints[rk].z += ANAT.pos[i*3+2]; regionPoints[rk].n++;
  }
  pairs.forEach((p, pi) => {
    const acc = p.acc;
    let top = "central", mv = -1e9, sign = 0;
    for (const rk in acc){ const v = Math.abs(acc[rk]); if (v > mv){ mv = v; top = rk; sign = Math.sign(acc[rk]); } }
    const yaw = YAW[top] !== undefined ? YAW[top] : 25;
    const ox = 20 + pi * (pw + 14), oy = 44;
    const pr = projFor(yaw);
    const pts = pr.pts, order = pr.order;
    // hull silhouettes, depth-sorted back-to-front with the dots
    const byReg = {};
    if (ANAT.hulls && ANAT.hulls.length){
      for (const hl of ANAT.hulls){
        const rk = ANAT.npRegion.get(hl.name) || "central";
        (byReg[rk] = byReg[rk] || []).push(hl);
      }
    }
    const items = [];
    for (const rk in byReg){
      let z = 0, cnt = 0;
      for (const hl of byReg[rk]){ const t = hl.tri;
        for (let v = 0; v < t.length; v += 9){ z += t[v+2] + t[v+5] + t[v+8]; cnt += 3; } }
      items.push({ kind: "hull", rk, z: cnt ? z / cnt : 0, hulls: byReg[rk] });
    }
    items.push({ kind: "dots", rk: null, z: -1e9 });
    items.sort((a, b) => a.z - b.z);
    // region-delta tint for this panel
    const tintOf = (rk) => {
      const dv = acc[rk] || 0, t = dv / gmax;
      if (Math.abs(t) < 0.15) return "rgba(140,150,165,0.10)";   // unchanged: gray wash
      return t > 0 ? "rgba(229,57,53," + (0.05 + 0.30 * Math.min(1, Math.abs(t))).toFixed(2) + ")"
                   : "rgba(30,136,229," + (0.05 + 0.30 * Math.min(1, Math.abs(t))).toFixed(2) + ")";
    };
    for (const it of items){
      if (it.kind === "hull"){
        const col = tintOf(it.rk);
        // uniform region tint: fill all triangles opaque into a scratch
        // canvas, then composite once at the tint's alpha (per-triangle
        // alpha stacking floods large regions like the optic lobe)
        const oc = document.createElement("canvas"); oc.width = Math.max(1, pw); oc.height = Math.max(1, ph);
        const og = oc.getContext("2d"); og.fillStyle = "#fff";
        for (const hl of it.hulls){
          const t = hl.tri; og.beginPath();
          for (let v = 0; v < t.length; v += 9){
            const a = proj3(t[v]*10, t[v+1]*10, t[v+2]*10, pr, ox, oy, pw, ph);
            const b = proj3(t[v+3]*10, t[v+4]*10, t[v+5]*10, pr, ox, oy, pw, ph);
            const c = proj3(t[v+6]*10, t[v+7]*10, t[v+8]*10, pr, ox, oy, pw, ph);
            og.moveTo(a[0] - ox, a[1] - oy); og.lineTo(b[0] - ox, b[1] - oy); og.lineTo(c[0] - ox, c[1] - oy);
          }
          og.closePath(); og.fill();
        }
        const tc = document.createElement("canvas"); tc.width = oc.width; tc.height = oc.height;
        const tg2 = tc.getContext("2d");
        tg2.drawImage(oc, 0, 0);
        tg2.globalCompositeOperation = "source-in";
        tg2.fillStyle = col.replace(/,[\d.]+\)$/, ",1)");
        tg2.fillRect(0, 0, tc.width, tc.height);
        const ma = col.match(/([\d.]+)\)$/);
        g.globalAlpha = ma ? Math.min(1, parseFloat(ma[1])) : 1;
        g.drawImage(tc, ox, oy);
        g.globalAlpha = 1;
        // most-changed region: soft glow silhouette instead of stroking
        // every triangle (thousands of tiny strokes read as a solid fill)
        if (it.rk === top && Math.abs(acc[top] || 0) >= 0.15 * gmax){
          const sc = document.createElement("canvas"); sc.width = oc.width; sc.height = oc.height;
          const sg2 = sc.getContext("2d");
          sg2.shadowColor = sign >= 0 ? "rgba(255,120,110,0.9)" : "rgba(100,180,255,0.9)";
          sg2.shadowBlur = 7;
          sg2.drawImage(oc, 0, 0);
          sg2.globalCompositeOperation = "destination-out";
          sg2.drawImage(oc, 0, 0);
          g.drawImage(sc, ox, oy);
        }
      } else {
        for (const i of order){
          const rk = ANAT.npRegion.get(ANAT.meta.np_names[ANAT.prim[i]]);
          if (rk === top) continue;
          g.fillStyle = "rgba(120,132,148,0.30)";
          g.fillRect(ox + pts[i*3] - 0.5, oy + pts[i*3+1] - 0.5, 1.1, 1.1);
        }
      }
    }
    // firing-delta dots of the learning region on top — only when the region
    // meaningfully changed (same threshold as the gray-wash tint), so a huge
    // unchanged region (e.g. the optic lobe at Δ ≈ 0) never floods solid
    if (Math.abs(acc[top] || 0) >= 0.15 * gmax){
      const tcol = sign >= 0 ? [229, 57, 53] : [30, 136, 229];
      const tmag = Math.min(1, Math.abs(acc[top]) / gmax);
      const da = 0.10 + 0.45 * tmag;               // delta-scaled opacity
      let seen = 0, stride = 1;
      for (const i of order) if (ANAT.npRegion.get(ANAT.meta.np_names[ANAT.prim[i]]) === top) seen++;
      if (seen > 6000) stride = Math.ceil(seen / 6000);
      let k = 0;
      for (const i of order){
        const rk = ANAT.npRegion.get(ANAT.meta.np_names[ANAT.prim[i]]);
        if (rk !== top) continue;
        if (k++ % stride) continue;
        g.fillStyle = "rgba(" + tcol[0] + "," + tcol[1] + "," + tcol[2] + "," + da.toFixed(2) + ")";
        g.fillRect(ox + pts[i*3] - 0.5, oy + pts[i*3+1] - 0.5, 1.1, 1.1);
      }
    }
    // ONE pathway: curved arrow from sensory input through the top region to motor
    const chain = (PATH[top] || PATH.central).slice();
    if (chain.indexOf(top) < 0) chain.splice(1, 0, top);
    const cps = [];
    for (const rk of chain){
      const c3 = regionPoints[rk];
      if (!c3) continue;
      cps.push(proj3(c3.x / c3.n, c3.y / c3.n, c3.z / c3.n, pr, ox, oy, pw, ph));
    }
    if (cps.length >= 2){
      g.strokeStyle = sign >= 0 ? "rgba(255,140,130,0.95)" : "rgba(120,190,255,0.95)";
      g.lineWidth = 1.6; g.setLineDash([]);
      g.beginPath(); g.moveTo(cps[0][0], cps[0][1]);
      for (let i2 = 1; i2 < cps.length; i2++){
        const mx = (cps[i2-1][0] + cps[i2][0]) / 2, my = (cps[i2-1][1] + cps[i2][1]) / 2;
        const dx = cps[i2][0] - cps[i2-1][0], dy = cps[i2][1] - cps[i2-1][1];
        const len = Math.hypot(dx, dy) || 1;
        g.quadraticCurveTo(mx - dy / len * 12, my + dx / len * 12, cps[i2][0], cps[i2][1]);
      }
      g.stroke();
      const e = cps[cps.length - 1], pe = cps[cps.length - 2];
      const ang = Math.atan2(e[1] - pe[1], e[0] - pe[0]);
      g.beginPath(); g.moveTo(e[0], e[1]);
      g.lineTo(e[0] - 7 * Math.cos(ang - 0.45), e[1] - 7 * Math.sin(ang - 0.45));
      g.lineTo(e[0] - 7 * Math.cos(ang + 0.45), e[1] - 7 * Math.sin(ang + 0.45));
      g.closePath(); g.fillStyle = g.strokeStyle; g.fill();
    }
    // node dots + label
    for (const rk of chain){
      const c3 = regionPoints[rk]; if (!c3) continue;
      const q = proj3(c3.x / c3.n, c3.y / c3.n, c3.z / c3.n, pr, ox, oy, pw, ph);
      g.beginPath(); g.arc(q[0], q[1], 2.4, 0, 7);
      g.fillStyle = (REGION_STYLE[rk] || REGION_STYLE.central).color; g.fill();
      g.strokeStyle = "#0d1117"; g.lineWidth = 1; g.stroke();
    }
    g.fillStyle = fg; g.font = "10px ui-sans-serif,system-ui";
    const dtop = acc[top] || 0;
    g.fillText(p.c + " — " + (REGION_TITLE[top] || top) + " · Δ " + (dtop >= 0 ? "+" : "−") + Math.abs(dtop).toPrecision(2), ox, oy + ph + 14);
    function proj3(x, y, z, P, ox2, oy2, pw2, ph2){
      const yaw2 = yaw * Math.PI / 180, cy2 = Math.cos(yaw2), sy2 = Math.sin(yaw2);
      const rx = (x - cxw) * cy2 - z * sy2;
      const s = Math.min(pw2 / Math.max(1, B.x1 - B.x0), ph2 / Math.max(1, B.y1 - B.y0)) * 0.98;
      return [ox2 + pw2 / 2 + rx * s, oy2 + ph2 / 2 - (y - cyw) * s];
    }
  });
  // shared diverging colorbar
  const cbX = W - 30, cbY = 44, cbH = ph;
  for (let y = 0; y < cbH; y++){ g.fillStyle = divColor(1 - 2 * y / cbH); g.fillRect(cbX, cbY + y, 7, 1); }
  g.fillStyle = fg; g.font = "9px ui-sans-serif,system-ui"; g.textAlign = "right";
  g.fillText("+" + gmax.toPrecision(2), cbX - 3, cbY + 8);
  g.fillText("−" + gmax.toPrecision(2), cbX - 3, cbY + cbH);
  g.textAlign = "left";
  g.fillStyle = "#8b98a5"; g.font = "9px ui-sans-serif,system-ui";
  g.fillText("real FAFB v783 · red = fires more after learning · blue = less · ring = most-changed region · arrow = one pathway → motor", 20, H - 12);
}

// diverging blue-white-red: t in [-1,1]; deltas need sign, jet is for magnitude
function divColor(t){
  t = Math.max(-1, Math.min(1, t));
  const a = Math.abs(t);
  const lo = t < 0 ? [49, 54, 149] : [178, 24, 43];
  const mix = (c) => Math.round(255 + (c - 255) * a);
  return `rgb(${mix(lo[0])},${mix(lo[1])},${mix(lo[2])})`;
}
function collectBrainDeltas(rows){
  if (!rows || !rows.length) return null;
  const withRates = rows.filter(r => r.layerRates);
  if (!withRates.length) return null;
  const layerNames = Object.keys(withRates[0].layerRates);
  if (!layerNames.length) return null;
  const groups = new Map();
  for (const r of withRates){
    const g = r.condition || "model";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(r);
  }
  const conds = [...groups.keys()];
  const stat = (rs, lo, hi, ph) => {
    const sums = new Float64Array(layerNames.length); let n = 0;
    for (const r of rs){
      if (ph && r.phase !== ph) continue;
      if (r.trial < lo || r.trial >= hi) continue;
      layerNames.forEach((ln, k) => sums[k] += r.layerRates[ln] || 0);
      n++;
    }
    return { sums, n };
  };
  let vmax = 0;
  const deltas = conds.map((c) => {
    const rs = groups.get(c);
    const tr = rs.map(r => r.trial);
    const lo = Math.min(...tr), hi = Math.max(...tr) + 1, mid = Math.floor((lo + hi) / 2);
    const early = stat(rs, lo, mid, "train"), late = stat(rs, mid, hi, "train");
    return layerNames.map((ln, k) => {
      const e = early.n ? early.sums[k] / early.n : 0;
      const l = late.n ? late.sums[k] / late.n : 0;
      const d = l - e;
      vmax = Math.max(vmax, Math.abs(d));
      return d;
    });
  });
  if (!vmax) return null;
  return { conds, layers: layerNames, matrix: deltas, vmax };
}
function drawMiniDeltaHeatmap(canvas, data, title){
  const g = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  g.clearRect(0, 0, W, H);
  const fg = getComputedStyle(document.documentElement).getPropertyValue("--fg") || "#e6edf3";
  g.fillStyle = fg; g.font = "bold 13px ui-sans-serif,system-ui"; g.textAlign = "left";
  g.fillText(title, 8, 15);
  const padL = 130, padT = 30, padR = 34, padB = 14;
  const nR = data.conds.length, nC = data.layers.length;
  const cw = (W - padL - padR) / nC, chh = (H - padT - padB) / nR;
  for (let r = 0; r < nR; r++)
    for (let c = 0; c < nC; c++){
      g.fillStyle = divColor(data.matrix[r][c] / data.vmax);
      g.fillRect(padL + c * cw, padT + r * chh, Math.max(1, cw - 1), Math.max(1, chh - 1));
    }
  g.fillStyle = fg; g.font = "9px ui-sans-serif,system-ui"; g.textAlign = "right";
  data.conds.forEach((cn, r) =>
    g.fillText(cn.length > 17 ? cn.slice(0, 16) + "…" : cn, padL - 5, padT + r * chh + chh / 2 + 3));
  g.font = "8.5px ui-sans-serif,system-ui"; g.textAlign = "center";
  data.layers.forEach((ln, c) => {
    g.save();
    g.translate(padL + c * cw + cw / 2, padT - 4);
    g.rotate(-Math.PI / 5);
    g.fillText(ln.length > 12 ? ln.slice(0, 11) + "…" : ln, 0, 0);
    g.restore();
  });
  const cbX = W - 14, cbY = padT, cbH = H - padT - padB;
  for (let y = 0; y < cbH; y++){ g.fillStyle = divColor(1 - 2 * y / cbH); g.fillRect(cbX, cbY + y, 6, 1); }
  g.fillStyle = fg; g.font = "8.5px ui-sans-serif,system-ui"; g.textAlign = "left";
  g.fillText("+" + data.vmax.toPrecision(3), cbX - 2, padT + 7);
  g.fillText("−" + data.vmax.toPrecision(3), cbX - 2, cbY + cbH);
}
// ---- REAL-ANATOMY firing maps ------------------------------------------------
// Positions come from fly_brain_positions.bin (FAFB v783 per-neuron mean
// post-synaptic positions, scene-mapped) + fly_brain_meta.json. A run's
// fireVecMean rows carry quantized per-neuron firing; we paint neurons at
// their real coordinates in jet colors.
const ANAT = { ready: false, pos: null, prim: null, meta: null, npRegion: null };
(async function loadAnatomy(){
  try {
    const [buf, meta] = await Promise.all([
      fetch("fly_brain_positions.bin",{cache:"no-cache"}).then(r => r.ok ? r.arrayBuffer() : null),
      fetch("fly_brain_meta.json",{cache:"no-cache"}).then(r => r.ok ? r.json() : null),
    ]);
    if (!buf || !meta) return;
    if (!meta.n || buf.byteLength !== meta.n * 7) meta.n = Math.floor(buf.byteLength / 7);   // 7 B/neuron (Int16 x3 + Uint8 prim); stale/mismatched meta must never misparse the buffer
    ANAT.pos = new Int16Array(buf, 0, meta.n * 3);
    ANAT.prim = new Uint8Array(buf, meta.n * 6, meta.n);
    ANAT.meta = meta;
    ANAT.npRegion = new Map();
    for (const rk in meta.region_of)
      for (const nm of meta.region_of[rk]) ANAT.npRegion.set(nm, rk);
    ANAT.ready = true;
    // hull silhouettes (optional): same canonical frame, scene units — drawn
    // under the heat so every map shows the brain's anatomy like a reference
    // flywire-style render (translucent gray lobes + central brain).
    try {
      const [hbuf] = await Promise.all([
        fetch("fly_brain_hulls.bin",{cache:"no-cache"}).then(r => r.ok ? r.arrayBuffer() : null),
      ]);
      if (hbuf){
        const dv = new DataView(hbuf); let off = 0; const hulls = [];
        const td = new TextDecoder();
        while (off < hbuf.byteLength - 1){
          const nameLen = dv.getUint8(off); off += 1;
          const nm = td.decode(new Uint8Array(hbuf, off, nameLen)); off += nameLen;
          const triCount = dv.getUint16(off, true); off += 2;
          const words = triCount * 9;
          const arr = new Float32Array(words);
          for (let i = 0; i < words; i++){
            const h = dv.getUint16(off + i*2, true);
            const s = (h & 0x8000) >> 15, e = (h & 0x7C00) >> 10, f = h & 0x03FF;
            const v = e === 0 ? Math.pow(2,-14)*(f/1024) :
                      e === 31 ? (f ? NaN : Infinity) :
                      Math.pow(2, e-15) * (1 + f/1024);
            arr[i] = s ? -v : v;
          }
          off += words * 2;
          hulls.push({ name: nm, tri: arr });
        }
        ANAT.hulls = hulls;
      }
    } catch (e) { /* hulls optional */ }
  } catch (e) { /* anatomy maps unavailable; block heatmap remains */ }
})();
function anatJetColor(t){
  t = Math.min(1, Math.max(0, t));
  const r = Math.min(1, Math.max(0, 1.5 - Math.abs(4*t - 3)));
  const g = Math.min(1, Math.max(0, 1.5 - Math.abs(4*t - 2)));
  const b = Math.min(1, Math.max(0, 1.5 - Math.abs(4*t - 1)));
  return [r * 255 | 0, g * 255 | 0, b * 255 | 0];
}
// world bounds of the real positions (Int16 units = 0.1 scene units)
let _anatBoundsCache = null;
function anatBounds(){
  if (_anatBoundsCache) return _anatBoundsCache;
  if (!ANAT.ready) return null;
  let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;
  for (let i = 0; i < ANAT.meta.n; i++){
    const x = ANAT.pos[i*3], y = ANAT.pos[i*3+1];
    if (x<x0)x0=x; if (x>x1)x1=x; if (y<y0)y0=y; if (y>y1)y1=y;
  }
  _anatBoundsCache = { x0, x1, y0, y1 };
  return _anatBoundsCache;
}
function drawAnatMap(canvas, fireBytes, n, title, sub){
  const g = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const fg = getComputedStyle(document.documentElement).getPropertyValue("--fg") || "#e6edf3";
  g.fillStyle = "#0d1117"; g.fillRect(0, 0, W, H);
  g.fillStyle = fg; g.font = "bold 13px ui-sans-serif,system-ui"; g.textAlign = "left";
  g.fillText(title, 8, 16);
  if (sub){ g.font = "10px ui-sans-serif,system-ui"; g.fillStyle = "#8b98a5";
            g.fillText(sub, 8, 30); }
  const B = anatBounds();
  if (!B){ g.fillStyle = "#8b98a5";
    g.fillText("anatomy positions loading…", 8, H/2); return; }
  const padL = 14, padT = 40, padB = 30, padR = 60;
  const bw = W - padL - padR, bh = H - padT - padB;
  const sx = bw / (B.x1 - B.x0), sy = bh / (B.y1 - B.y0);
  const px = new Float32Array(n), py = new Float32Array(n);
  for (let i = 0; i < n; i++){
    const xx = padL + (ANAT.pos[i*3] - B.x0) * sx;
    const yy = H - padB - (ANAT.pos[i*3+1] - B.y0) * sy;
    px[i] = Number.isFinite(xx) ? xx : padL;
    py[i] = Number.isFinite(yy) ? yy : padT;
  }
  // 0) anatomy silhouettes: translucent gray hull fills = the brain's shape
  //    (reference-style render: anatomy underneath, activity on top)
  if (ANAT.hulls && ANAT.hulls.length){
    g.fillStyle = "rgba(150,162,178,0.055)";
    g.strokeStyle = "rgba(175,190,210,0.10)";
    g.lineWidth = 0.4;
    for (const hl of ANAT.hulls){
      const t = hl.tri;
      g.beginPath();
      for (let v = 0; v < t.length; v += 9){
        const x0 = padL + (t[v]*10 - B.x0)*sx,     y0 = H - padB - (t[v+1]*10 - B.y0)*sy;
        const x1 = padL + (t[v+3]*10 - B.x0)*sx,   y1 = H - padB - (t[v+4]*10 - B.y0)*sy;
        const x2 = padL + (t[v+6]*10 - B.x0)*sx,   y2 = H - padB - (t[v+7]*10 - B.y0)*sy;
        g.moveTo(x0, y0); g.lineTo(x1, y1); g.lineTo(x2, y2);
      }
      g.closePath(); g.fill(); g.stroke();
    }
  }
  // 1) quiet baseline: every neuron as a faint deep-blue dot (jet 0) so the
  //    whole brain silhouette reads even where nothing fires
  for (let i = 0; i < n; i++){
    g.fillStyle = "rgba(24,72,190,0.35)";
    g.fillRect(px[i] - 0.5, py[i] - 0.5, 1.2, 1.2);
  }
  // 2) firing heat: relative normalization (95th percentile = near-red),
  //    gamma-compressed, fine additive glows — active regions read as
  //    glowing texture inside the brain, never as saturated blobs.
  let p95 = 0;
  { const smp = [];
    for (let i = 0; i < n; i += 4) if (fireBytes && fireBytes[i] > 0) smp.push(fireBytes[i]);
    if (smp.length){ smp.sort((a,b)=>a-b); p95 = smp[(smp.length*0.95)|0]; } }
  const scale = Math.max(1, p95);
  const tOf = v => Math.min(1, Math.pow(v / scale, 0.65));
  const order = Array.from({length: n}, (_, i) => i);
  order.sort((a, b) => (fireBytes ? fireBytes[a] : 0) - (fireBytes ? fireBytes[b] : 0));
  g.globalCompositeOperation = "lighter";
  for (const i of order){
    const v = fireBytes ? fireBytes[i] : 0;
    if (!v) continue;
    const t = tOf(v);
    if (t < 0.06) continue;                       // skip traces
    const [r, gg, b] = anatJetColor(t);
    const rad = 1.6 + t * 3.6;
    const a = 0.08 + t * 0.34;
    const rg = g.createRadialGradient(px[i], py[i], 0, px[i], py[i], rad);
    rg.addColorStop(0, `rgba(${r},${gg},${b},${a.toFixed(2)})`);
    rg.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    g.fillStyle = rg;
    g.beginPath(); g.arc(px[i], py[i], rad, 0, 7); g.fill();
  }
  // 3) hot cores: bright center dots for the most active cells
  for (const i of order){
    const v = fireBytes ? fireBytes[i] : 0;
    if (!v) continue;
    const t = tOf(v);
    if (t < 0.55) continue;
    const [r, gg, b] = anatJetColor(0.8 + 0.2 * t);
    g.fillStyle = `rgba(${r},${gg},${b},${(0.30 + t * 0.50).toFixed(2)})`;
    g.beginPath(); g.arc(px[i], py[i], 0.6 + t * 1.1, 0, 7); g.fill();
  }
  g.globalCompositeOperation = "source-over";
  // region activity summary (what was active, in words): mean firing per
  // functional region from the per-neuron primary-neuropil annotation
  if (ANAT.npRegion && ANAT.meta.np_names && fireBytes){
    const acc = {}, cnt = {};
    for (let i = 0; i < n; i++){
      const np = ANAT.meta.np_names[ANAT.prim[i]];
      const rk = ANAT.npRegion.get(np);
      if (!rk) continue;
      acc[rk] = (acc[rk] || 0) + fireBytes[i]; cnt[rk] = (cnt[rk] || 0) + 1;
    }
    const rows = Object.keys(acc).map(rk => ({ rk, m: acc[rk] / Math.max(1, cnt[rk]) }))
      .sort((a,b) => b.m - a.m);
    const mx = rows.length ? rows[0].m : 0;
    if (mx > 0){
      g.font = "10px ui-sans-serif,system-ui"; g.textAlign = "left";
      let yy = padT + 12;
      g.fillStyle = "#8b98a5"; g.fillText("region activity (mean firing):", padL, yy); yy += 14;
      for (const r of rows.slice(0, 5)){
        const t = r.m / mx;
        const [rr, gg2, bb] = anatJetColor(t);
        g.fillStyle = `rgb(${rr},${gg2},${bb})`;
        g.beginPath(); g.arc(padL + 4, yy - 3, 4, 0, 7); g.fill();
        g.fillStyle = fg;
        g.fillText(r.rk + "  " + r.m.toFixed(1), padL + 12, yy);
        yy += 13;
      }
    }
  }
  // jet colorbar
  const cbX = W - 34, cbY = padT, cbH = bh;
  for (let y = 0; y < cbH; y++){
    const [r, gg, b] = anatJetColor(1 - y / cbH);
    g.fillStyle = `rgb(${r},${gg},${b})`; g.fillRect(cbX, cbY + y, 8, 1);
  }
  g.fillStyle = fg; g.font = "9px ui-sans-serif,system-ui";
  g.fillText("max", cbX + 12, cbY + 7);
  g.fillText("0", cbX + 12, cbY + cbH);
  g.fillStyle = "#8b98a5"; g.font = "9px ui-sans-serif,system-ui";
  g.fillText("real FAFB v783 · gray = anatomy hulls · jet = mean firing · dots = neurons", padL, H - 10);
}
// Real-anatomy learning-delta maps: late − early per-neuron firing at the
// measured positions over the hull silhouette; diverging blue (fires less
// after learning) ← → red (fires more). One panel per condition.
function drawAnatDeltaMap(canvas, pairs, title){
  const g = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const fg = getComputedStyle(document.documentElement).getPropertyValue("--fg") || "#e6edf3";
  g.fillStyle = "#0d1117"; g.fillRect(0, 0, W, H);
  g.fillStyle = fg; g.font = "bold 13px ui-sans-serif,system-ui"; g.textAlign = "left";
  g.fillText(title, 8, 16);
  const B = anatBounds();
  if (!B){ g.fillStyle = "#8b98a5"; g.fillText("anatomy positions loading…", 8, H/2); return; }
  const n = pairs.length ? pairs[0].late.length : 0;
  const cols = Math.max(1, Math.min(pairs.length, 3));
  const pw = Math.floor((W - 40) / cols) - 14;
  const ph = H - 96;
  let vmax = 0;
  const deltas = pairs.map(p => {
    const d = new Int16Array(n);
    for (let i = 0; i < n; i++){ d[i] = p.late[i] - p.early[i]; const a = Math.abs(d[i]); if (a > vmax) vmax = a; }
    return d;
  });
  if (!vmax) vmax = 1;
  pairs.forEach((p, pi) => {
    const ox = 20 + pi * (pw + 14), oy = 44;
    const sx = pw / (B.x1 - B.x0), sy = ph / (B.y1 - B.y0);
    if (ANAT.hulls && ANAT.hulls.length){
      g.fillStyle = "rgba(150,162,178,0.055)";
      for (const hl of ANAT.hulls){
        const t = hl.tri; g.beginPath();
        for (let v = 0; v < t.length; v += 9){
          g.moveTo(ox + (t[v]*10 - B.x0)*sx,     oy + ph - (t[v+1]*10 - B.y0)*sy);
          g.lineTo(ox + (t[v+3]*10 - B.x0)*sx,   oy + ph - (t[v+4]*10 - B.y0)*sy);
          g.lineTo(ox + (t[v+6]*10 - B.x0)*sx,   oy + ph - (t[v+7]*10 - B.y0)*sy);
        }
        g.closePath(); g.fill();
      }
    }
    const d = deltas[pi];
    for (let i = 0; i < n; i++){
      const t = d[i] / vmax;
      if (Math.abs(t) < 0.08) continue;
      const xx = ox + (ANAT.pos[i*3] - B.x0)*sx, yy = oy + ph - (ANAT.pos[i*3+1] - B.y0)*sy;
      g.fillStyle = divColor(t);
      g.globalAlpha = 0.25 + 0.55*Math.abs(t);
      g.fillRect(xx - 0.6, yy - 0.6, 1.4, 1.4);
    }
    g.globalAlpha = 1;
    g.fillStyle = fg; g.font = "10px ui-sans-serif,system-ui";
    g.fillText(p.cond, ox, oy + ph + 14);
  });
  const cbX = W - 30, cbY = 44, cbH = ph;
  for (let y = 0; y < cbH; y++){ g.fillStyle = divColor(1 - 2*y/cbH); g.fillRect(cbX, cbY + y, 7, 1); }
  g.fillStyle = fg; g.font = "9px ui-sans-serif,system-ui";
  g.fillText("+" + Math.round(vmax), cbX + 10, cbY + 8);
  g.fillText("−" + Math.round(vmax), cbX + 10, cbY + cbH);
  g.fillStyle = "#8b98a5"; g.font = "9px ui-sans-serif,system-ui";
  g.fillText("real FAFB v783 · blue = fires less after learning · red = fires more", 20, H - 12);
}
// Region × time firing strip: one row per region (layer), one column per
// trial (binned when long), jet-colored by mean firing — shows WHICH region
// was active at WHICH point of the run (train → test). Sits under each
// anatomical brain map.
function drawRegionTimeStrip(canvas, rowsC, title){
  const g = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const fg = getComputedStyle(document.documentElement).getPropertyValue("--fg") || "#e6edf3";
  g.fillStyle = "#0d1117"; g.fillRect(0, 0, W, H);
  g.fillStyle = fg; g.font = "bold 12px ui-sans-serif,system-ui"; g.textAlign = "left";
  g.fillText(title, 8, 16);
  if (!rowsC || !rowsC.length) return;
  const regs = Object.keys(rowsC[0].layerRates || {});
  if (!regs.length) return;
  const nT = rowsC.length;
  const maxCols = 140;
  const bin = Math.max(1, Math.ceil(nT / maxCols));
  const nC = Math.ceil(nT / bin);
  const M = regs.map(() => new Float64Array(nC));
  const cnt = new Float64Array(nC);
  rowsC.forEach((r, ti) => {
    const c = Math.min(nC - 1, (ti / bin) | 0);
    cnt[c]++;
    regs.forEach((rg, k) => M[k][c] += r.layerRates[rg] || 0);
  });
  for (let c = 0; c < nC; c++) if (cnt[c]) regs.forEach((rg, k) => M[k][c] /= cnt[c]);
  let vmax = 0;
  for (const row of M) for (const v of row) vmax = Math.max(vmax, v);
  if (vmax <= 0) vmax = 1;
  // hottest region on top
  const mean = M.map(row => row.reduce((a, b) => a + b, 0) / nC);
  const order = regs.map((rg, k) => k).sort((a, b) => mean[b] - mean[a]);
  const padL = 118, padT = 30, padR = 64, padB = 34;
  const cw = (W - padL - padR) / nC, chh = (H - padT - padB) / regs.length;
  order.forEach((k, ri) => {
    for (let c = 0; c < nC; c++){
      g.fillStyle = jetColor(M[k][c] / vmax);
      g.fillRect(padL + c * cw, padT + ri * chh, Math.max(1, cw - 0.5), Math.max(1, chh - 1));
    }
    g.fillStyle = fg; g.font = "9px ui-sans-serif,system-ui"; g.textAlign = "right";
    const nm = regs[k];
    g.fillText(nm.length > 16 ? nm.slice(0, 15) + "…" : nm, padL - 6, padT + ri * chh + chh / 2 + 3);
  });
  // train/test divider
  const tiTest = rowsC.findIndex(r => r.phase === "test");
  g.font = "9px ui-sans-serif,system-ui"; g.textAlign = "center";
  if (tiTest > 0){
    const x = padL + Math.min(nC - 1, ((tiTest / bin) | 0)) * cw;
    g.strokeStyle = "rgba(230,237,243,0.55)"; g.setLineDash([4, 3]);
    g.beginPath(); g.moveTo(x, padT - 4); g.lineTo(x, H - padB + 6); g.stroke(); g.setLineDash([]);
    g.fillStyle = "#8b98a5";
    g.fillText("train", (padL + x) / 2, H - 12);
    g.fillText("test", (x + W - padR) / 2, H - 12);
  } else {
    g.fillStyle = "#8b98a5";
    g.fillText("trials →", padL + (W - padL - padR) / 2, H - 12);
  }
  // colorbar
  const cbX = W - 40, cbY = padT, cbH = H - padT - padB;
  for (let y = 0; y < cbH; y++){ g.fillStyle = jetColor(1 - y / cbH); g.fillRect(cbX, cbY + y, 7, 1); }
  g.fillStyle = fg; g.textAlign = "left";
  g.fillText(vmax.toPrecision(3), cbX + 10, cbY + 8);
  g.fillText("0", cbX + 10, cbY + cbH);
}
function b64ToBytes(b64){
  const bin = atob(b64); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
// Render the "which neurons fired" card from a finished run's rows.
// mean firing per condition from per-trial layerRates (any experiment shape)
function condMeanRates(rows, cond){
  const acc = {}; let n = 0;
  for (const r of rows){
    if ((r.condition || "run") !== cond || !r.layerRates) continue;
    n++;
    for (const k in r.layerRates) acc[k] = (acc[k] || 0) + (r.layerRates[k] || 0);
  }
  if (!n) return null;
  const out = {};
  for (const k in acc) out[k] = acc[k] / n;
  return out;
}
// fuzzy experiment layer-name -> functional region key (matches worker
// naming like 'PN (antennal…', 'Kenyon cells', 'antennal lobe_L', 'MB output')
function regionForRateName(nm){
  const s = (nm || "").toLowerCase();
  if (/antennal|\bpn\b|olfact/.test(s)) return "antennal";
  if (/kenyon|mushroom|hidden|\bmb\b/.test(s)) return "mb";
  if (/optic|medulla|lobula|lamina/.test(s)) return "optic";
  if (/motor|descend|vnc|neck/.test(s)) return "motor";
  if (/lateral horn|\blh\b/.test(s)) return "lh";
  if (/central complex|ellipsoid|fan-shaped|\bCX\b|\beb\b|\bpb\b|\bfb\b/i.test(s)) return "cx";
  return "central";
}

// region -> neuron ids (real positions), cached
const ANAT_REG_MEM = new Map();
function regionMembers(){
  if (ANAT_REG_MEM.size) return ANAT_REG_MEM;
  for (let i = 0; i < ANAT.meta.n; i++){
    const rk = ANAT.npRegion.get(ANAT.meta.np_names[ANAT.prim[i]]);
    if (rk){ let a = ANAT_REG_MEM.get(rk); if (!a){ a = []; ANAT_REG_MEM.set(rk, a); } a.push(i); }
  }
  return ANAT_REG_MEM;
}
// per-neuron firing vector for a condition: prefer the worker's measured
// fireVecMean; otherwise synthesize one from mean layer rates distributed
// over each region's real neurons — so EVERY fly-brain condition gets a
// real-brain map instead of a block-diagram fallback.
function fireVecFor(rows, cond){
  const fr = (rows || []).find(r => (r.condition || "run") === cond && r.fireVecMean && r.fireVecMean.vec);
  if (fr) return { vec: b64ToBytes(fr.fireVecMean.vec), measured: true };
  const rates = condMeanRates(rows, cond);
  if (!rates || !ANAT.ready) return null;
  const mem = regionMembers();
  const regRate = {}; let mx = 0;
  for (const k in rates){
    const rk = regionForRateName(k);
    regRate[rk] = (regRate[rk] || 0) + rates[k];
  }
  for (const k in regRate) mx = Math.max(mx, regRate[k]);
  const n = ANAT.meta.n;
  const out = new Uint8Array(n);
  // sparse deterministic activation: only a hash-selected fraction of each
  // region's neurons is marked active (sparse coding — and it keeps these
  // 100k-neuron canvases cheap enough to render per condition)
  for (const [rk, ids] of mem){
    const v = (regRate[rk] || 0) / (mx || 1);
    if (v <= 0) continue;
    const thresh = 0.03 + 0.12 * v;                        // 3%–15% of the pool
    const cap = Math.min(ids.length, Math.round(800 + 1800 * v));
    let cnt = 0;
    for (const i of ids){
      if (cnt >= cap) break;
      const h = ((i * 2654435761) >>> 16) & 1023;
      if (h >= thresh * 1024) continue;
      const jit = 0.7 + 0.6 * ((h & 255) / 255);
      out[i] = Math.min(255, Math.round(40 + v * 190 * jit));
      cnt++;
    }
  }
  return { vec: out, measured: false };
}
let LAST_ANAT_FIG = null;
function renderAnatMaps(rows, label){
  const wrap = document.getElementById("brainWrap");
  if (!wrap) return null;
  if (!ANAT.ready){
    wrap.innerHTML = '<div class="empty">anatomy positions still loading — rerun or reopen</div>';
    return null;
  }
  // one real-brain map per condition — measured per-neuron firing when the
  // worker provides it, region-distributed over real positions otherwise.
  const conds = [];
  for (const r of (rows || [])){
    const c = r.condition || "run";
    if (!conds.includes(c) && (r.fireVecMean || r.layerRates)) conds.push(c);
  }
  if (!conds.length){ wrap.innerHTML = '<div class="empty">waiting for a run with a fly brain…</div>'; return null; }
  wrap.innerHTML = "";
  const figs = [];
  for (const cond of conds){
    const fv = fireVecFor(rows, cond);
    if (!fv) continue;
    const cv = document.createElement("canvas");
    cv.width = 940; cv.height = 430;
    cv.style.maxWidth = "100%"; cv.style.border = "1px solid #30363d";
    cv.style.borderRadius = "6px"; cv.style.margin = "6px 0";
    drawAnatMap(cv, fv.vec, ANAT.meta.n,
      label + " — " + cond + " — which neurons fired",
      (fv.measured ? "measured per-neuron firing" : "region-mean firing over real positions") +
      " · " + ANAT.meta.n.toLocaleString() + " neurons at real positions");
    wrap.appendChild(cv);
      figs.push({ canvas: cv, cond, ph: "test" });
    const rowsC = (rows || []).filter(r => (r.condition || "run") === cond && r.layerRates);
    if (rowsC.length){
      const regs = Object.keys(rowsC[0].layerRates);
      const cvS = document.createElement("canvas");
      cvS.width = 940; cvS.height = 40 + regs.length * 26 + 64;
      drawRegionTimeStrip(cvS, rowsC, cond + " — region activity across the run (which region fired when)");
      cvS.style.maxWidth = "100%"; cvS.style.border = "1px solid #30363d";
      cvS.style.borderRadius = "6px"; cvS.style.margin = "6px 0";
      wrap.appendChild(cvS);
      figs.push({ canvas: cvS, cond, ph: "strip" });
    }
  }
  LAST_ANAT_FIG = figs;
  return figs;
}
function captureBrainSnapshot(expId, label){
  if (!BRAIN_DATA) return;
  const h = 64 + BRAIN_DATA.layers.length * 44 + 40;
  const cv = document.createElement("canvas");
  cv.width = 1000; cv.height = h;
  drawMiniBrainHeatmap(cv, BRAIN_DATA, label);
  let deltaURL = null;
  const dd = collectBrainDeltas(LAST_ROWS || []);
  if (dd){
    const cvD = document.createElement("canvas");
    cvD.width = 940; cvD.height = 430;
    drawDeltaBrainFigure(cvD, dd, label + " — Δ firing (late − early)");
    deltaURL = cvD.toDataURL("image/png");
  }
  // real-anatomy firing map for this run (preferred by the session figure)
  let anatURL = null;
  // real-anatomy learning-delta map (late − early), preferred by the delta card
  let anatDeltaURL = null;
  try {
    if (LAST_ROWS && ANAT.ready){
      const byCond = new Map();
      for (const r of LAST_ROWS)
        if (r.fireVecMean && r.fireVecMean.vec && r.fireVecMean.phase === "train") byCond.set(r.condition, r);
      const pairs = [];
      for (const [cond, r] of byCond)
        if (r.fireVecEarly && r.fireVecEarly.vec)
          pairs.push({ cond, late: b64ToBytes(r.fireVecMean.vec), early: b64ToBytes(r.fireVecEarly.vec) });
      if (pairs.length){
        const cvD2 = document.createElement("canvas");
        cvD2.width = 940; cvD2.height = 430;
        drawAnatDeltaMap(cvD2, pairs, label + " — Δ firing (late − early)");
        anatDeltaURL = cvD2.toDataURL("image/png");
      }
    }
  } catch (e) { /* anat deltas optional */ }
  try {
    if (LAST_ROWS && LAST_ROWS.length && ANAT.ready){
      const cond0 = ((LAST_ROWS.find(r => r.fireVecMean || r.layerRates)) || {}).condition || "run";
      const fv0 = fireVecFor(LAST_ROWS, cond0);
      if (fv0){
        const cvA = document.createElement("canvas");
        cvA.width = 940; cvA.height = 430;
        drawAnatMap(cvA, fv0.vec, ANAT.meta.n,
          label + " — which neurons fired",
          (fv0.measured ? "measured per-neuron firing" : "region-mean firing") + " · real FAFB positions");
        // compose the region × time strip for the same condition under the map
        const cond = cond0;
        const rowsC = LAST_ROWS.filter(r => (r.condition || "run") === cond && r.layerRates);
        let total = cvA;
        if (rowsC.length){
          const regs = Object.keys(rowsC[0].layerRates);
          const cvS = document.createElement("canvas");
          cvS.width = 940; cvS.height = 40 + regs.length * 26 + 64;
          drawRegionTimeStrip(cvS, rowsC, cond + " — region activity across the run");
          const cvC = document.createElement("canvas");
          cvC.width = 940; cvC.height = cvA.height + cvS.height + 8;
          const gc = cvC.getContext("2d");
          gc.fillStyle = "#0d1117"; gc.fillRect(0, 0, cvC.width, cvC.height);
          gc.drawImage(cvA, 0, 0); gc.drawImage(cvS, 0, cvA.height + 8);
          total = cvC;
        }
        anatURL = total.toDataURL("image/png");
      }
    }
  } catch (e) { /* anatomy map optional */ }
  GALLERY.set(expId, { dataURL: anatURL || cv.toDataURL("image/png"),
                       blockURL: cv.toDataURL("image/png"),
                       deltaURL, anatURL, anatDeltaURL, label, layers: BRAIN_DATA.layers.length, when: Date.now() });
  renderBrainGallery();
}
// Publication-style "Six fly brains" figure: one jet heatmap subplot per
// finished experiment, panels numbered (a)(b)(c)... in run order, 3 per row.
const PANEL_TAGS = ["a","b","c","d","e","f","g","h","i","j"];
function m_label(id){ return SIX.labels.get(id) || id.toUpperCase(); }
document.getElementById("dlBrainSheet").addEventListener("click", () => {
  const keys = galleryKeys();
  if (!keys.length) return;
  const rows = Math.max(...keys.map(k => GALLERY.get(k).layers));
  const cols = 3, cellW = 500, cellH = 30 + rows * 44 + 26;
  const R = Math.ceil(keys.length / cols);
  const W = 40 + cols * cellW, H = 64 + R * cellH;
  const cv = document.createElement("canvas"); cv.width = W * 2; cv.height = H * 2;
  const g = cv.getContext("2d"); g.scale(2, 2);
  g.fillStyle = "#0d1117"; g.fillRect(0, 0, W, H);
  // suptitle
  g.fillStyle = "#e6edf3"; g.font = "bold 17px ui-sans-serif,system-ui"; g.textAlign = "left";
  g.fillText("Six fly brains — regional firing per experiment (jet scale, mean spikes/step)", 24, 30);
  g.font = "11px ui-sans-serif,system-ui"; g.fillStyle = "#8b98a5";
  g.fillText("one subplot per finished experiment · panels in run order · click any snapshot above for its single PNG", 24, 48);
  const imgs = keys.map(k => { const im = new Image(); im.src = GALLERY.get(k).dataURL; return im; });
  Promise.all(imgs.map(im => im.complete ? Promise.resolve() :
    new Promise(res => { im.onload = res; im.onerror = res; }))).then(() => {
    keys.forEach((k, i) => {
      const x = 24 + (i % cols) * cellW, y = 64 + Math.floor(i / cols) * cellH;
      g.fillStyle = "#e6edf3"; g.font = "bold 13px ui-sans-serif,system-ui"; g.textAlign = "left";
      g.fillText("(" + (PANEL_TAGS[i] || i) + ")  " + GALLERY.get(k).label, x, y + 13);
      if (imgs[i].complete) g.drawImage(imgs[i], x, y + 20, cellW - 30, cellH - 34);
    });
    const a = document.createElement("a");
    a.download = "six_fly_brains_jet_figure.png"; a.href = cv.toDataURL("image/png"); a.click();
  });
});
// "Six fly brains — deltas" figure: diverging late-early panels
document.getElementById("dlDeltaSheet").addEventListener("click", () => {
  const keys = galleryKeys().filter(k => GALLERY.get(k).deltaURL);
  if (!keys.length) return;
  const cols = 3, cellW = 500, cellH = 250;
  const R = Math.ceil(keys.length / cols);
  const W = 40 + cols * cellW, H = 64 + R * cellH;
  const cv = document.createElement("canvas"); cv.width = W * 2; cv.height = H * 2;
  const g = cv.getContext("2d"); g.scale(2, 2);
  g.fillStyle = "#0d1117"; g.fillRect(0, 0, W, H);
  g.fillStyle = "#e6edf3"; g.font = "bold 17px ui-sans-serif,system-ui"; g.textAlign = "left";
  g.fillText("Six fly brains — WHERE learning changed firing (3D, late − early)", 24, 30);
  g.font = "11px ui-sans-serif,system-ui"; g.fillStyle = "#8b98a5";
  g.fillText("one region + one pathway highlighted per condition · red = fires more, blue = fires less · real FAFB v783 anatomy", 24, 48);
  const imgs = keys.map(k => { const im = new Image(); im.src = GALLERY.get(k).anatDeltaURL || GALLERY.get(k).deltaURL; return im; });
  Promise.all(imgs.map(im => im.complete ? Promise.resolve() :
    new Promise(res => { im.onload = res; im.onerror = res; }))).then(() => {
    keys.forEach((k, i) => {
      const x = 24 + (i % cols) * cellW, y = 64 + Math.floor(i / cols) * cellH;
      g.fillStyle = "#e6edf3"; g.font = "bold 13px ui-sans-serif,system-ui";
      g.fillText("(" + (PANEL_TAGS[i] || i) + ")  " + GALLERY.get(k).label, x, y + 13);
      if (imgs[i].complete) g.drawImage(imgs[i], x, y + 20, cellW - 30, cellH - 34);
    });
    const a = document.createElement("a");
    a.download = "six_fly_brains_deltas_figure.png"; a.href = cv.toDataURL("image/png"); a.click();
  });
});
document.getElementById("dlBrainPNG").addEventListener("click", () => {
  if (LAST_ANAT_FIG && LAST_ANAT_FIG.length){
    if (LAST_ANAT_FIG.length === 1){
      const a = document.createElement("a");
      a.download = "anatomy_firing_map.png";
      a.href = LAST_ANAT_FIG[0].canvas.toDataURL("image/png"); a.click();
      return;
    }
    // multiple figures: stack vertically on one sheet (dynamic heights)
    const W = 940;
    const H = LAST_ANAT_FIG.reduce((a, f) => a + f.canvas.height + 10, 10);
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    g.fillStyle = "#0d1117"; g.fillRect(0, 0, W, H);
    let yo = 10;
    LAST_ANAT_FIG.forEach(f => { g.drawImage(f.canvas, 0, yo); yo += f.canvas.height + 10; });
    const a = document.createElement("a");
    a.download = "anatomy_firing_maps.png";
    a.href = cv.toDataURL("image/png"); a.click();
    return;
  }
  if (!BRAIN_DATA) return;   // legacy region heatmap fallback
  const cv = document.createElement("canvas");
  cv.width = 2000; cv.height = (64 + BRAIN_DATA.layers.length * 44 + 40) * 2;
  const g = cv.getContext("2d"); g.scale(2, 2);
  drawBrainHeatmap(cv, BRAIN_DATA);
  const a = document.createElement("a");
  a.download = "brain_heatmap_" + (DONE ? DONE.provenance.experiment : "live") + ".png";
  a.href = cv.toDataURL("image/png");
  a.click();
});

// ---- message channel ------------------------------------------------------
const ws = new BroadcastChannel("fly-demon-experiments");
ws.onmessage = (ev) => {
  const m = ev.data || {};
  if (m.kind !== "plots") return;
  LABEL = m.label || LABEL;
  document.getElementById("expLabel").textContent = LABEL;
  const st = document.getElementById("status");
  if (m.type === "progress") {
    LAB_STATE[m.expId] = "running"; renderLabBoard();
    renderBehavior(m.expId, LABEL);
    CURVE = m.curve || [];
    st.textContent = `running · ${m.phase} trial ${m.trial + 1}/${m.nTrials} · seed ${m.seedIdx + 1}/${m.nSeeds}`;
    st.className = "status running";
    render();
  } else if (m.type === "done") {
    LAB_STATE[m.expId] = "done"; renderLabBoard();
    CURVE = (m.summary && m.summary.curve) || CURVE;
    DONE = { summary: m.summary, rows: m.rows, provenance: m.provenance };
    BRAIN_DATA = collectBrainData(m.summary, m.rows, LABEL);
    LAST_ROWS = m.rows || [];
    const ANAT_FIGS = renderAnatMaps(LAST_ROWS, LABEL);
    if (ANAT_FIGS && ANAT_FIGS.length) renderBrainEmpty();   // anat maps shown; skip block heatmap
    else renderBrain();                                      // no-anatomy fallback
    window.__ct3dRun = { rows: LAST_ROWS, label: LABEL };   // late viewers catch up
    if (window.__ct3dBrain) window.__ct3dBrain.showRun(LAST_ROWS, LABEL);
    if (BRAIN_DATA) captureBrainSnapshot(m.expId, LABEL);
    st.textContent = `done ✓ · ${m.rows.length} trials in ${m.provenance.elapsedSeconds.toFixed(0)} s`;
    st.className = "status done";
    renderBehavior(m.expId, LABEL);
    render();
    renderPredictions();
    renderLedger();
  }
};
// ---- results-by-laboratory board -------------------------------------------
const LABS = [
  { name: "\uD83E\uDDEA DEMON LAB", exps: ["e1", "e6", "e7", "e9", "e10", "e11"] },
  { name: "\uD83E\uDDE0 INFORMATION LAB", exps: ["e2", "e8"] },
  { name: "\uD83E\uDD30 FLY BRAIN", exps: ["e3", "e4", "e5"] },
];
const LAB_STATE = {};
const LAB_LABEL = { e1: "E1 · Classical Maxwell Demon", e6: "E6 · Jet-Closure Paradox",
  e7: "E7 · Generalization Sweep", e9: "E9 · Pressure Demon", e10: "E10 · Smoluchowski Trapdoor",
  e11: "E11 · Feynman Ratchet & Pawl", e2: "E2 · Artificial Neural Demon",
  e8: "E8 · Information-Limited Demons", e3: "E3 · Drosophila-Inspired Network",
  e4: "E4 · Connectome-Constrained", e5: "E5 · Full Comparator Study" };
function renderLabBoard() {
  document.getElementById("labBoard").innerHTML = LABS.map(lab =>
    `<div style="margin:6px 0"><b style="color:#c9d1d9">${lab.name}</b> ` + lab.exps.map(id => {
      const st = LAB_STATE[id] || "waiting";
      const cls = st === "done" ? "ok" : st === "running" ? "amb" : "";
      const dot = st === "done" ? "✓" : st === "running" ? "●" : "·";
      return `<span class="badge ${cls}" style="margin:2px 6px 2px 0">${dot} ${LAB_LABEL[id]} — ${st}</span>`;
    }).join("") + `</div>`).join("");
}
renderLabBoard();

// ---- animated six-brain session figure -------------------------------------
// A "run all six" click on the lab page announces a session; this canvas fills
// one jet heatmap panel per finished experiment, in queue order.
const SIX = { active: false, expIds: [], done: new Map(), failed: new Set(),
              labels: new Map(), imgs: new Map(), lastId: null, lastAt: 0,
              current: null, raf: 0, finished: false };
const sixWrap = document.getElementById("sixAnimWrap");
const sixCv = document.getElementById("sixAnim");
const sixSt = document.getElementById("sixAnimStatus");
document.getElementById("dlSixAnim").addEventListener("click", () => {
  if (!SIX.finished) return;
  const a = document.createElement("a");
  a.download = "six_fly_brains_session_figure.png";
  a.href = sixCv.toDataURL("image/png");
  a.click();
});
function handleSixMsg(m) {
  if (m.type === "session_begin") {
    SIX.active = true; SIX.finished = false;
    SIX.expIds = (m.expIds || []).slice();
    SIX.done.clear(); SIX.failed.clear(); SIX.labels.clear(); SIX.imgs.clear();
    SIX.lastId = null; SIX.current = null;
    sixCv.height = 58 + Math.ceil(Math.max(1, SIX.expIds.length) / 3) * 136 + 34;
    sixWrap.style.display = "";
    document.getElementById("dlSixAnim").disabled = true;
    cancelAnimationFrame(SIX.raf);
    const loop = () => { if (!SIX.active) return; drawSixFrame(false); SIX.raf = requestAnimationFrame(loop); };
    SIX.raf = requestAnimationFrame(loop);
  } else if (m.type === "done") {
    if (SIX.active && SIX.expIds.includes(m.expId)) {
      let url = null, label = m.label;
      const g = GALLERY.get(m.expId);
      if (g) { url = g.anatURL || g.dataURL; label = g.label || label; }
      // fallback: build the snapshot here if the done-handler ordering hasn't
      // populated GALLERY yet — collectBrainData needs summary + rows.
      if (m.rows && m.rows.length && typeof renderAnatMaps === "function")
        renderAnatMaps(m.rows, label);       // real-anatomy map for this panel
      if (!url && m.rows && m.rows.length &&
          typeof collectBrainData === "function" && m.summary) {
        try {
          const bd = collectBrainData(m.summary, m.rows, label);
          if (bd) {
            const cvF = document.createElement("canvas");
            cvF.width = 1000;
            cvF.height = 64 + bd.layers.length * 44 + 40;
            drawMiniBrainHeatmap(cvF, bd, label);
            url = cvF.toDataURL("image/png");
          }
        } catch (e) { /* snapshot unavailable for this panel */ }
      }
      if (url) {
        SIX.done.set(m.expId, url);
        SIX.labels.set(m.expId, label || m.expId.toUpperCase());
        SIX.lastId = m.expId; SIX.lastAt = performance.now();
      }
    }
  } else if (m.type === "session_error") {
    if (SIX.active && SIX.expIds.includes(m.expId)) {
      SIX.failed.add(m.expId);
      SIX.labels.set(m.expId, m.label || m.expId.toUpperCase());
    }
  } else if (m.type === "progress") {
    if (SIX.active) SIX.current = { id: m.expId, phase: m.phase,
                                    trial: m.trial, nTrials: m.nTrials };
  } else if (m.type === "session_end") {
    finishSix();
  }
}
ws.addEventListener("message", (ev) => { const m = ev.data || {}; if (m.kind === "plots") handleSixMsg(m); });
function finishSix() {
  if (!SIX.active || SIX.finished) return;
  SIX.finished = true;
  cancelAnimationFrame(SIX.raf);
  drawSixFrame(true);
  document.getElementById("dlSixAnim").disabled = false;
  sixSt.textContent = "session complete — " + SIX.done.size + "/" + SIX.expIds.length + " panels";
}
function drawSixFrame(final) {
  const g = sixCv.getContext("2d");
  const W = sixCv.width, H = sixCv.height;
  const fg = getComputedStyle(document.documentElement).getPropertyValue("--fg") || "#e6edf3";
  g.fillStyle = "#0d1117"; g.fillRect(0, 0, W, H);
  const n = SIX.expIds.length || 6, k = SIX.done.size;
  g.fillStyle = fg; g.font = "bold 14px ui-sans-serif,system-ui"; g.textAlign = "left";
  g.fillText(final ? "Six fly brains — one queued session (jet scale, mean spikes/step)"
                   : "ANIMATING six-brain session — collecting panels…", 10, 20);
  if (!final) {                                   // pulsing LIVE chip
    const a = 0.55 + 0.45 * Math.sin(performance.now() / 220);
    g.fillStyle = "rgba(63,185,80," + a.toFixed(2) + ")";
    g.beginPath(); g.arc(W - 52, 15, 5, 0, 7); g.fill();
    g.fillStyle = fg; g.font = "bold 10px ui-sans-serif,system-ui";
    g.fillText("LIVE", W - 42, 19);
  }
  g.fillStyle = "#21262d"; g.fillRect(10, 28, W - 20, 6);
  g.fillStyle = "#3fb950"; g.fillRect(10, 28, (W - 20) * (final ? 1 : k / n), 6);
  const cols = 3, cw = (W - 20) / cols, ch = 136;
  SIX.expIds.forEach((id, i) => {
    const x = 10 + (i % cols) * cw, y = 44 + Math.floor(i / cols) * ch;
    const url = SIX.done.get(id);
    g.strokeStyle = "#30363d"; g.strokeRect(x + 0.5, y + 0.5, cw - 10, ch - 22);
    if (url) {
      let im = SIX.imgs.get(id);
      if (!im) { im = new Image(); im.src = url; SIX.imgs.set(id, im);
        im.onload = () => { if (SIX.finished) drawSixFrame(true); }; }
      if (im.complete && im.naturalWidth) g.drawImage(im, x + 4, y + 22, cw - 18, ch - 46);
      g.fillStyle = fg; g.font = "bold 11px ui-sans-serif,system-ui"; g.textAlign = "left";
      g.fillText("(" + (PANEL_TAGS[i] || i) + ")  " + (SIX.labels.get(id) || id), x + 5, y + 15);
      if (!final && id === SIX.lastId) {          // scan sweep on the newest panel
        const pw = (performance.now() - SIX.lastAt) / 1100;
        if (pw < 1) {
          const sx = x + 4 + pw * (cw - 18);
          g.fillStyle = "rgba(255,255,255,0.28)"; g.fillRect(sx, y + 22, 2, ch - 46);
          g.strokeStyle = "rgba(63,185,80,0.9)"; g.lineWidth = 2;
          g.strokeRect(x + 1.5, y + 1.5, cw - 13, ch - 26); g.lineWidth = 1;
        }
      }
    } else if (SIX.failed.has(id)) {
      g.fillStyle = "#f85149"; g.font = "bold 11px ui-sans-serif,system-ui"; g.textAlign = "center";
      g.fillText("✕ " + (SIX.labels.get(id) || m_label(id)) + " — failed", x + (cw - 10) / 2, y + ch / 2);
      g.textAlign = "left";
    } else {
      const t = performance.now();
      g.strokeStyle = "#3a4149"; g.setLineDash([5, 4]);
      g.lineDashOffset = -(t / 60) % 9;
      g.strokeRect(x + 4.5, y + 4.5, cw - 19, ch - 32);
      g.setLineDash([]);
      g.fillStyle = "#8b98a5"; g.font = "11px ui-sans-serif,system-ui"; g.textAlign = "center";
      let sub = "waiting · " + id.toUpperCase();
      if (SIX.current && SIX.current.id === id && !final)
        sub = SIX.current.phase + " " + (SIX.current.trial + 1) + "/" + SIX.current.nTrials + " · " + id.toUpperCase();
      g.fillText(sub, x + (cw - 10) / 2, y + ch / 2);
      g.textAlign = "left";
    }
  });
  g.fillStyle = "#8b98a5"; g.font = "10px ui-sans-serif,system-ui";
  g.fillText(final
    ? "session complete · " + k + "/" + n + " panels in run order · download below"
    : "queued " + SIX.expIds.map(e => e.toUpperCase()).join(" → ") + " · " + k + "/" + n + " collected",
    10, H - 10);
}
window.__sixTest = handleSixMsg;   // debug handle for in-page verification
window.__ct3dHooks = { fireVecFor, condMeanRates, label: () => LABEL };
window.__plotsDebug = { renderAnatMaps, ANAT, drawAnatMap, b64ToBytes, drawAnatDeltaMap, drawRegionTimeStrip, fireVecFor, regionForRateName, GALLERY };
window.addEventListener("resize", render);
render();
