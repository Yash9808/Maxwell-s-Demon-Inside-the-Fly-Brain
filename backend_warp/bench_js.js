// bench_js.js — production-faithful JS benchmarks on the real circuit arrays.
//
// Loads backend_warp/data/*.bin (the exact arrays brain_worker.js receives)
// and times the production kernels in production style: double-precision
// arithmetic on Float32Array storage (NO fround — that is only the bit-parity
// replica's discipline), exactly as brain_worker.js runs.
//
// Usage: node bench_js.js [repeats=7]
"use strict";
const fs = require("fs");
const path = require("path");

const DATA = path.join(__dirname, "data");
function load(name, Type) {
  const buf = fs.readFileSync(path.join(DATA, name));
  return new Type(buf.buffer, buf.byteOffset, buf.byteLength / Type.BYTES_PER_ELEMENT);
}
const src = load("src.i32", Int32Array);
const dst = load("dst.i32", Int32Array);
const w0 = load("w0.f32", Float32Array);
const sign = load("sign.u8", Uint8Array);
const meta = JSON.parse(fs.readFileSync(path.join(DATA, "meta.json"), "utf8"));
const N = meta.N, NE = meta.NE;
const WS = 0.02;
const W = new Float32Array(NE);
for (let i = 0; i < NE; i++) W[i] = w0[i] * (sign[i] ? 1 : -1) * WS;
const W0 = new Float32Array(NE);
for (let i = 0; i < NE; i++) W0[i] = w0[i] * WS;
const V = new Float32Array(N), vbuf = new Float32Array(N);
const spikes = new Uint8Array(N), refac = new Uint8Array(N), prev = new Uint8Array(N);
const E = new Float32Array(NE), plastic = new Uint8Array(NE).fill(1);
const heat = new Float32Array(N);
// layer ranges (production 5-layer FAFB layout)
const lo = meta.layerStart;
const stimRange = [0, lo[2]];                 // layers 0+1
const opticRange = [lo[1], lo[2]];            // optic layer
const motorRange = [lo[4], N];                // motor layer
// seeded drive state (deterministic across repeats; Math.random NOT used)
let rngState = 123456789;
function rnd() { rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0; return rngState / 4294967296; }
function seedDrive() {
  // realistic pre-state: ~3% neurons above threshold history, some refac
  for (let i = 0; i < N; i++) { V[i] = rnd() * 40; refac[i] = rnd() < 0.02 ? 2 : 0; prev[i] = rnd() < 0.03 ? 1 : 0; }
  spikes.fill(0); E.fill(0); heat.fill(0);
}

function now() { return performance.now(); }
function bench(name, repeats, setup, fn) {
  setup();
  fn(); // warmup (JIT)
  const times = [];
  for (let r = 0; r < repeats; r++) { setup(); const t0 = now(); fn(); times.push(now() - t0); }
  times.sort((a, b) => a - b);
  const med = times[Math.floor(times.length / 2)];
  const min = times[0];
  console.log(`${name}\t${med.toFixed(3)}\t${min.toFixed(3)}`);
  return med;
}

const REPEATS = parseInt(process.argv[2] || "7", 10);
console.log(`backend_warp bench_js — N=${N} NE=${NE} repeats=${REPEATS} (median | min ms)`);

// ---- heat decay (render-side production op) — per-call
bench("heat_decay_106k", REPEATS, () => { heat.fill(0.5); }, () => {
  for (let i = 0; i < N; i++) heat[i] = spikes[i] ? 1 : heat[i] * 0.94;
});

// ---- LIF update (no injectors) — per-call
bench("lif_update_106k", REPEATS, () => seedDrive(), () => {
  for (let i = 0; i < N; i++) {
    if (refac[i] > 0) { refac[i]--; spikes[i] = 0; continue; }
    const vi = V[i] * 0.86;
    V[i] = vi;
    if (vi > 30) { spikes[i] = 1; refac[i] = 3; } else { spikes[i] = 0; }
  }
});

