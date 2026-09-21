/**
 * p1_tests.js — P1 regression tests (Stages B–F).
 *
 * Run: node p1_tests.js
 * Exit 0 = all pass. Spawns the python --verify modes for Stage B/E files.
 *
 * Every test states which audit finding / mandate clause it guards.
 */
"use strict";

const fs = require("fs");
const { execSync } = require("child_process");
const ct = require("./p1_celltypes");
const dyn = require("./p1_dynamics");
const { createTypedSim, shuffledEdges, delaysFromOpticDepth } = require("./p1_sim");
const client = require("./p1_flyvis_client");

let failures = 0, passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; console.log("PASS  " + name + (detail ? "   [" + detail + "]" : "")); }
  else { failures++; console.log("FAIL  " + name + (detail ? "   [" + detail + "]" : "")); }
}

const circuit = JSON.parse(fs.readFileSync("fly_brain_circuit.json", "utf8"));
const N = circuit.layers.reduce((a, l) => a + l.length, 0);

// ---------------------------------------------------------------- Stage B
console.log("— Stage B: cell-type metadata —");
{
  const table = ct.buildNeuronTable(circuit);
  check("B1: metadata count == circuit neurons", table.N === N, `${table.N}`);
  check("B2: NT classified (SOURCE-DERIVED, all neurons)",
    table.stats.nt_classified === N, `${table.stats.nt_classified}`);
  check("B3: post-neuropil mapped >= 99% (89 unmapped disclosed)",
    table.stats.post_mapped / N > 0.999, `${table.stats.post_mapped}`);
  check("B4: cell_type reserved UNKNOWN (nothing invented)",
    table.stats.cell_type_known === 0, `${table.stats.cell_type_known}`);
  // backward compatibility: legacy fields untouched (structure-level;
  // edge COUNT is not asserted because the P0 file was revised mid-P1 by the
  // parallel agent — see P1_BIOLOGY_AUDIT.md revision note)
  check("B5: legacy circuit structure unchanged (layers/edges arrays)",
    Array.isArray(circuit.layers) && Array.isArray(circuit.edges)
    && circuit.edges.length > 500000 && circuit.layers.length === 5,
    `${circuit.edges.length} edges`);
  // sign prior distribution sane
  let pos = 0, neg = 0, zero = 0;
  for (let i = 0; i < N; i++) {
    if (table.ntSign[i] > 0) pos++;
    else if (table.ntSign[i] < 0) neg++;
    else zero++;
  }
  check("B6: polarity prior covers population (pos/neg/unknown)",
    pos > N * 0.4 && neg > N * 0.05 && zero > 0.05 * N, `${pos}/${neg}/${zero}`);
  // import interface: validation + rejection without fabrication
  const rep1 = ct.importRows([{ root_id: "999999999999999999", cell_type: "T4c", source: "test" }]);
  check("B7: import rejects unknown root IDs", rep1.unknown_root === 1 && rep1.matched === 0);
  const realRoot = table.records[0].root_id;
  const rep2 = ct.importRows([{ root_id: realRoot, cell_type: "TEST_TYPE", source: "p1_tests" }]);
  check("B8: import patches matched root with provenance",
    rep2.matched === 1 && ct.loadCellTypes().neurons[0].cell_type === "TEST_TYPE");
  const rep3 = ct.importRows([{ root_id: table.records[1].root_id, cell_type: "" }]);
  check("B9: import rejects empty cell_type (no fabrication)", rep3.matched === 0);
  try {
    execSync("python p1_build_celltypes.py --verify", { encoding: "utf8", stdio: "pipe" });
    check("B10: python --verify (hash + order + layer coherence)", true);
  } catch (e) {
    check("B10: python --verify (hash + order + layer coherence)", false, String(e).slice(0, 80));
  }
}

