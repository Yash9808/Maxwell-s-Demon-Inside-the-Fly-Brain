import io

p = "experiment_plots.html"
d = io.open(p, "r", encoding="utf-8", newline="").read()
NL = "\n" if "\r\n" not in d else "\r\n"
def nl(s): return s.replace("\r\n", "\n").replace("\n", NL)

def rep(old, new, n=1):
    global d
    old, new = nl(old), nl(new)
    c = d.count(old)
    assert c == n, "anchor x%d (want %d): %r" % (c, n, old[:80])
    d = d.replace(old, new)

# ============================================================ 1. APP_SPEC + renderApparatus
rep("""function renderBehavior(expId, label) {""",
"""// ---- apparatus experiments (E9/E10/E11) ------------------------------------
// These runs report apparatus metrics instead of demon/fly behavioral fields,
// so the predictions/ledger paths get an apparatus-specific metric table and
// the generic evaluators get null-guards (below).
const APP_SPEC = {
  e9: { title: "Pressure engine — ΔP → piston → mechanical work", panels: [
      { f: "dPfinal", label: "ΔP (relative)", fmt: v => v.toFixed(4) },
      { f: "pistonX", label: "piston position", fmt: v => v.toFixed(1) },
      { f: "pistonVelocity", label: "|piston velocity|", fmt: v => v.toFixed(2) },
      { f: "workJ", label: "spring work (J)", fmt: v => v.toExponential(2) },
      { f: "openFraction", label: "valve open", fmt: v => (v * 100).toFixed(0) + "%" },
      { f: "crossings", label: "crossings / episode", fmt: v => v.toFixed(0) },
      { f: "dTfinal", label: "ΔT between sides", fmt: v => v.toFixed(1) },
      { f: "measuredBits", label: "bits measured", fmt: v => v.toFixed(0) },
      { f: "netWorkJ", label: "net work − Landauer (J)", fmt: v => v.toExponential(2) },
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
function renderBehavior(expId, label) {""")

# ============================================================ 2. BEHAVIOR_SPECS for E9/E10/E11
rep("""      "Thermodynamically, expect every controller to be jet-subsidized (efficiency ≪ 1) — the ledger shows who is least subsidized.",
    ],
  },
};""",
"""      "Thermodynamically, expect every controller to be jet-subsidized (efficiency ≪ 1) — the ledger shows who is least subsidized.",
    ],
  },
  e9: {
    demon: [
      "The demon measures one molecule at its valve (1 bit) and opens a one-way valve for fast L→R molecules — a pressure rectifier.",
      "<b>Watch:</b> the right chamber pressurizes; ΔP drives the piston against the spring — mechanical work accumulates from information.",
      "Controls: a <b>random valve</b> (opens with no information, rectifies nothing) and a <b>never-open</b> valve (the noise floor).",
      "Bottom line: extracted spring work must beat the Landauer erasure bill of the measured bits, or the demon paid more than it earned.",
    ],
    fly: [
      "No fly here — E9 isolates the classical pressure argument in a piston engine.",
      "In the 3D lab the app switches to the pressure-engine stage while E9 runs (ESC restores the default scene).",
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
};""")

# ============================================================ 3. null-guards
rep("""  const eff = c.testWorkInJ.mean > 0 ? c.testExtractableJ.mean / c.testWorkInJ.mean : 0;""",
"""  const eff = (c.testWorkInJ && c.testWorkInJ.mean > 0) ? c.testExtractableJ.mean / c.testWorkInJ.mean : 0;""")

rep("""  const wrap = document.getElementById("ledgerWrap");
  const keys = Object.keys(conds);
  if (!keys.length) { wrap.innerHTML = '<div class="empty">no conditions</div>'; return; }""",
"""  const wrap = document.getElementById("ledgerWrap");
  if (renderApparatus(DONE.provenance && DONE.provenance.experiment, conds, wrap)) return;
  const keys = Object.keys(conds);
  if (!keys.length) { wrap.innerHTML = '<div class="empty">no conditions</div>'; return; }""")

# ============================================================ 4. lab board card
rep("""<main>
  <div class="grid">
    <div class="card"><h2>Learning curve — demon agreement</h2>""",
"""<main>
  <div class="grid">
    <div class="card" style="grid-column: 1 / -1;"><h2>Results by laboratory</h2>
      <div class="sub">which experiments have reported in this session (updated live)</div>
      <div id="labBoard"></div></div>
    <div class="card"><h2>Learning curve — demon agreement</h2>""")

rep("""// ---- animated six-brain session figure -------------------------------------""",
"""// ---- results-by-laboratory board -------------------------------------------
const LABS = [
  { name: "\\uD83E\\uDDEA DEMON LAB", exps: ["e1", "e6", "e7", "e9", "e10", "e11"] },
  { name: "\\uD83E\\uDDE0 INFORMATION LAB", exps: ["e2", "e8"] },
  { name: "\\uD83E\\uDD30 FLY BRAIN", exps: ["e3", "e4", "e5"] },
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

// ---- animated six-brain session figure -------------------------------------""")

# ============================================================ 5. ws.onmessage: board updates
rep("""  if (m.type === "progress") {
    renderBehavior(m.expId, LABEL);""",
"""  if (m.type === "progress") {
    LAB_STATE[m.expId] = "running"; renderLabBoard();
    renderBehavior(m.expId, LABEL);""")

rep("""    CURVE = (m.summary && m.summary.curve) || CURVE;
    DONE = { summary: m.summary, rows: m.rows, provenance: m.provenance };""",
"""    LAB_STATE[m.expId] = "done"; renderLabBoard();
    CURVE = (m.summary && m.summary.curve) || CURVE;
    DONE = { summary: m.summary, rows: m.rows, provenance: m.provenance };""")

io.open(p, "w", encoding="utf-8", newline="").write(d)

# ============================================================ 6. worker: dT alias for apparatus curve
p2 = "experiment_worker.js"
d2 = io.open(p2, "r", encoding="utf-8", newline="").read()
NL2 = "\r\n" if "\r\n" in d2 else "\n"
def nl2(s): return s.replace("\r\n", "\n").replace("\n", NL2)
old = nl2("""        curve.push(pt);
      }
    }
    return curve;
  }""")
assert d2.count(old) == 1, d2.count(old)
new = nl2("""        if (pt.dTfinal !== undefined && pt.dTfinal !== null) pt.dT = pt.dTfinal;
        curve.push(pt);
      }
    }
    return curve;
  }""")
io.open(p2, "w", encoding="utf-8", newline="").write(d2.replace(old, new))
print("plots page + worker dT alias done")
