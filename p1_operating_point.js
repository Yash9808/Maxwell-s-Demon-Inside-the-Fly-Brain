/**
 * p1_operating_point.js — Stage D: operating-point phase diagram.
 *
 * Controlled grid over { optic drive, noise, connectivity } on the REAL
 * circuit (typed profile, no plasticity — operating points, not learning).
 * For each cell, a fixed protocol runs and we measure:
 *   optic_response_mean — mean optic-layer rate during the stimulus
 *   motor_rate_mean     — mean motor-layer rate during the stimulus
 *                         (motor saturation proxy: it is the population rate
 *                         the legacy door policy reads)
 *   dir_acc             — sign-test accuracy over paired reps: motor response
 *                         larger for the true motion direction (0.5 = chance)
 *   optic_direction_corr— Pearson r between per-tick optic traces of the two
 *                         directions (low = direction-separable responses)
 *   spike_rate          — spikes/neuron/tick over optic+motor layers
 *   real-vs-shuffled    — same protocol on the degree-preserving (double-edge
 *                         swap) shuffled connectome; gaps = |real - shuffled|
 *
 * NO PARAMETER TUNING: the grid is swept as-is and the full CSV is reported
 * whatever it shows (mandate: report the grid, don't optimize it). Sweep
 * ranges are protocol choices fixed BEFORE looking at outcomes and are the
 * same for real and shuffled.
 *
 * Run: node p1_operating_point.js [--quick]
 * Out: P1_OPERATING_POINT_PHASE_DIAGRAM.csv
 */
"use strict";

const fs = require("fs");
const ct = require("./p1_celltypes");
const { createTypedSim } = require("./p1_sim");

const QUICK = process.argv.includes("--quick");
const CIRCUIT = JSON.parse(fs.readFileSync("fly_brain_circuit.json", "utf8"));
const TABLE = ct.buildNeuronTable(CIRCUIT);

// ---- grid (fixed a priori) -------------------------------------------------
const OPTIC_DRIVE = QUICK ? [0.05, 0.5] : [0.02, 0.06, 0.12, 0.25, 0.5, 1.0];
const NOISE = QUICK ? [0, 2] : [0, 0.5, 1, 2, 4];
const CONNECTOME = ["real", "shuffled"];
const REPS = QUICK ? 2 : 3;                    // paired reps per cell (sign test)
const PRE_TICKS = 40, STIM_TICKS = 80, POST_TICKS = 20;
const TICKS_PER_TRIAL = PRE_TICKS + STIM_TICKS + POST_TICKS;

/** Moving-edge stimulus on the 8-bin interface: a lit column sweeping
 *  left-to-right (dir=+1) or right-to-left (dir=-1) across the 4 columns. */
function movingEdge(dir, t) {
  const field = new Array(8).fill(0);
  const speed = 6;                                   // ticks per column step
  const col = ((t / speed) | 0) % 4;
  const c = dir > 0 ? col : 3 - col;
  for (let row = 0; row < 2; row++) field[row * 4 + c] = 1;
  return field;
}
const scaled = (field, drive) => field.map(v => v * drive);
const ZEROS = () => new Array(8).fill(0);

/** Noise axis: event probability 0.003*n per neuron/tick, kick 12*n
 *  (implemented in p1_sim.tick as inp.noise = n). */
const NOISE_LEVEL = n => n;

/** Run one trial; returns per-tick { opticTrace, motorTrace }. */
function runTrial(connectome, opticDrive, noise, seed, stimKind, stimArg) {
  const sim = createTypedSim(CIRCUIT, {
    neuronTable: TABLE, profile: "typed",
    shuffle: connectome === "shuffled", seed,
  });
  const opticTrace = [], motorTrace = [];
  let opticStimSum = 0, motorStimSum = 0;
  const record = (inStim) => {
    const o = sim.layerRate(1), m = sim.layerRate(4);
    opticTrace.push(o); motorTrace.push(m);
    if (inStim) { opticStimSum += o; motorStimSum += m; }
  };
  for (let t = 0; t < PRE_TICKS; t++) { sim.tick({ visual: ZEROS(), noise: NOISE_LEVEL(noise) }); record(false); }
  for (let t = 0; t < STIM_TICKS; t++) {
    const base = stimKind === "edge" ? movingEdge(stimArg, t) : ZEROS();
    sim.tick({ visual: scaled(base, opticDrive), noise: NOISE_LEVEL(noise) });
    record(true);
  }
  for (let t = 0; t < POST_TICKS; t++) { sim.tick({ visual: ZEROS(), noise: NOISE_LEVEL(noise) }); record(false); }
  return { opticTrace, motorTrace,
           opticStimMean: opticStimSum / STIM_TICKS, motorStimMean: motorStimSum / STIM_TICKS };
}