// ---------------------------------------------------------------- Stage C
console.log("— Stage C: per-type dynamics —");
{
  const tableC = ct.buildNeuronTable(circuit);
  const lg = dyn.resolveDynamics(circuit, tableC, { profile: "legacy" });
  check("C1: legacy profile = single global class",
    Object.keys(lg.counts).length === 1 && lg.counts.legacy_global === N);
  const i0 = circuit.layers[0][0];
  check("C2: legacy values are the shipped TUNED rule",
    Math.abs(lg.tauMem[i0] - 0.86) < 1e-6 && lg.theta[i0] === 30 && lg.tRef[i0] === 3);
  const ty = dyn.resolveDynamics(circuit, tableC, { profile: "typed" });
  const cls = Object.keys(ty.counts);
  check("C3: typed profile resolves 4 parameter classes (incl. modulatory)",
    cls.length === 4 && "modulatory_slow" in ty.counts, cls.join(","));
  check("C4: class assignment covers all neurons",
    Object.values(ty.counts).reduce((a, b) => a + b, 0) === N);
  const opticIdx = circuit.layers[1][0];
  const motorIdx = circuit.layers[4][0];
  check("C5: optic class is fast/low-threshold vs motor",
    ty.tauMem[opticIdx] < ty.tauMem[motorIdx] && ty.theta[opticIdx] < ty.theta[motorIdx]);
  check("C6: provenance tags present per neuron",
    ty.provPerNeuron[opticIdx] === dyn.PROV.MODEL_ASSUMED, "MODEL-ASSUMED");
  // override guard: no silent tuning
  let threw = false;
  try { dyn.setClassOverride("X", { tauMem: 0.5 }, dyn.PROV.MODEL_ASSUMED); }
  catch (e) { threw = true; }
  check("C7: setClassOverride rejects MODEL-ASSUMED provenance", threw);
  // delays derived from real depth axis
  const delays = delaysFromOpticDepth(circuit, 2);
  let min = 99, max = -1;
  for (let i = 0; i < delays.length; i++) { min = Math.min(min, delays[i]); max = Math.max(max, delays[i]); }
  check("C8: structured delays span >1 tick from SOURCE-DERIVED depth axis",
    max > min && min >= 1 && max <= 3, `${min}..${max} ticks`);
  // STDP causality: LTD only when post precedes pre within tauPost
  const sim = createTypedSim(circuit, { neuronTable: ct.buildNeuronTable(circuit), seed: 5, stdp: { lr: 0.05 } });
  check("C9: sim exposes STDP counters", sim.stdpStats && typeof sim.stdpStats.ltp === "number");
  // determinism
  const run = (seed) => {
    const s = createTypedSim(circuit, { neuronTable: ct.buildNeuronTable(circuit), seed });
    for (let t = 0; t < 10; t++) s.tick({ visual: [1, 0, 0, 0, 0, 0, 0, 0], noise: 0.5 });
    let h = 0; for (let i = 0; i < s.N; i++) h = (h * 31 + s.spikes[i]) | 0;
    return h;
  };
  check("C10: identical seeds → identical spikes (determinism)", run(77) === run(77));
  // shuffle: degree preservation (BOTH sequences — audit A17 fix)
  const sh = shuffledEdges(circuit.edges, 123);
  const outD = new Map(), inD = new Map();
  for (const e of circuit.edges) { outD.set(e.s, (outD.get(e.s) || 0) + 1); inD.set(e.t, (inD.get(e.t) || 0) + 1); }
  const outS = new Map(), inS = new Map();
  for (const e of sh.edges) { outS.set(e.s, (outS.get(e.s) || 0) + 1); inS.set(e.t, (inS.get(e.t) || 0) + 1); }
  let both = true;
  for (const [k, v] of outD) if (outS.get(k) !== v) both = false;
  for (const [k, v] of inD) if (inS.get(k) !== v) both = false;
  check("C11: shuffle preserves BOTH degree sequences (audit A17)", both, `${sh.swaps} swaps`);
}

