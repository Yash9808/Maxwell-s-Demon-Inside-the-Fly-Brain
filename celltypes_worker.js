// celltypes_worker.js — (P9) the 53.8 MB fly_brain_celltypes.json payload is
// fetched and parsed HERE instead of on the main thread, which only ever
// needed three things out of it: the root_id -> cell-type name map, the
// per-type counts, and the neuron count. This worker packs exactly that into
// two transferable buffers (zero-copy handoff, no structured clone of the
// JSON):
//
//   roots : Float64Array   one entry per payload neuron, in payload order.
//                          JSON numbers are IEEE doubles, so JSON.parse and a
//                          Float64Array round identically — the page's existing
//                          String(root_id) keys are bit-identical to the
//                          legacy main-thread path (root ids exceed
//                          2^53, but they already do in the legacy path too).
//   blob  : Uint8Array     [nTypes u32][len u16, utf8 bytes] * nTypes
//                          [u8 typeIdx] * nNeurons (0 = untyped sentinel)
//
// Main thread response (type "celltypes"):
//   { type, roots, rootsBuf, blob, blobBuf, nNeurons, nTypes,
//     byRoot, counts, countOrder, names }
// byRoot is a Map built HERE (same insertion order as the legacy loader); it
// clones cheaply across postMessage (few hundred entries), while the bulk
// arrays move as transferables. counts uses the SAME numeric values as the
// legacy counts object; countOrder lists the keys in first-typed-neuron order
// so the page can rebuild the object with identical key order.
//
// Failure contract (identical to the legacy optional loader): any fetch/parse
// problem answers { type:"celltypes_unavailable", reason } and the page stays
// exactly in the missing-file state (silent, CELLTYPES.done set).
"use strict";

function packCelltypes(j) {
  const neurons = j && j.neurons;
  if (!neurons || !neurons.length) return null;
  const n = neurons.length;
  const types = [];                       // interned names, first-use order
  const typeIdx = new Map();              // name -> u8 index (1-based)
  const roots = new Float64Array(n);
  const flags = new Uint8Array(n);
  const counts = new Map();               // name -> count, first-use order
  for (let i = 0; i < n; i++) {
    const nn = neurons[i];
    roots[i] = nn.root_id;
    const ct = nn.cell_type;
    if (ct && ct !== "UNKNOWN") {
      let t = typeIdx.get(ct);
      if (t === undefined) { t = types.length + 1; typeIdx.set(ct, t); types.push(ct); }
      flags[i] = t;
      counts.set(ct, (counts.get(ct) || 0) + 1);
    }
  }
  if (!types.length || types.length > 255) return null;
  const enc = new TextEncoder();
  const nameBytes = types.map(t => enc.encode(t));
  const blobLen = 4 + types.length * 2 + nameBytes.reduce((a, b) => a + b.length, 0) + n;
  const blob = new Uint8Array(blobLen);
  const dv = new DataView(blob.buffer);
  dv.setUint32(0, types.length, true);
  let o = 4;
  for (let k = 0; k < types.length; k++) {
    dv.setUint16(o, nameBytes[k].length, true); o += 2;
    blob.set(nameBytes[k], o); o += nameBytes[k].length;
  }
  blob.set(flags, o);
  return { roots, blob, nNeurons: n, nTypes: types.length, types,
           byRoot: buildByRoot(roots, flags, types), counts };
}

// byRoot insertion order must match the legacy loader: payload neuron order
function buildByRoot(roots, flags, types) {
  const m = new Map();
  for (let i = 0; i < roots.length; i++) {
    if (flags[i]) m.set(String(roots[i]), types[flags[i] - 1]);
  }
  return m;
}

self.onmessage = (e) => {
  if (!e || !e.data || e.data.type !== "load_celltypes") return;
  fetch("fly_brain_celltypes.json", { cache: "no-cache" })
    .then(r => r.ok ? r.json() : null)
    .then(j => {
      const packed = packCelltypes(j);
      if (!packed) {
        self.postMessage({ type: "celltypes_unavailable", reason: "payload missing or untyped" });
        return;
      }
      const { roots, blob, nNeurons, nTypes, types, byRoot, counts } = packed;
      const countOrder = [...counts.keys()];
      self.postMessage({
        type: "celltypes",
        roots, rootsBuf: roots.buffer,
        blob, blobBuf: blob.buffer,
        nNeurons, nTypes, types, byRoot, countOrder,
        counts: Object.fromEntries(counts),
      }, [roots.buffer, blob.buffer]);
    })
    .catch(err => {
      self.postMessage({ type: "celltypes_unavailable",
                         reason: (err && err.message) || String(err) });
    });
};