function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let sab = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; sa += x * x; sb += y * y; }
  return sab / Math.sqrt(sa * sb + 1e-12);
}
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const sum = a => a.reduce((x, y) => x + y, 0);

/** Core measurement for one grid cell. */
function measureCell(connectome, opticDrive, noise, seedBase) {
  const lr = [], rl = [], ol = [], orr = [];
  let spikesSum = 0, ticksSum = 0;
  for (let rep = 0; rep < REPS; rep++) {
    const seed = seedBase + rep * 977;
    const a = runTrial(connectome, opticDrive, noise, seed, "edge", +1);
    const b = runTrial(connectome, opticDrive, noise, seed + 1, "edge", -1);
    lr.push(a.motorStimMean); rl.push(b.motorStimMean);
    ol.push(a.opticStimMean); orr.push(b.opticStimMean);
    spikesSum += sum(a.opticTrace) * 81830 + sum(b.opticTrace) * 81830
               + sum(a.motorTrace) * 7002 + sum(b.motorTrace) * 7002;
    ticksSum += 2 * TICKS_PER_TRIAL;
  }
  const dirAcc = lr.filter((v, i) => v > rl[i]).length / REPS;   // sign test
  return {
    opticStimMean: mean(ol.concat(orr)),
    motorStimMean: mean(lr.concat(rl)),
    dirAcc,
    opticDirCorr: pearson(ol, orr),
    rate: spikesSum / ticksSum,
  };
}

function main() {
  const t0 = Date.now();
  const rows = [];
  const real = new Map();
  for (const conn of CONNECTOME) {
    for (const od of OPTIC_DRIVE) for (const nz of NOISE) {
      const seedBase = conn === "real" ? 1000 : 5000;
      const m = measureCell(conn, od, nz, seedBase + (od * 100 | 0) * 31 + (nz * 100 | 0));
      if (conn === "real") real.set(od + "|" + nz, m);
      const r = real.get(od + "|" + nz);
      rows.push({ od, nz, conn, m,
        gapMotor: r && r !== m ? Math.abs(r.motorStimMean - m.motorStimMean) : undefined,
        gapAcc: r && r !== m ? Math.abs(r.dirAcc - m.dirAcc) : undefined });
      console.log(`${conn === "real" ? "real " : "shuff"} od=${od} nz=${nz} `
        + `optic=${m.opticStimMean.toExponential(2)} motor=${m.motorStimMean.toExponential(2)} `
        + `acc=${m.dirAcc.toFixed(2)} corr=${m.opticDirCorr.toFixed(2)} rate=${m.rate.toExponential(2)}`
        + (rows[rows.length - 1].gapMotor !== undefined
            ? ` gapMotor=${rows[rows.length - 1].gapMotor.toExponential(2)}` : ""));
    }
  }
  const header = ["optic_drive", "noise", "connectome", "optic_response_mean",
    "motor_rate_mean", "motor_saturation", "dir_acc", "optic_direction_corr",
    "spike_rate_per_neuron_per_tick", "gap_motor_rate_vs_shuffled",
    "gap_dir_acc_vs_shuffled", "reps", "ticks_per_trial", "ticks_total",
    "shuffle_method", "prov_tag"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([
      r.od, r.nz, r.conn,
      r.m.opticStimMean.toExponential(6), r.m.motorStimMean.toExponential(6),
      r.m.motorStimMean.toExponential(6), r.m.dirAcc.toFixed(4),
      r.m.opticDirCorr.toFixed(6), r.m.rate.toExponential(6),
      r.gapMotor !== undefined ? r.gapMotor.toExponential(6) : "",
      r.gapAcc !== undefined ? r.gapAcc.toFixed(4) : "",
      REPS, TICKS_PER_TRIAL, REPS * 2 * TICKS_PER_TRIAL,
      r.conn === "shuffled" ? "double_edge_swap" : "none",
      "MODEL-ASSUMED",
    ].join(","));
  }
  fs.writeFileSync("P1_OPERATING_POINT_PHASE_DIAGRAM.csv", lines.join("\n") + "\n");
  console.log(`\nwrote P1_OPERATING_POINT_PHASE_DIAGRAM.csv (${rows.length} rows, ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}

main();
