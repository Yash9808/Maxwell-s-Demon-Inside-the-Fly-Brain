"use strict";
/**
 * p1_retinotopy.js — Stage F: wire the verified retinotopy data into the
 * runtimes as the optic input, replacing the legacy 8-bin path.
 *
 * WHAT THIS MODULE OWNS
 *   The exact hexagonal lattice of p1_retinotopy.py (Stage E), reimplemented
 *   in JS so every runtime (controllers, p1_sim, browser page/worker) derives
 *   the IDENTICAL column assignment from the SAME source-derived
 *   optic_channels [u, v] data. `--self-test` validates the JS lattice
 *   round-trip against the Python-built fly_brain_retinotopy.json: for 2,000
 *   random neurons, nearest-node(u,v) must equal the stored column, and the
 *   emitted node (u,v) must round-trip to the same column id.
 *
 * PROVENANCE (mirrors the Stage E JSON)
 *   anatomical location : SOURCE-DERIVED (FAFB synapse centroids, normalized)
 *   column assignment   : MODEL-ASSUMED lattice + SOURCE-DERIVED nearest-node,
 *                         with per-neuron column_confidence in the JSON
 *   receptive fields    : NOT claimed — a centroid is not an RF (unknown here)
 *   stimulus mapping    : declared nearest-node convention (no interpolation)
 *
 * FIELD FUNCTION (identical constants to the legacy 8-bin readVisualField,
 * so the ONLY change is the sampling grid: 8 saturated bins -> 477 occupied
 * hex columns — the sparse-drive regime the preregistered hypothesis names)
 *   I[col] += 0.015 + speed*0.025 per particle, clamped to [0,1]
 *   with u = (x + w/2)/w, v = (y + h/2)/h, speed = min(1, |v|/260).
 *
 * The legacy 8-bin path stays available behind explicit option
 * `opticInput: "retinotopy" | "legacy8bin"` (default retinotopy) so the old
 * operating point remains reproducible bit-for-bit.
 */
// ------------------------------------------------------------------
// Dual-environment: Node (require/module.exports) and browser (<script>
// global `Retinotopy`, consumed by fly_demon_3d.html and brain_worker.js
// bootstrap). No top-level work is done at load — functions only.

// Node detection by CAPABILITY, not by process sniffing: worker sandboxes
// (experiment_worker.js, tests/run_smoke.js) evaluate this source with a
// require function that throws by design while the real Node `process`
// global stays visible — so "require actually works" is the only honest test.
let fs = null, path = null;
let requireWorks = false;
try {
  if (typeof require === "function") { fs = require("fs"); path = require("path"); requireWorks = true; }
} catch (_) { requireWorks = false; }
const isNode = requireWorks
  && typeof module !== "undefined" && module.exports !== undefined;

// ------------------------------------------------------------------ lattice
// Must match p1_retinotopy.py hex_lattice() exactly: N_U=40, N_V=20, rows
// offset by half a du step; node col = j*n_u + i.
const N_U = 40, N_V = 20;
const DU = 1 / N_U, DV = 1 / N_V;

function hexLatticeNodes() {
  const nodes = new Array(N_U * N_V);
  for (let j = 0; j < N_V; j++) {
    for (let i = 0; i < N_U; i++) {
      const col = j * N_U + i;
      nodes[col] = {
        col,
        u: (i + (j % 2 ? 0.5 : 0.0)) * DU,
        v: j * DV,
        row: j, colidx: i,
      };
    }
  }
  return nodes;
}

/** Nearest hex node id for (u, v) — exact JS mirror of the Python assignment
 *  (argmin over squared distance; ties resolved by lowest col id, which is
 *  what Python's argpartition/argmin ordering yields in practice and what
 *  the self-test verifies end-to-end). */
function nearestColumn(nodes, u, v) {
  let best = -1, bestD2 = Infinity;
  for (let c = 0; c < nodes.length; c++) {
    const du = u - nodes[c].u, dv = v - nodes[c].v;
    const d2 = du * du + dv * dv;
    if (d2 < bestD2) { bestD2 = d2; best = c; }
  }
  return best;
}

/** Neuron-index -> column Int32Array (index = neuron id, -1 = unassigned),
 *  plus per-column neuron id lists for the tick loop. */
function buildOpticColumns(circuit) {
  const opticLayer = circuit.optic_layer !== undefined ? circuit.optic_layer : -1;
  if (opticLayer < 0 || !circuit.layers || !circuit.layers[opticLayer]) {
    return { columnOf: null, byColumn: null, nColumns: 0, opticLayer };
  }
  const members = circuit.layers[opticLayer];
  const N = circuit.layers.reduce((a, l) => a + l.length, 0);
  const chan = circuit.optic_channels || {};
  const nodes = hexLatticeNodes();
  const columnOf = new Int32Array(N).fill(-1);
  const perCol = nodes.map(() => []);
  for (const i of members) {
    const f = chan[String(i)];
    if (!f) continue;
    const col = nearestColumn(nodes, f[0], f[1]);
    columnOf[i] = col;
    perCol[col].push(i);
  }
  return {
    columnOf,
    byColumn: perCol.map(a => Int32Array.from(a)),
    nColumns: nodes.length,
    opticLayer,
    nodes,   // lattice geometry, for field layout conversions (legacy lift)
  };
}