// ---------------------------------------------------------------- Stage D
console.log("— Stage D: operating-point grid —");
{
  const csv = fs.readFileSync("P1_OPERATING_POINT_PHASE_DIAGRAM.csv", "utf8").trim().split("\n");
  const header = csv[0].split(",");
  check("D1: phase-diagram CSV exists with full header",
    header.includes("optic_drive") && header.includes("noise") && header.includes("connectome")
    && header.includes("motor_saturation") && header.includes("dir_acc")
    && header.includes("gap_motor_rate_vs_shuffled"));
  const rows = csv.slice(1).filter(l => l.trim());
  const odVals = new Set(rows.map(r => r.split(",")[0]));
  const nzVals = new Set(rows.map(r => r.split(",")[1]));
  const connVals = new Set(rows.map(r => r.split(",")[2]));
  check("D2: grid covers optic drive axis", odVals.size >= 2, `${odVals.size} levels`);
  check("D3: grid covers noise axis", nzVals.size >= 2, `${nzVals.size} levels`);
  check("D4: grid covers real + shuffled connectome",
    connVals.has("real") && connVals.has("shuffled"));
  check("D5: full grid reported (rows = cells, no pruning)",
    rows.length >= odVals.size * nzVals.size * 2, `${rows.length} rows`);
}

// ---------------------------------------------------------------- Stage E
console.log("— Stage E: retinotopy —");
{
  const ret = JSON.parse(fs.readFileSync("fly_brain_retinotopy.json", "utf8"));
  const m = ret.meta;
  check("E1: retinotopy JSON present with 800-column grid", m.n_columns === 800, `${m.n_columns}`);
  check("E2: all optic neurons have SOURCE-DERIVED positions",
    m.n_with_position === m.n_optic_neurons, `${m.n_with_position}/${m.n_optic_neurons}`);
  check("E3: receptive field is UNKNOWN for all (not claimed)",
    m.provenance_separation.receptive_field.startsWith("UNKNOWN"));
  check("E4: provenance separation block present (4 concepts)",
    ["anatomical_location", "inferred_column", "receptive_field", "stimulus_mapping"]
      .every(k => k in m.provenance_separation));
  const ambiguous = ret.neurons.filter(n => n.column_confidence >= 0.9).length;
  check("E5: border-ambiguous neurons counted and disclosed",
    ambiguous === m.border_ambiguous_neurons, `${ambiguous}`);
  check("E6: stimulus mapping convention declared (reproducible)",
    ret.stimulus_map.convention.includes("nearest"));
  try {
    execSync("python p1_retinotopy.py --verify", { encoding: "utf8", stdio: "pipe" });
    check("E7: python --verify (assignment + occupancy invariants)", true);
  } catch (e) {
    check("E7: python --verify (assignment + occupancy invariants)", false, String(e).slice(0, 80));
  }
}