// ---- synaptic fan-out (1-tick delay) — per-call
bench("fanout_553k", REPEATS, () => seedDrive(), () => {
  for (let i = 0; i < NE; i++) if (prev[src[i]]) V[dst[i]] += W[i];
});

// ---- injectors (stim + optic + motor + ex), production constants — per-call
function injectors(t) {
  if (t % 3 === 0) {
    const [a, b] = stimRange, frac = 0.012 * 0.8;
    for (let i = a; i < b; i++) if (rnd() < frac) V[i] += 16 * (0.7 + rnd() * 0.6);
  }
  const [c, d] = opticRange;
  for (let k = c; k < d; k++) { const drive = ((k * 7919) % 97) / 97 * 0.25; if (rnd() < drive * 0.5) V[k] += 14 * (0.5 + rnd()); }
  const [m0, m1] = motorRange;
  for (let i = m0; i < m1; i++) {
    if (rnd() < 0.35 * 0.035) V[i] += 8 * (0.5 + rnd());
    if (rnd() < 0.008) V[i] += 0.3 * (24 + 24 * rnd());
  }
}
bench("injectors_full", REPEATS, () => seedDrive(), () => injectors(1));

// ---- traces (E decay + coincidence) — per-call
bench("traces_553k", REPEATS, () => { E.fill(0.02); }, () => {
  for (let i = 0; i < NE; i++) {
    const ei = E[i] * 0.985;
    if (plastic[i] && spikes[src[i]] && spikes[dst[i]]) E[i] = Math.min(ei + 0.15, 1);
    else E[i] = ei;
  }
});

// ---- plasticity (gated update) — per-call (worst case: all E >= 0.01)
bench("plasticity_553k", REPEATS, () => { E.fill(0.5); }, () => {
  const d = 0.001;
  for (let i = 0; i < NE; i++) {
    const e = E[i];
    if (e < 0.01 || !plastic[i]) continue;
    const wmax = W0[i];
    W[i] = Math.min(Math.max(W[i] + d * e, -wmax), wmax * 2);
  }
});

// ---- change scan + top-K 180 (production min-heap) — per-call
bench("changes_topk180_553k", REPEATS, () => {}, () => {
  const ranked = [];
  const bubbleUp = (item) => {
    let i = ranked.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (ranked[p][0] <= item[0]) break; ranked[i] = ranked[p]; i = p; }
    ranked[i] = item;
  };
  const bubbleDown = () => {
    let i = 0, item = ranked[0];
    for (;;) {
      const l = i * 2 + 1; if (l >= ranked.length) break;
      let c = l; const r = l + 1;
      if (r < ranked.length && ranked[r][0] < ranked[l][0]) c = r;
      if (ranked[c][0] >= item[0]) break;
      ranked[i] = ranked[c]; i = c;
    }
    ranked[i] = item;
  };
  for (let i = 0; i < NE; i++) {
    const baseline = W0[i] * (sign[i] ? 1 : -1);
    const change = Math.abs(W[i] - baseline);
    const item = [change, i];
    if (ranked.length < 180) { ranked.push(item); bubbleUp(item); }
    else if (item[0] > ranked[0][0]) { ranked[0] = item; bubbleDown(); }
  }
});

// ---- full tick composition (injectors + LIF + fanout + commit) — per-tick
bench("full_tick", REPEATS * 3, () => seedDrive(), () => {
  injectors(1);
  for (let i = 0; i < N; i++) {
    if (refac[i] > 0) { refac[i]--; spikes[i] = 0; continue; }
    const vi = (V[i] + vbuf[i]) * 0.86;
    V[i] = vi;
    if (vi > 30) { spikes[i] = 1; refac[i] = 3; } else { spikes[i] = 0; }
  }
  for (let i = 0; i < NE; i++) if (prev[src[i]]) V[dst[i]] += W[i];
  prev.set(spikes);
});
