/**
 * p1_parity_test.js — FLAGSHIP PARITY TEST (dynamics, not classification).
 *
 * Standardized stimulus suite:
 *   flash · moving_edge_lr · moving_edge_rl · stationary_contrast
 *
 * Fed to:
 *   1. current browser neural model   — legacy profile (global rule, the
 *      shipped makeSim/brainTick semantics reproduced in p1_sim "legacy")
 *   2. improved browser model         — typed profile (Stage B/C per-type
 *      dynamics + structured delays + causal STDP off during measurement)
 *   3. flyvis — ONLY when the sidecar reports ready (never faked; the report
 *      marks the flyvis column PENDING when unavailable)
 *
 * Compared: full RESPONSE TRACES (per-tick optic + motor population rates),
 * not final classifications: for each stimulus x model we report trace
 * vectors and pairwise trace metrics (AUC of the response, peak, onset
 * latency, and cross-model correlation on the shared time base).
 *
 * Run: node p1_parity_test.js [--with-sidecar]
 * Out: console table + P1_PARITY_RESULTS.json
 */
"use strict";

const fs = require("fs");
const ct = require("./p1_celltypes");
const { createTypedSim } = require("./p1_sim");
const client = require("./p1_flyvis_client");

const CIRCUIT = JSON.parse(fs.readFileSync("fly_brain_circuit.json", "utf8"));
const TABLE = ct.buildNeuronTable(CIRCUIT);
const NAMES = ["flash", "moving_edge_lr", "moving_edge_rl", "stationary_contrast"];

// protocol (fixed a priori): pre 40 ticks, stimulus as defined by the suite,
// post 20 ticks; drive scale 0.5 (mid-grid, no tuning); noise 0.
const PRE = 40, POST = 20, DRIVE = 0.5;

function framesFor(name) {
  const f = client.expandStimulus(name);
  // full-field frames [x] broadcast to 8 bins; edge frames already 8 wide
  return f[0].length === 1 ? f.map(x => [x[0], x[0], x[0], x[0], x[0], x[0], x[0], x[0]]) : f;
}

/** Run one stimulus through one profile; returns per-tick traces. */
function runTrace(profile, name, seed) {
  const sim = createTypedSim(CIRCUIT, {
    neuronTable: TABLE, profile, seed,
  });
  const frames = framesFor(name);
  const optic = [], motor = [];
  const rec = () => { optic.push(sim.layerRate(1)); motor.push(sim.layerRate(4)); };
  const zeros = new Array(8).fill(0);
  for (let t = 0; t < PRE; t++) { sim.tick({ visual: zeros }); rec(); }
  for (const f of frames) { sim.tick({ visual: f.map(v => v * DRIVE) }); rec(); }
  for (let t = 0; t < POST; t++) { sim.tick({ visual: zeros }); rec(); }
  return { optic, motor };
}

function auc(a) { let s = 0; for (const v of a) s += v; return s / a.length; }
function peak(a) { let m = 0; for (const v of a) m = Math.max(m, v); return m; }
function onset(a, base) {
  const b = base || auc(a.slice(0, PRE)) * 1.5 + 1e-9;
  for (let i = 0; i < a.length; i++) if (a[i] > b) return i - PRE;
  return null;
}
function corr(a, b) {
  const n = Math.min(a.length, b.length);
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let sab = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; sa += x * x; sb += y * y; }
  return sab / Math.sqrt(sa * sb + 1e-12);
}