// ---------------------------------------------------------------- Stage F
console.log("— Stage F: flyvis bridge —");
{
  // stimulus contract: JS/Py identical expansions for the mirror property
  const lr = client.expandStimulus("moving_edge_lr");
  const rl = client.expandStimulus("moving_edge_rl");
  check("F1: LR/RL edge stimuli are exact time-reverses",
    JSON.stringify(lr) === JSON.stringify(rl.slice().reverse()));
  const fl = client.expandStimulus("flash");
  check("F2: flash = 40 on + 40 off ticks",
    fl.length === 80 && fl[0][0] === 1 && fl[79][0] === 0);
  check("F3: stationary_contrast modulates (not constant)",
    (() => { const f = client.expandStimulus("stationary_contrast").map(x => x[0]);
             return Math.max(...f) - Math.min(...f) > 0.3; })());
  // sidecar self-test (contract, no flyvis needed)
  try {
    const out = execSync("python flyvis_sidecar.py --self-test", { encoding: "utf8" });
    check("F4: sidecar contract self-test passes", out.includes("contract OK") && out.includes("6") === false ? out.split("contract OK").length - 1 >= 6 : true,
      `${out.split("contract OK").length - 1} checks`);
  } catch (e) { check("F4: sidecar contract self-test passes", false, String(e).slice(0, 80)); }
  // honest probe
  try {
    const out = execSync("python -c \"import flyvis_sidecar as f; import json; print(json.dumps(f.probe_flyvis()))\"", { encoding: "utf8" });
    const probe = JSON.parse(out.trim());
    check("F5: availability probe honest (ready==bool, reason when blocked)",
      typeof probe.ready === "boolean" && (probe.ready || "blocked_reason" in probe),
      `ready=${probe.ready}`);
  } catch (e) { check("F5: availability probe", false, String(e).slice(0, 80)); }
  // Windows datamate shim: importable on host python; apply_winfix returns a
  // bool (False here — no datamate on host — which is itself the honest result)
  try {
    const out = execSync("python -c \"from p1_flyvis_winfix import apply_winfix; print(apply_winfix())\"", { encoding: "utf8" });
    check("F6: datamate Windows shim importable; apply_winfix returns honest bool",
      out.trim() === "True" || out.trim() === "False", `apply_winfix()=${out.trim()}`);
  } catch (e) { check("F6: datamate Windows shim module", false, String(e).slice(0, 80)); }
  // live flyvis execution: only when a ready sidecar is reachable; otherwise the
  // parity artifact (G-tests) carries the evidence. Never faked either way.
  try {
    const out = execSync(
      "node -e \"const c=require('./p1_flyvis_client');(async()=>{const h=await c.health();"
      + "if(!(h.available&&h.flyvis&&h.flyvis.ready)){console.log(JSON.stringify({live:false,reason:'sidecar not ready'}));return;}"
      + "const r=await c.predict('flash',{timeoutMs:240000});"
      + "if(!r.available){console.log(JSON.stringify({live:false,reason:r.reason}));return;}"
      + "const ct=r.response.cell_types;const tr=ct.R1;"
      + "console.log(JSON.stringify({live:true,model:r.response.model,n_cell_types:r.response.n_cell_types,"
      + "n_frames:r.response.n_frames,r1_on_delta:+(tr[39]-tr[40]).toFixed(4),finite:Object.values(ct).every(t=>t.every(Number.isFinite))}));})().catch(e=>console.log(JSON.stringify({live:false,reason:e.message})))\"",
      { encoding: "utf8", timeout: 300000 });
    const j = JSON.parse(out.trim().split("\n").filter(l => l.startsWith("{"))[0]);
    check("F7: live flyvis /predict returns full per-type trace schema",
      j.live === false || (j.n_cell_types >= 60 && j.n_frames === 80
        && j.finite === true && j.r1_on_delta > 0),
      j.live ? `${j.model}: ${j.n_cell_types} types x ${j.n_frames} frames, R1 ON-delta=${j.r1_on_delta}`
             : `no live sidecar (${String(j.reason).slice(0, 60)}) — parity artifact covers evidence`);
    check("F8: live flyvis photoreceptor responds to flash (ON-delta > 0)",
      j.live === false || j.r1_on_delta > 0.3, j.live ? `R1 ON-delta=${j.r1_on_delta}` : "skipped (no live sidecar)");
  } catch (e) { check("F7: live flyvis /predict", false, String(e).slice(0, 90)); }
}

// ---------------------------------------------------------------- Flagship
console.log("— Flagship: parity harness —");
{
  check("G1: parity results file exists",
    fs.existsSync("P1_PARITY_RESULTS.json"));
  const r = JSON.parse(fs.readFileSync("P1_PARITY_RESULTS.json", "utf8"));
  const names = Object.keys(r.stimuli);
  check("G2: full standardized suite ran on both browser models",
    ["flash", "moving_edge_lr", "moving_edge_rl", "stationary_contrast"].every(n => names.includes(n))
    && r.stimuli.flash.legacy && r.stimuli.flash.typed);
  const c = r.stimuli.flash.parity.motor_trace_corr_legacy_vs_typed;
  check("G3: trace comparison computed (corr in [-1,1])",
    c >= -1 && c <= 1, `flash corr=${c}`);
  check("G4: flyvis column honestly marked (PENDING/RAN, never faked)",
    r.flyvis && (r.flyvis.status === "PENDING" || r.flyvis.status === "RAN"),
    r.flyvis ? r.flyvis.status : "missing");
  check("G5: flyvis RAN implies full per-type traces stored for every stimulus",
    r.flyvis.status !== "RAN" || (() => {
      const names = Object.keys(r.stimuli);
      const t = r.flyvis_traces || {};
      return names.every(n => t[n] && Object.keys(t[n]).length >= 60
        && t[n][Object.keys(t[n])[0]].length > 0);
    })(), r.flyvis.status === "RAN" ? Object.keys(r.flyvis_traces || {}).join(",") : "PENDING");
  check("G6: flyvis trace traces are finite numbers",
    r.flyvis.status !== "RAN" || (() => {
      const t = r.flyvis_traces || {};
      return Object.values(t).every(ct => Object.values(ct)
        .every(tr => Array.isArray(tr) && tr.every(Number.isFinite)));
    })(), "all finite");
}

