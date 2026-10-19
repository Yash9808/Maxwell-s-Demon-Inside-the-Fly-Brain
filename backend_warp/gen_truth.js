// gen_truth.js — run replica.js over each scenario JSON and save truth.
// Usage: node gen_truth.js <scenario.json> <out.json>
"use strict";
const fs = require("fs");
const { Sim } = require("./replica.js");

const [scenPath, outPath] = process.argv.slice(2);
const S = JSON.parse(fs.readFileSync(scenPath, "utf8"));
const field = new Float32Array(S.optic.field);
const sim = new Sim({
  N: S.N, NE: S.NE,
  src: new Int32Array(S.src), dst: new Int32Array(S.dst),
  w0: new Float32Array(S.w0), sign: new Uint8Array(S.sign),
  layerStart: [0, S.stim_range[1]],
  stimRange: S.stim_range, opticRange: S.optic_range, motorRange: S.motor_range,
});

const frames = [];
for (let t = 0; t < S.ticks; t++) {
  sim.tick({
    stimBurst: S.stim_burst,
    opticField: (i) => field[i],
    motorDrive: S.motor_drive,
    exAmp: S.ex_amp,
  });
  sim.updateTraces();
  sim.applyLearning(S.da_amp, 1.0);   // DA override: exercise plasticity every tick
  sim.decayHeat(sim.spikes);
  if (t === S.ticks - 1 || t === Math.floor(S.ticks / 2) - 1) {
    const snap = sim.snapshot();
    frames.push({
      tick: t,
      V: Array.from(snap.V), spikes: Array.from(snap.spikes),
      refac: Array.from(snap.refac), W: Array.from(snap.W),
      E: Array.from(snap.E), heat: Array.from(snap.heat),
      DA: snap.DA, modEma: snap.modEma,
    });
  }
}
// final extras: change scan + top-K
const changes = sim.changes();
const topK = sim.topKChanges(180);
fs.writeFileSync(outPath, JSON.stringify({
  scenario: S.name,
  frames,
  changes_head: Array.from(changes.slice(0, 16)),
  changes_sum: changes.reduce((a, b) => a + b, 0),
  topk_len: topK.length,
  topk_vals: topK.map(([v]) => v),
  topk_idx_head: topK.map(([, i]) => i).slice(0, 16),
}));
console.log(`truth written: ${outPath} (${frames.length} frames, topk_len ${topK.length})`);