async function main() {
  const t0 = Date.now();
  const results = { meta: {
    purpose: "dynamics parity across models on a standardized stimulus suite",
    protocol: { pre_ticks: PRE, post_ticks: POST, drive: DRIVE, noise: 0, tick_ms: client.TICK_MS },
    suite: client.STIMULI,
    models: ["legacy", "typed", "flyvis(pretrained ensemble member flow/0000/000)"],
    prov: "MODEL-ASSUMED protocol; traces are model outputs, not biology",
  }, stimuli: {}, flyvis: null };

  const sidecar = await client.health();
  console.log(`sidecar: ${sidecar.available ? "reachable" : "unreachable"}`
    + (sidecar.flyvis ? ` (flyvis ready: ${sidecar.flyvis.ready})` : ""));

  for (const name of NAMES) {
    const leg = runTrace("legacy", name, 11);
    const typ = runTrace("typed", name, 11);
    const rec = {
      legacy: {
        optic_auc: auc(leg.optic).toExponential(4), motor_auc: auc(leg.motor).toExponential(4),
        optic_peak: peak(leg.optic).toExponential(4), motor_peak: peak(leg.motor).toExponential(4),
        motor_onset_ticks: onset(leg.motor),
      },
      typed: {
        optic_auc: auc(typ.optic).toExponential(4), motor_auc: auc(typ.motor).toExponential(4),
        optic_peak: peak(typ.optic).toExponential(4), motor_peak: peak(typ.motor).toExponential(4),
        motor_onset_ticks: onset(typ.motor),
      },
      parity: {
        motor_trace_corr_legacy_vs_typed: +corr(leg.motor, typ.motor).toFixed(4),
        optic_trace_corr_legacy_vs_typed: +corr(leg.optic, typ.optic).toFixed(4),
        motor_auc_ratio_typed_over_legacy: +(parseFloat(typ.motor && auc(typ.motor).toExponential(4)) /
                                            Math.max(parseFloat(auc(leg.motor).toExponential(4)), 1e-12)).toFixed(4),
      },
      traces: { legacy_motor: leg.motor, typed_motor: typ.motor,
                legacy_optic: leg.optic, typed_optic: typ.optic },
    };
    results.stimuli[name] = rec;
    console.log(`${name.padEnd(22)} motorAUC leg=${rec.legacy.motor_auc} typed=${rec.typed.motor_auc} `
      + `corr=${rec.parity.motor_trace_corr_legacy_vs_typed} onset ${rec.legacy.motor_onset_ticks}/${rec.typed.motor_onset_ticks}`);
  }

  // direction selectivity check on the motor readout (parity of DYNAMICS):
  const lrA = results.stimuli.moving_edge_lr.legacy.motor_auc;
  const rlA = results.stimuli.moving_edge_rl.legacy.motor_auc;
  const lrT = results.stimuli.moving_edge_lr.typed.motor_auc;
  const rlT = results.stimuli.moving_edge_rl.typed.motor_auc;
  results.direction_selectivity = {
    legacy: { lr_over_rl: +(lrA / Math.max(rlA, 1e-12)).toFixed(4) },
    typed: { lr_over_rl: +(lrT / Math.max(rlT, 1e-12)).toFixed(4) },
    note: "ratio ~1 means the readout is direction-symmetric at this operating point",
  };

  // flyvis column: REAL inference via the sidecar (503/honest errors degrade,
  // never placeholders). Traces align 1:1 with the stimulus frames (flyvis
  // prepends its own 1 s grey steady state internally); the browser-model
  // traces cover [PRE | stimulus | POST], so cross-model correlations use the
  // aligned stimulus window [PRE .. PRE+n_frames).
  if (sidecar.available && sidecar.flyvis && sidecar.flyvis.ready) {
    results.flyvis = { status: "RAN", stimuli: {} };
    // flyvis cell-type groups approximating the browser readout populations
    // (structural mapping, documented in P1_FLYVIS_BRIDGE.md):
    const GROUPS = {
      lamina: ["L1", "L2", "L3"],            // ~ browser optic population
      T4: ["T4a", "T4b", "T4c", "T4d"],      // ON motion detectors
      T5: ["T5a", "T5b", "T5c", "T5d"],      // OFF motion detectors
    };
    const meanOf = (ct, names) => {
      const have = names.filter(n => ct[n]);
      if (!have.length) return null;
      const T = ct[have[0]].length;
      const out = new Array(T).fill(0);
      for (const n of have) for (let i = 0; i < T; i++) out[i] += ct[n][i] / have.length;
      return out;
    };
    for (const name of NAMES) {
      const fly = await client.predict(name);
      if (!fly.available) {
        results.flyvis.stimuli[name] = { available: false, reason: fly.reason };
        continue;
      }
      const ct = fly.response.cell_types;
      const g = { lamina: meanOf(ct, GROUPS.lamina), T4: meanOf(ct, GROUPS.T4), T5: meanOf(ct, GROUPS.T5) };
      const stim = results.stimuli[name];
      const win = arr => arr.slice(PRE, PRE + fly.response.n_frames); // aligned window
      const rec = {
        available: true,
        model: fly.response.model,
        n_frames: fly.response.n_frames,
        n_cell_types: fly.response.n_cell_types,
        group_auc: {},
        corr_vs_legacy_optic: g.lamina ? +corr(win(g.lamina), win(stim.traces.legacy_optic)).toFixed(4) : null,
        corr_vs_typed_optic: g.lamina ? +corr(win(g.lamina), win(stim.traces.typed_optic)).toFixed(4) : null,
      };
      for (const k of Object.keys(g)) rec.group_auc[k] = g[k] ? auc(g[k]).toExponential(4) : null;
      results.flyvis.stimuli[name] = rec;
      // full per-type traces (the flyvis response traces proper)
      results.flyvis_traces = results.flyvis_traces || {};
      results.flyvis_traces[name] = ct;
      console.log(`flyvis ${name.padEnd(22)} laminaAUC=${rec.group_auc.lamina} T4AUC=${rec.group_auc.T4} `
        + `corr(lamina,legacy)=${rec.corr_vs_legacy_optic} corr(lamina,typed)=${rec.corr_vs_typed_optic}`);
    }
    // flyvis-native direction selectivity (T4/T5 are the trained motion outputs):
    const ds = { note: "AUC ratio LR/RL; flyvis T4/T5 vs browser motor readout" };
    for (const k of ["T4", "T5"]) {
      const lr = results.flyvis.stimuli.moving_edge_lr;
      const rl = results.flyvis.stimuli.moving_edge_rl;
      if (lr && lr.available && rl && rl.available) {
        const lrv = parseFloat(lr.group_auc[k]), rlv = parseFloat(rl.group_auc[k]);
        ds[k] = { lr_over_rl: +(lrv / Math.max(Math.abs(rlv), 1e-12)).toFixed(4) };
      }
    }
    results.direction_selectivity.flyvis_T4_T5 = ds;
    results.flyvis.meta_note = "flyvis activity = trained dimensionless state "
      + "(SOURCE-DERIVED network/checkpoints), not measured Hz; group means are "
      + "structural population analogs, not validated homologies";
  } else {
    results.flyvis = { status: "PENDING",
      reason: sidecar.flyvis ? sidecar.flyvis.blocked_reason
                             : "sidecar not reachable (start: .venv-flyvis/Scripts/python.exe flyvis_sidecar.py)" };
  }

  results.meta.elapsed_ms = Date.now() - t0;
  fs.writeFileSync("P1_PARITY_RESULTS.json", JSON.stringify(results, null, 1));
  console.log(`\nwrote P1_PARITY_RESULTS.json (${results.meta.elapsed_ms}ms) — flyvis: ${results.flyvis.status}`);
}

main().catch(e => { console.error(e); process.exit(1); });
