// extract_circuit.js — Warp investigation step 1: circuit arrays for Python.
//
// Replicates EXACTLY the conversion fly_demon_3d.html performs before handing
// arrays to brain_worker.js (see the buildSim init block, ~L2385):
//   fast edges  = edges.filter(e => !e.modulatory)
//   src = e.s, dst = e.t, w0 = e.w, sign = (e.sign > 0 ? 1 : 0)
//   W   = w0 * (sign ? 1 : -1) * WS   with WS = 0.02
//   members = concat(circuit.layers), layerOff = cumulative offsets
// Output: backend_warp/data/*.bin (raw little-endian) + meta.json (shapes,
// provenance, SHA256 per file) so Python/Warp and the JS replica consume
// byte-identical inputs. Regenerate: node backend_warp/extract_circuit.js
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const OUT = path.join(__dirname, "data");
fs.mkdirSync(OUT, { recursive: true });

globalThis.__FAFB_CIRCUIT__ = null;
require(path.join(__dirname, "..", "data", "circuits", "fafb_circuit.js"));
const C = globalThis.__FAFB_CIRCUIT__;
if (!C || !C.edges) throw new Error("fafb_circuit.js did not define __FAFB_CIRCUIT__");

const WS = 0.02;
const fastEdges = C.edges.filter((e) => !e.modulatory);
const NE = fastEdges.length;
const layers = C.layers;
const N = layers.reduce((a, l) => a + l.length, 0);

const src = new Int32Array(NE), dst = new Int32Array(NE);
const w0 = new Float32Array(NE);
const sign = new Uint8Array(NE);
const members = new Int32Array(N);
const layerOff = new Int32Array(layers.length + 1);
// P0 third-factor channels: modulatory edges keep only (source, type) —
// dopamine=0, serotonin=1, octopamine=2 — mirroring brain_worker's modByType.
const MOD_TYPE = { dopamine: 0, serotonin: 1, octopamine: 2 };
const modS = [], modT = [];
for (const e of C.modulatory_edges || []) {
  const t = MOD_TYPE[e.modulatorType || e.nt];
  if (t !== undefined) { modS.push(e.s); modT.push(t); }
}
const modSrc = new Int32Array(modS), modType = new Uint8Array(modT);

fastEdges.forEach((e, i) => {
  src[i] = e.s; dst[i] = e.t; w0[i] = e.w;
  sign[i] = e.sign > 0 ? 1 : 0;
});
let off = 0;
layers.forEach((l, li) => { layerOff[li] = off; members.set(l, off); off += l.length; });
layerOff[layers.length] = off;

const files = {
  "src.i32": src, "dst.i32": dst, "w0.f32": w0, "sign.u8": sign,
  "members.i32": members, "layeroff.i32": layerOff,
  "modsrc.i32": modSrc, "modtype.u8": modType,
};
const meta = {
  generated_utc: new Date().toISOString(),
  source_payload: "data/circuits/fafb_circuit.js (FAFB v783 semantic embed)",
  provenance: C.provenance || null,
  conversion: "identical to fly_demon_3d.html buildSim init block (WS=0.02)",
  WS, N, NE,
  layer_names: C.layer_names,
  layerStart: Array.from(layerOff.subarray(0, layers.length)),
  layer_sizes: layers.map((l) => l.length),
  fast_edges: NE,
  modulatory_edges: (C.modulatory_edges || []).length,
  files: {},
};
for (const [name, arr] of Object.entries(files)) {
  const p = path.join(OUT, name);
  fs.writeFileSync(p, Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength));
  meta.files[name] = {
    bytes: arr.byteLength, dtype: name.split(".")[1],
    sha256: crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"),
  };
}
fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify(meta, null, 1));
console.log(`N=${N} NE=${NE} mod=${meta.modulatory_edges} layers=${layers.length} -> ${OUT}`);
console.log("sha256:", Object.entries(meta.files).map(([k, v]) => `${k}:${v.sha256.slice(0, 8)}`).join(" "));