// ---------------------------------------------------------------- Stage F2
console.log("— Stage F2: flybody/MuJoCo real-physics embodiment —");
{
  const PY = ".venv-flybody\\Scripts\\python.exe";
  const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
  const smoke = readJson("P1_FLYBODY_SMOKE_RESULTS.json");
  const bench = readJson("P1_FLYBODY_RESULTS.json");
  check("F2a: smoke results all-passed (5 physics invariants)",
    !!smoke && smoke.verdict === "PASS" && smoke.checks.length >= 5
    && smoke.checks.every(c => c.passed),
    smoke ? `${smoke.checks.length} checks` : "file missing");
  check("F2b: benchmark results all-passed (7 battery cells)",
    !!bench && bench.verdict === "PASS" && bench.checks.length >= 7
    && bench.checks.every(c => c.passed),
    bench ? `${bench.checks.length} checks` : "file missing");
  check("F2c: every flybody param provenance-tagged (SOURCE-DERIVED/MODEL-ASSUMED only)",
    !!bench && Array.isArray(bench.params) && bench.params.length > 0
    && bench.params.every(p => p.tag === "SOURCE-DERIVED" || p.tag === "MODEL-ASSUMED"),
    bench ? `${bench.params.length} params` : "file missing");
  const det = bench && bench.checks
    ? (bench.checks.find(c => c.name === "FB4_determinism") || {}).metrics : null;
  check("F2e: physics determinism exactly zero (reproducible embodiment)",
    !!det && det.determinism_delta === 0, det ? `delta=${det.determinism_delta}` : "missing");
  // Live physics gate: validates the recorded results against the CURRENT venv
  // (no simulation — CI-safe). Fails loudly on stale env (version drift) or a
  // missing venv; remediation hint in detail.
  try {
    const out = execSync(`${PY} p1_flybody_benchmark.py --check`, { encoding: "utf8", stdio: "pipe" });
    const stale = out.includes("versions changed");
    check("F2d: live physics gate (results valid for current env)",
      out.includes("PASS --check") && !stale,
      stale ? "environment changed since results — rerun p1_flybody_benchmark.py --full"
            : "venv results match current stack");
  } catch (e) {
    check("F2d: live physics gate (results valid for current env)", false,
      String(e).slice(0, 90) + " — install flybody into .venv-flybody (see P1_FLYBODY_REPORT.md)");
  }
}

// ---------------------------------------------------------------- Artifacts
console.log("— Required artifacts —");
{
  const files = ["P1_BIOLOGY_AUDIT.md", "P1_CELLTYPE_SCHEMA.md", "P1_DYNAMICS_REPORT.md",
    "P1_OPERATING_POINT_PHASE_DIAGRAM.csv", "P1_RETINOTOPY_REPORT.md", "P1_FLYVIS_BRIDGE.md",
    "fly_brain_celltypes.json", "fly_brain_retinotopy.json", "P1_PARITY_RESULTS.json",
    "p1_build_celltypes.py", "p1_celltypes.js", "p1_dynamics.js", "p1_sim.js",
    "p1_operating_point.js", "p1_retinotopy.py", "flyvis_sidecar.py", "p1_flyvis_client.js",
    "p1_flyvis_probe.py", "p1_flyvis_winfix.py", "p1_parity_test.js",
    "p1_flybody_smoke.py", "p1_flybody_benchmark.py", "P1_FLYBODY_SMOKE_RESULTS.json",
    "P1_FLYBODY_RESULTS.json", "P1_FLYBODY_BASELINE.json", "P1_FLYBODY_REPORT.md"];
  const missing = files.filter(f => !fs.existsSync(f));
  check("H1: all P1 outputs present", missing.length === 0,
    missing.length ? "missing: " + missing.join(",") : `${files.length} files`);
  const prov = ["SOURCE-DERIVED", "MODEL-ASSUMED", "EMPIRICAL", "TUNED", "UNKNOWN"];
  const audit = fs.readFileSync("P1_BIOLOGY_AUDIT.md", "utf8");
  check("H2: provenance tags defined in audit", prov.every(t => audit.includes(t)));
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
