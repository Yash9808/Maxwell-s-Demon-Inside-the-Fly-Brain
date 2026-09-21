// Quick smoke test for p1_sim / p1_dynamics / p1_celltypes (Stage C core).
"use strict";
const fs = require("fs");
const ct = require("./p1_celltypes");
const { createTypedSim, shuffledEdges } = require("./p1_sim");

const circuit = JSON.parse(fs.readFileSync("fly_brain_circuit.json", "utf8"));
console.log("circuit:", circuit.layers.map(l => l.length).join(","));
const t0 = Date.now();
const table = ct.buildNeuronTable(circuit);
console.log("celltypes attached:", table.stats, (Date.now() - t0) + "ms");

const dyn = require("./p1_dynamics").resolveDynamics(circuit, table, { profile: "typed" });
console.log("class counts:", dyn.counts);

// 1) deterministic spike propagation sanity
const sim = createTypedSim(circuit, { neuronTable: table, seed: 42 });
for (let i = 0; i < 50; i++) sim.tick({ visual: [0, 0, 0, 0, 0, 0, 0, 0], motorDrive: 0.35 });
let fired = 0;
for (let i = 0; i < sim.N; i++) fired += sim.spikes[i];
console.log("spikes after 50 ticks w/ zero visual:", fired, "(motor drive produces some)");

// 2) strong visual drive should activate optic layer
const sim2 = createTypedSim(circuit, { neuronTable: table, seed: 42 });
const vis = [1, 1, 1, 1, 1, 1, 1, 1];
for (let i = 0; i < 30; i++) sim2.tick({ visual: vis });
console.log("optic layer rate w/ full drive:", sim2.layerRate(1).toFixed(4),
            "motor rate:", sim2.layerRate(4).toFixed(4));

// 3) STDP: reward-gated changes
const sim3 = createTypedSim(circuit, { neuronTable: table, seed: 42, stdp: { lr: 0.02 } });
for (let i = 0; i < 30; i++) sim3.tick({ visual: vis, lr: 0.02, reward: 0.5 });
console.log("stdp stats:", sim3.stdpStats);
let drift = 0;
for (let i = 0; i < sim3.NE; i++) drift += Math.abs(sim3.W[i] - sim3.W0[i] * (sim3.W[i] >= 0 ? 1 : -1) * sim3.WS);
console.log("weight drift (rough):", drift.toFixed(1));

// 4) shuffle determinism + degree preservation
const sh1 = shuffledEdges(circuit.edges, 7);
const sh2 = shuffledEdges(circuit.edges, 7);
console.log("shuffle deterministic:", JSON.stringify(sh1) === JSON.stringify(sh2), "swaps:", sh1.swaps);
const outDeg = (e) => { const m = new Map(); for (const x of e) m.set(x.s, (m.get(x.s) || 0) + 1); return m; };
const d0 = outDeg(circuit.edges), d1 = outDeg(sh1.edges);
let same = true;
for (const [k, v] of d0) if (d1.get(k) !== v) { same = false; break; }
console.log("out-degree preserved:", same);
// in-degree preservation too
const inDeg = (e) => { const m = new Map(); for (const x of e) m.set(x.t, (m.get(x.t) || 0) + 1); return m; };
const i0 = inDeg(circuit.edges), i1 = inDeg(sh1.edges);
let sameIn = true;
for (const [k, v] of i0) if (i1.get(k) !== v) { sameIn = false; break; }
console.log("in-degree preserved:", sameIn);

// 5) response recording
const sim4 = createTypedSim(circuit, { neuronTable: table, seed: 42, record: { layer: 4, every: 1, capacity: 100 } });
for (let i = 0; i < 60; i++) sim4.tick({ visual: vis });
console.log("response trace len:", sim4.response().n, "layer:", sim4.response().layer);
console.log("SMOKE OK");