// ------------------------------------------------- stimulus-side field (800)
/** 800-bin intensity field from particle positions — the stimulus function
 *  declared in fly_brain_retinotopy.json stimulus_map, with the legacy
 *  per-particle accumulation constants (0.015 + 0.025*speed, clamp 0..1)
 *  and one DECLARED transduction convention on top: RELATIVE CONTRAST
 *  CODING — every column is divided by the max column intensity of the same
 *  snapshot. Why: the legacy 8-bin field saturated near 1 for any busy
 *  scene, which is what kept the optic layer above spike threshold at the
 *  experimental opticScale (0.25). Raw per-column values peak at ~0.06
 *  (320 particles spread over ~256 columns), which would leave the optic
 *  layer silently subthreshold — a decorative wiring. Normalizing by the
 *  snapshot max preserves the full spatial structure (which columns are
 *  occupied and their ratios are pure data) while giving the busiest
 *  column the drive the saturated legacy bin had. MODEL-ASSUMED coding,
 *  consistent with contrast normalization in the early fly visual system;
 *  not a measured biological parameter. Zero field -> zero field. */
function readVisualFieldRetinotopy(particles, W, H, nodes) {
  const field = new Float32Array(nodes.length);
  let max = 0;
  for (const p of particles) {
    const u = Math.min(0.9999, Math.max(0, (p.x + W / 2) / W));
    const v = Math.min(0.9999, Math.max(0, (p.y + H / 2) / H));
    const speed = Math.min(1, Math.hypot(p.vx, p.vy, p.vz) / 260);
    const col = nearestColumn(nodes, u, v);
    const nv = field[col] + 0.015 + speed * 0.025;
    field[col] = nv > 1 ? 1 : nv;
    if (nv > max) max = nv;
  }
  if (max > 0) for (let c = 0; c < field.length; c++) field[c] /= max;
  return field;
}

/** Legacy 8-bin field -> 800-bin hex field: each legacy channel's intensity
 *  fills every hex column whose node (u,v) falls inside that channel's
 *  rectangle (u in [uBin/4,(uBin+1)/4), v in [vBin/2,(vBin+1)/2)), then the
 *  SAME relative-contrast normalization as readVisualFieldRetinotopy is
 *  applied (busiest bin -> 1) so the fallback path shares the declared
 *  coding. Defined fallback for envs that only provide the 8-bin field
 *  (e.g. zero-field stubs) so the retinotopic injection loop never silently
 *  reads zeros. */
function liftLegacyField(field8, nodes) {
  const out = new Float32Array(nodes.length);
  let max = 0;
  for (let c = 0; c < nodes.length; c++) {
    const uBin = Math.min(3, (nodes[c].u * 4) | 0);
    const vBin = Math.min(1, (nodes[c].v * 2) | 0);
    const d = field8[uBin + vBin * 4];
    if (d > 0) { out[c] = d; if (d > max) max = d; }
  }
  if (max > 0) for (let c = 0; c < out.length; c++) out[c] /= max;
  return out;
}

// ------------------------------------------------------------------- CLI
if (isNode && require.main === module) {
  const circuit = JSON.parse(fs.readFileSync(path.join(__dirname, "fly_brain_circuit.json"), "utf8"));
  const rt = JSON.parse(fs.readFileSync(path.join(__dirname, "fly_brain_retinotopy.json"), "utf8"));
  const nodes = hexLatticeNodes();

  // 1. JS node geometry must equal the Python-emitted lattice textually
  let geo = 0;
  for (let c = 0; c < nodes.length; c++) {
    const n = rt.grid_nodes[c];
    if (Math.abs(n.u - nodes[c].u) > 1e-12 || Math.abs(n.v - nodes[c].v) > 1e-12) geo++;
  }
  if (geo) { console.error(`self-test FAIL: ${geo} node geometry mismatches vs Stage E JSON`); process.exit(1); }

  // 2. round-trip on 2,000 stored neurons: nearest-node(u,v) == stored column
  const R = 2000;
  let mis = 0, checked = 0;
  for (let s = 0; s < R; s++) {
    const n = rt.neurons[(s * 40961) % rt.neurons.length];   // deterministic spread
    if (n.column < 0 || n.u === null) continue;
    checked++;
    const col = nearestColumn(nodes, n.u, n.v);
    if (col !== n.column) { mis++; if (mis <= 5) console.error(`  neuron i=${n.i}: stored col=${n.column}, JS nearest=${col}`); }
  }
  if (mis) { console.error(`self-test FAIL: ${mis}/${checked} column round-trip mismatches`); process.exit(1); }
  console.log(`self-test OK: lattice geometry exact (800 nodes), ${checked} neuron round-trips, 0 mismatches`);
  process.exit(0);
}

const RT_EXPORTS = { N_U, N_V, hexLatticeNodes, nearestColumn, buildOpticColumns, readVisualFieldRetinotopy, liftLegacyField };
// CommonJS-style evaluation (Node AND the worker/smoke sandboxes, which pass
// a `module` object): export through module.exports. Browser <script> (no
// `module`): publish the Retinotopy global instead.
if (typeof module !== "undefined" && module.exports !== undefined) module.exports = RT_EXPORTS;
else if (typeof globalThis !== "undefined") globalThis.Retinotopy = RT_EXPORTS;
